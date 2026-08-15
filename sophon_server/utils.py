import threading, queue, asyncio, json, time
from collections import deque
from typing import Dict, Any
from fastapi import WebSocket
from models import TaskStatus
from task_errors import TaskCancelledError

class ConnectionManager:
    TERMINAL_MESSAGE_TYPES = {"job_end", "job_error", "error", "completed"}

    def __init__(
        self,
        event_loop: asyncio.AbstractEventLoop,
        pending_limit: int = 512,
        pending_ttl: float = 300.0,
    ):
        self.active_connections: Dict[str, Any] = {}  # client_id -> websocket
        self._queue = queue.Queue()
        self._pending = {}
        self._pending_updated_at = {}
        self._pending_limit = max(1, pending_limit)
        self._pending_ttl = max(1.0, pending_ttl)
        self._worker_thread = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._started = False
        self._event_loop = event_loop
        self._start_worker_if_needed()

    def connect(self, client_id: str, websocket):
        with self._lock:
            self._purge_expired_pending_locked()
            self.active_connections[client_id] = websocket
            pending = self._pending.pop(client_id, deque())
            self._pending_updated_at.pop(client_id, None)
            has_terminal = False
            for message in pending:
                has_terminal = has_terminal or self._is_terminal(message)
                self._send_message(message, websocket)
            return has_terminal

    def disconnect(self, client_id: str, websocket=None):
        with self._lock:
            current = self.active_connections.get(client_id)
            if current is not None and (websocket is None or current is websocket):
                print(f"Disconnecting client {client_id}")
                del self.active_connections[client_id]

    def _is_terminal(self, message: Dict[str, Any]) -> bool:
        return message.get("type") in self.TERMINAL_MESSAGE_TYPES

    def _purge_expired_pending_locked(self):
        cutoff = time.monotonic() - self._pending_ttl
        expired = [
            client_id
            for client_id, updated_at in self._pending_updated_at.items()
            if updated_at < cutoff
        ]
        for client_id in expired:
            self._pending.pop(client_id, None)
            self._pending_updated_at.pop(client_id, None)

    def _cache_pending_locked(self, client_id: str, message: Dict[str, Any]):
        self._purge_expired_pending_locked()
        pending = self._pending.setdefault(client_id, deque())
        if len(pending) >= self._pending_limit:
            # Preserve terminal state in preference to old progress updates.
            drop_index = next(
                (i for i, item in enumerate(pending) if not self._is_terminal(item)),
                None,
            )
            if drop_index is None:
                if not self._is_terminal(message):
                    self._pending_updated_at[client_id] = time.monotonic()
                    return
                drop_index = 0
            del pending[drop_index]
        pending.append(message)
        self._pending_updated_at[client_id] = time.monotonic()

    def _start_worker_if_needed(self):
        if not self._started:
            self._started = True
            self._stop_event.clear()
            self._worker_thread = threading.Thread(target=self._message_worker, daemon=True)
            self._worker_thread.start()
            print("Global message worker started")

    def _send_message(self, message: Dict[str, Any], websocket: WebSocket):
        asyncio.run_coroutine_threadsafe(
            websocket.send_text(json.dumps(message)),
            self._event_loop
        )
        # Due to the way websockets library is designed
        # we need a asyncio.sleep() after sending a message
        # for the message to be sent properly
        asyncio.run_coroutine_threadsafe(
            asyncio.sleep(0),
            self._event_loop
        )

    def _message_worker(self):
        print("Message worker running...")
        while not self._stop_event.is_set():
            try:
                message, client_id = self._queue.get(block=True, timeout=0.2)

                with self._lock:
                    websocket: WebSocket = self.active_connections.get(client_id)
                    if websocket:
                        try:
                            self._send_message(message, websocket)
                        except Exception as e:
                            print(f"Error sending message to {client_id}: {e}")
                            if self.active_connections.get(client_id) is websocket:
                                del self.active_connections[client_id]
                            self._cache_pending_locked(client_id, message)
                    else:
                        self._cache_pending_locked(client_id, message)

            except queue.Empty:
                continue
            except Exception as e:
                print(f"Worker error: {e}")
                time.sleep(1)

    def send_message_threadsafe(self, message: dict, client_id: str):
        try:
            self._queue.put_nowait((message, client_id))
        except queue.Full:
            print(f"Message queue full for client {client_id}")

    def stop_worker(self):
        self._stop_event.set()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=5.0)

def run_task_in_thread(manager: ConnectionManager, tasks: Dict[str, TaskStatus], task_id: str, operation_func, *args):
    def task_runner():
        try:
            tasks[task_id].status = "running"
            result = operation_func(*args)

            manager.send_message_threadsafe({
                "type": "completed",
                "task_id": task_id,
                "result": result
            }, task_id)

            tasks[task_id].status = "completed"

        except TaskCancelledError:
            manager.send_message_threadsafe({
                "type": "job_error",
                "task_id": task_id,
                "error": "cancelled"
            }, task_id)

            tasks[task_id].status = "cancelled"
            tasks[task_id].error = "cancelled"

        except Exception as e:
            manager.send_message_threadsafe({
                "type": "error",
                "task_id": task_id,
                "error": str(e)
            }, task_id)

            tasks[task_id].status = "failed"
            tasks[task_id].error = str(e)

    thread = threading.Thread(target=task_runner, daemon=True)
    thread.start()
