import asyncio
from datetime import datetime
import unittest
from unittest.mock import patch

from starlette.routing import Match
from api import server
from api.models import TaskStatus, InstallRequest
from services.history import HistoryRequest


class TaskListTests(unittest.TestCase):
    def test_list_empty_and_all_statuses_newest_first(self):
        with patch.object(server, 'tasks', {}):
            scope = {'type': 'http', 'method': 'GET', 'path': '/api/tasks', 'root_path': ''}
            route = next(route for route in server.app.routes if route.matches(scope)[0] is Match.FULL)
            self.assertIs(route.endpoint, server.list_tasks)
            self.assertEqual(asyncio.run(server.list_tasks()), {'tasks': []})
            for status in ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']:
                server.tasks[status] = TaskStatus(task_id=status, task_name='check hk4e_os@4.5.0', status=status, started_at='2026-10-05T00:00:00+00:00')
            rows = asyncio.run(server.list_tasks())['tasks']
            self.assertEqual([row['status'] for row in rows], ['cancelled', 'failed', 'completed', 'paused', 'running', 'pending'])
            self.assertEqual(set(rows[0]), {'task_id', 'task_name', 'status', 'started_at'})

    def test_both_submission_paths_record_metadata(self):
        with patch.object(server, 'tasks', {}), patch.object(server, 'task_cancel_events', {}), patch.object(server, 'task_pause_events', {}), patch.object(server, 'run_task_in_thread'), patch.object(server.limiter, 'set_rate'):
            try:
                legacy = server.run_task('install', InstallRequest(gamedir='/game', game_type='hk4e', install_reltype='os'))
            finally:
                server.operation_lock.release()
            try:
                history = asyncio.run(server.historical_operation('check', HistoryRequest(gamedir='/game', region='cn', version='4.5.0')))
            finally:
                server.operation_lock.release()
            self.assertEqual(server.tasks[legacy.task_id].task_name, 'install hk4e')
            self.assertEqual(server.tasks[history.task_id].task_name, 'check hk4e_cn@4.5.0')
            for task in server.tasks.values():
                self.assertIsNotNone(datetime.fromisoformat(task.started_at).tzinfo)
