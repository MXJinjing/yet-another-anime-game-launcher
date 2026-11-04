import argparse
import asyncio
import os
import uuid
import threading
import ssl
from datetime import datetime, timezone
from asyncio import AbstractEventLoop
from typing import Literal, Union

from fastapi import FastAPI, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from infrastructure.connections import ConnectionManager
from infrastructure.runner import run_task_in_thread
from fastapi import WebSocket
from typing import Dict
from api.models import (
    InstallRequest,
    RepairRequest,
    UpdateRequest,
    LimitRequest,
    TaskStatus,
    TaskResponse,
    OnlineGameInfo,
)
from services.operations import perform_install, perform_repair, perform_update, fetch_online_game_info
from infrastructure.rate_limiter import limiter
from services.history import HistoryRequest, build_summary, files_info, run_history

# Disable SSL verification
ssl._create_default_https_context = ssl._create_unverified_context

operation_lock = threading.Lock()

def guarded_operation(func, *args):
    try:
        return func(*args)
    finally:
        operation_lock.release()


app = FastAPI(title="Sophon Game Updater", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

main_event_loop: AbstractEventLoop = None
manager: ConnectionManager = None
tasks: Dict[str, TaskStatus] = {}
task_cancel_events: Dict[str, threading.Event] = {}
task_pause_events: Dict[str, threading.Event] = {}


def terminate_with_process(pid: int):
    print(f"Monitoring process {pid} for termination...")
    def _worker(target_pid: int):
        import os, time, psutil, signal
        while True:
            if not psutil.pid_exists(target_pid):
                # daemon threads somehow doesn't die with SIGTERM
                # TODO: Terminate gracefully: event based termination
                os._exit(0)
            time.sleep(1)
    threading.Thread(target=_worker, args=(pid,), daemon=True).start()


def run_task(task_type: Literal["install", "repair", "update"], request: Union[InstallRequest, RepairRequest, UpdateRequest]):
    if not operation_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another operation or version query is running")
    task_id = str(uuid.uuid4())

    # Apply the per-task download speed limit (bytes/s, 0 = unlimited) so the
    # download is throttled from the moment the task starts.
    limiter.set_rate(request.download_speed_limit)

    tasks[task_id] = TaskStatus(
        task_id=task_id,
        status="pending",
        task_name=f"{task_type} {request.game_type}",
        started_at=datetime.now(timezone.utc).isoformat(),
    )
    task_cancel_events[task_id] = threading.Event()
    task_pause_events[task_id] = threading.Event()

    if task_type == "install":
        run_task_in_thread(manager, tasks, task_id, guarded_operation, perform_install, manager, tasks, task_id, request, task_cancel_events[task_id], task_pause_events[task_id])
    elif task_type == "repair":
        run_task_in_thread(manager, tasks, task_id, guarded_operation, perform_repair, manager, tasks, task_id, request, task_cancel_events[task_id], task_pause_events[task_id])
    elif task_type == "update":
        run_task_in_thread(manager, tasks, task_id, guarded_operation, perform_update, manager, tasks, task_id, request, task_cancel_events[task_id], task_pause_events[task_id])
    else:
        operation_lock.release()
        return TaskResponse(
            task_id=task_id,
            status="failed",
            message="Invalid task type"
        )
    return TaskResponse(
        task_id=task_id,
        status="pending",
        message="Task started"
    )

@app.post("/api/limit")
async def set_download_speed_limit(request: LimitRequest):
    limiter.set_rate(request.download_speed_limit)
    return {"ok": True}


@app.get("/api/history/versions")
async def historical_versions(region: Literal["os", "cn", "bb"] = "os", refresh: bool = False):
    import asyncio
    from services.version_catalog import available_versions
    try:
        return await asyncio.to_thread(available_versions, region, refresh)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/history/build")
async def historical_build(region: Literal["os", "cn", "bb"] = "os", version: str | None = Query(default=None, pattern=r"^\d+\.\d+\.\d+$")):
    # Metadata lookup does not touch the process-global downloader options.
    try:
        return await asyncio.to_thread(build_summary, region, version)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/history/status")
async def historical_status(gamedir: str = Query(min_length=1)):
    from services.directory_status import directory_status
    try:
        return await asyncio.to_thread(directory_status, gamedir)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/history/files")
async def historical_files(version: str = Query(pattern=r"^\d+\.\d+\.\d+$"),
        region: Literal["os", "cn", "bb"] = "os",
        category: Literal["game", "en-us", "zh-cn", "ja-jp", "ko-kr"] = "game",
        pattern: str = "*", offset: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=1000),
        path: str | None = None, recursive: bool = False, refresh: bool = False):
    # Browsing no longer mutates process-global downloader options; downloads may continue.
    try:
        return await asyncio.to_thread(files_info, region, version, category, pattern, offset, limit, path, recursive, refresh)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/history/{operation}")
async def historical_operation(operation: Literal["install", "sync", "download", "check", "repair"], payload: HistoryRequest):
    if operation == "download" and not payload.files:
        raise HTTPException(status_code=422, detail="download requires explicit files")
    if operation in {"install", "sync"} and payload.files:
        raise HTTPException(status_code=422, detail="install/sync operate on whole categories; use download for selected files")
    if operation in {"install", "sync"} and "game" not in payload.categories:
        raise HTTPException(status_code=422, detail="install/sync require the game category")
    if not operation_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another downloader operation is running")
    task_id = str(uuid.uuid4())
    try:
        limiter.set_rate(payload.download_speed_limit)
        tasks[task_id] = TaskStatus(task_id=task_id, status="pending",
            task_name=f"{operation} {payload.game_type}_{payload.region}@{payload.version}",
            started_at=datetime.now(timezone.utc).isoformat())
        task_cancel_events[task_id] = threading.Event()
        task_pause_events[task_id] = threading.Event()
        run_task_in_thread(manager, tasks, task_id, guarded_operation, run_history,
            manager, tasks, task_id, operation, payload, task_cancel_events[task_id], task_pause_events[task_id])
    except Exception:
        operation_lock.release()
        raise
    return TaskResponse(task_id=task_id, status="pending", message="Task started")


@app.post("/api/{task_type}")
async def handle_game_operation(task_type: Literal["install", "repair", "update"], request: Union[InstallRequest, RepairRequest, UpdateRequest]) -> TaskResponse:
    expected = {"install": InstallRequest, "repair": RepairRequest, "update": UpdateRequest}[task_type]
    if not isinstance(request, expected):
        raise HTTPException(status_code=422, detail=f"Request fields do not match {task_type}")
    return run_task(task_type, request)

@app.get("/api/tasks")
async def list_tasks():
    return {"tasks": [
        {"task_id": task.task_id, "task_name": task.task_name,
         "status": task.status, "started_at": task.started_at}
        for task in reversed(list(tasks.values()))
    ]}


@app.get("/api/tasks/{task_id}/status")
async def get_task_status(task_id: str) -> TaskStatus:
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks[task_id]


@app.delete("/api/tasks/{task_id}")
async def cancel_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    task_cancel_events[task_id].set()
    return {"message": f"Task {task_id} cancelled"}


@app.post("/api/tasks/{task_id}/pause")
async def pause_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    task_pause_events[task_id].set()
    return {"message": f"Task {task_id} paused"}


@app.post("/api/tasks/{task_id}/resume")
async def resume_task(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    task_pause_events[task_id].clear()
    return {"message": f"Task {task_id} resumed"}

@app.get("/api/game/online_info")
async def get_online_game_info(reltype: str, game: Literal["nap", "hk4e"]) -> OnlineGameInfo:
    if not operation_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another operation is running")
    try:
        return await asyncio.to_thread(fetch_online_game_info, reltype, game)
    finally:
        operation_lock.release()

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }

@app.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()
    has_cached_terminal = manager.connect(task_id, websocket)
    task = tasks.get(task_id)
    if task and not has_cached_terminal:
        if task.status == "completed":
            manager.send_message_threadsafe({
                "type": "job_end",
                "task_id": task_id,
            }, task_id)
        elif task.status == "failed":
            manager.send_message_threadsafe({
                "type": "error",
                "task_id": task_id,
                "error": task.error or "Operation failed",
            }, task_id)
        elif task.status == "cancelled":
            manager.send_message_threadsafe({
                "type": "job_error",
                "task_id": task_id,
                "error": "cancelled",
            }, task_id)

    try:
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            except asyncio.TimeoutError:
                continue
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(task_id, websocket)


@app.on_event("startup")
def startup_event():
    global main_event_loop
    global tasks
    global manager
    global task_cancel_events
    main_event_loop = asyncio.get_event_loop()
    manager = ConnectionManager(main_event_loop)
    manager.task_statuses = tasks
    if os.environ.get("TERMINATE_WITH_PID"):
        pid = int(os.environ["TERMINATE_WITH_PID"])
        terminate_with_process(pid)

def main(argv=None):
    import uvicorn
    parser = argparse.ArgumentParser(description="Run the Sophon server.")
    parser.add_argument("--port", type=int, help="Listening port (default: SOPHON_PORT or 18765).")
    args = parser.parse_args(argv)
    try:
        port = args.port if args.port is not None else int(os.environ.get("SOPHON_PORT", 18765))
    except ValueError:
        parser.error("SOPHON_PORT must be an integer")
    if not 1 <= port <= 65535:
        parser.error("port must be between 1 and 65535")
    host = os.environ.get("SOPHON_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, workers=1)
