"""Execute operations in a background thread and publish terminal state."""
import threading
from typing import Dict
from api.models import TaskStatus
from infrastructure.connections import ConnectionManager
from infrastructure.errors import TaskCancelledError

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

            tasks[task_id].result = result
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
