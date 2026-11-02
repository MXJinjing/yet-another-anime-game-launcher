"""Exercise real ASGI routing/validation while keeping worker IO isolated."""
import asyncio
import threading
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import server
from models import TaskStatus


@pytest.fixture
def client(monkeypatch):
    manager = MagicMock()
    monkeypatch.setattr(server, "ConnectionManager", lambda loop: manager)
    monkeypatch.setattr(server, "tasks", {})
    monkeypatch.setattr(server, "task_cancel_events", {})
    monkeypatch.setattr(server, "task_pause_events", {})
    monkeypatch.setattr(server, "run_task_in_thread", MagicMock())
    monkeypatch.setattr(server.limiter, "set_rate", MagicMock())
    monkeypatch.delenv("TERMINATE_WITH_PID", raising=False)
    with TestClient(server.app) as session:
        yield session


@pytest.mark.parametrize("operation,extra,worker", [
    ("install", {"install_reltype": "os"}, "perform_install"),
    ("update", {"predownload": True}, "perform_update"),
    ("repair", {"repair_mode": "reliable"}, "perform_repair"),
])
def test_start_registers_controls_and_dispatches_matching_worker(client, operation, extra, worker):
    response = client.post(f"/api/{operation}", json={
        "gamedir": "/test/game", "game_type": "hk4e", "download_speed_limit": 1024, **extra,
    })
    assert response.status_code == 200
    task_id = response.json()["task_id"]
    assert response.json()["status"] == "pending"
    assert server.tasks[task_id].status == "pending"
    assert isinstance(server.task_cancel_events[task_id], threading.Event)
    assert not server.task_cancel_events[task_id].is_set()
    assert not server.task_pause_events[task_id].is_set()
    server.limiter.set_rate.assert_called_once_with(1024)
    call = server.run_task_in_thread.call_args.args
    assert call[0] is server.manager and call[1] is server.tasks
    assert call[2] == task_id and call[3] is getattr(server, worker)
    assert call[8] is server.task_cancel_events[task_id]
    assert call[9] is server.task_pause_events[task_id]
    assert getattr(call[7], next(iter(extra))) == next(iter(extra.values()))


@pytest.mark.parametrize("path,payload", [
    ("/api/unknown", {"gamedir": "/test", "game_type": "hk4e"}),
    ("/api/install", {}),
    ("/api/update", {"gamedir": "/test", "game_type": "unsupported"}),
    ("/api/limit", {"download_speed_limit": "invalid"}),
])
def test_invalid_requests_never_dispatch_workers(client, path, payload):
    assert client.post(path, json=payload).status_code == 422
    server.run_task_in_thread.assert_not_called()
    assert server.tasks == {}


def test_controls_and_status_operate_on_the_same_task(client):
    task_id = "one"
    server.tasks[task_id] = TaskStatus(task_id=task_id, status="running", progress=25)
    server.task_cancel_events[task_id] = threading.Event()
    server.task_pause_events[task_id] = threading.Event()
    assert client.get(f"/api/tasks/{task_id}/status").json()["progress"] == 25
    assert client.post(f"/api/tasks/{task_id}/pause").status_code == 200
    assert server.task_pause_events[task_id].is_set()
    assert client.post(f"/api/tasks/{task_id}/resume").status_code == 200
    assert not server.task_pause_events[task_id].is_set()
    assert client.delete(f"/api/tasks/{task_id}").status_code == 200
    assert server.task_cancel_events[task_id].is_set()


def test_missing_task_controls_are_idempotent(client):
    status = client.get("/api/tasks/missing/status").json()
    assert status["error"] == "Task not found"
    assert client.post("/api/tasks/missing/pause").status_code == 200
    assert client.post("/api/tasks/missing/resume").status_code == 200
    assert client.delete("/api/tasks/missing").status_code == 200
    assert server.task_cancel_events == server.task_pause_events == {}


def test_limit_route_is_reached_through_http(client):
    assert client.post("/api/limit", json={"download_speed_limit": 2048}).json() == {"ok": True}
    server.limiter.set_rate.assert_called_once_with(2048)
    server.run_task_in_thread.assert_not_called()


def test_health_response_and_online_info(client, monkeypatch):
    health = client.get("/health").json()
    assert health["status"] == "healthy" and health["timestamp"]
    info = {"game_type": "nap", "version": "1.2.3", "install_size": 100,
            "updatable_versions": [], "release_type": "os", "pre_download": False}
    fetch = MagicMock(return_value=info)
    monkeypatch.setattr(server, "fetch_online_game_info", fetch)
    assert client.get("/api/game/online_info?reltype=os&game=nap").json() == {**info, "error": None, "pre_download_version": None}
    fetch.assert_called_once_with("os", "nap")
    assert client.get("/api/game/online_info?reltype=os&game=invalid").status_code == 422


@pytest.mark.parametrize("status,message_type", [
    ("completed", "job_end"), ("failed", "error"), ("cancelled", "job_error"),
    ("running", None),
])
@pytest.mark.parametrize("cached", [False, True])
def test_websocket_replays_only_uncached_terminal_state(monkeypatch, status, message_type, cached):
    manager = MagicMock()
    manager.connect.return_value = cached
    monkeypatch.setattr(server, "manager", manager)
    monkeypatch.setattr(server, "tasks", {"one": TaskStatus(task_id="one", status=status)})
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.receive_text = AsyncMock(side_effect=WebSocketDisconnect())
    asyncio.run(server.websocket_endpoint(ws, "one"))
    ws.accept.assert_awaited_once()
    manager.connect.assert_called_once_with("one", ws)
    manager.disconnect.assert_called_once_with("one", ws)
    if not cached and message_type:
        message, task_id = manager.send_message_threadsafe.call_args.args
        assert message["type"] == message_type and task_id == "one"
        if status == "failed":
            assert message["error"] == "Operation failed"
    else:
        manager.send_message_threadsafe.assert_not_called()


def test_websocket_survives_keepalive_timeout_and_reports_failure_detail(monkeypatch):
    manager = MagicMock()
    manager.connect.return_value = False
    monkeypatch.setattr(server, "manager", manager)
    monkeypatch.setattr(server, "tasks", {"one": TaskStatus(task_id="one", status="failed", error="disk full")})
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.receive_text = AsyncMock(side_effect=[asyncio.TimeoutError(), "ping", WebSocketDisconnect()])
    asyncio.run(server.websocket_endpoint(ws, "one"))
    assert ws.receive_text.await_count == 3
    assert manager.send_message_threadsafe.call_args.args[0]["error"] == "disk full"
    manager.disconnect.assert_called_once_with("one", ws)


def test_unknown_websocket_task_disconnects_without_terminal_message(monkeypatch):
    manager = MagicMock()
    manager.connect.return_value = False
    monkeypatch.setattr(server, "manager", manager)
    monkeypatch.setattr(server, "tasks", {})
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.receive_text = AsyncMock(side_effect=WebSocketDisconnect())
    asyncio.run(server.websocket_endpoint(ws, "missing"))
    manager.send_message_threadsafe.assert_not_called()
    manager.disconnect.assert_called_once_with("missing", ws)
