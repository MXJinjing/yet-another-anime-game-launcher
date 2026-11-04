import asyncio
import threading
import unittest
from unittest.mock import patch
from fastapi import HTTPException
import api.server as server
from api.models import TaskStatus

class TaskNotFoundTests(unittest.TestCase):
    def test_missing_tasks_return_404_without_changing_events(self):
        for endpoint in [server.get_task_status,server.cancel_task,server.pause_task,server.resume_task]:
            cancel=threading.Event();pause=threading.Event();pause.set()
            with patch.object(server,'tasks',{}),patch.object(server,'task_cancel_events',{'missing':cancel}),patch.object(server,'task_pause_events',{'missing':pause}):
                with self.assertRaises(HTTPException) as caught:asyncio.run(endpoint('missing'))
                self.assertEqual(caught.exception.status_code,404)
                self.assertEqual(caught.exception.detail,'Task not found')
                self.assertFalse(cancel.is_set());self.assertTrue(pause.is_set())
    def test_existing_controls_and_status_unchanged(self):
        task=TaskStatus(task_id='id',status='running');cancel=threading.Event();pause=threading.Event()
        with patch.object(server,'tasks',{'id':task}),patch.object(server,'task_cancel_events',{'id':cancel}),patch.object(server,'task_pause_events',{'id':pause}):
            self.assertIs(asyncio.run(server.get_task_status('id')),task)
            asyncio.run(server.pause_task('id'));self.assertTrue(pause.is_set())
            self.assertEqual(asyncio.run(server.resume_task('id')),{'message':'Task id resumed'})
            self.assertFalse(pause.is_set())
            asyncio.run(server.cancel_task('id'));self.assertTrue(cancel.is_set())

if __name__=='__main__':unittest.main()
