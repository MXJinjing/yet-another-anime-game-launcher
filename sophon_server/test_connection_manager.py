import threading
import time
import unittest
from unittest.mock import MagicMock

from models import TaskStatus
from task_errors import TaskCancelledError
from utils import ConnectionManager, run_task_in_thread


def wait_until(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


class ConnectionManagerTests(unittest.TestCase):
    def setUp(self):
        self.manager = ConnectionManager(MagicMock(), pending_limit=3)
        self.sent = []
        self.manager._send_message = lambda message, websocket: self.sent.append(
            (message, websocket)
        )

    def tearDown(self):
        self.manager.stop_worker()

    def test_messages_before_connect_are_flushed_in_order(self):
        messages = [
            {"type": "job_start"},
            {"type": "chunk_progress", "value": 1},
            {"type": "job_end"},
        ]
        for message in messages:
            self.manager.send_message_threadsafe(message, "task")

        self.assertTrue(
            wait_until(lambda: len(self.manager._pending.get("task", ())) == 3)
        )
        websocket = object()
        self.assertTrue(self.manager.connect("task", websocket))
        self.assertEqual(self.sent, [(message, websocket) for message in messages])
        self.assertNotIn("task", self.manager._pending)

    def test_pending_limit_preserves_terminal_message(self):
        self.manager.stop_worker()
        self.manager = ConnectionManager(MagicMock(), pending_limit=2)
        self.sent = []
        self.manager._send_message = lambda message, websocket: self.sent.append(
            (message, websocket)
        )
        for message in (
            {"type": "chunk_progress", "value": 1},
            {"type": "job_end"},
            {"type": "chunk_progress", "value": 2},
        ):
            self.manager.send_message_threadsafe(message, "task")

        self.assertTrue(
            wait_until(lambda: len(self.manager._pending.get("task", ())) == 2)
        )
        websocket = object()
        self.assertTrue(self.manager.connect("task", websocket))
        self.assertEqual(
            [message["type"] for message, _ in self.sent],
            ["job_end", "chunk_progress"],
        )

    def test_old_disconnect_does_not_remove_replacement_connection(self):
        old_websocket = object()
        new_websocket = object()
        self.manager.connect("task", old_websocket)
        self.manager.connect("task", new_websocket)
        self.manager.disconnect("task", old_websocket)
        self.assertIs(self.manager.active_connections["task"], new_websocket)


class TaskCancellationTests(unittest.TestCase):
    def test_cancel_has_one_terminal_message_and_cancelled_status(self):
        manager = MagicMock()
        messages = []
        manager.send_message_threadsafe.side_effect = (
            lambda message, task_id: messages.append(message)
        )
        statuses = {"task": TaskStatus(task_id="task", status="pending")}

        def cancelled_operation():
            raise TaskCancelledError("cancelled")

        run_task_in_thread(manager, statuses, "task", cancelled_operation)
        self.assertTrue(wait_until(lambda: statuses["task"].status == "cancelled"))
        self.assertEqual(messages, [
            {"type": "job_error", "task_id": "task", "error": "cancelled"}
        ])


if __name__ == "__main__":
    unittest.main()
