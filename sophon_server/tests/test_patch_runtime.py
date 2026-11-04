"""Exercise native patch waiting, timeout, and cancellation with a fake child."""
from pathlib import Path
from unittest.mock import MagicMock, patch
import subprocess
import tempfile
import threading
import unittest
from engine import runtime
from infrastructure.errors import TaskCancelledError


class PatchRuntimeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.old, self.output, self.bundle, self.helper = [self.root / n for n in ["old", "out", "patch", "hpatchz"]]
        self.old.write_bytes(b"original")
        self.bundle.write_bytes(b"patch")
        self.helper.touch()

    def test_patch_wait_reports_liveness_without_touching_game_source(self):
        child = MagicMock(returncode=0)
        child.communicate.side_effect = [subprocess.TimeoutExpired("hpatchz", 0.2), ("", "")]
        heartbeat = MagicMock()
        with patch.object(runtime, "HPATCHZ_APP", self.helper), patch.object(runtime.subprocess, "Popen", return_value=child):
            self.assertTrue(runtime.hpatchz_patch_file(self.old, self.output, self.bundle, 0, 5, progress_callback=heartbeat))
        self.assertEqual(heartbeat.call_count, 2)
        self.assertEqual(self.old.read_bytes(), b"original")

    def test_failed_native_patch_never_replaces_original(self):
        for mode in ["timeout", "cancel", "error"]:
            with self.subTest(mode=mode):
                self.output.write_bytes(b"incomplete")
                cancelled = threading.Event()
                child = MagicMock(returncode=1 if mode == "error" else 0)
                child.communicate.return_value = ("", "bad patch" if mode == "error" else "")
                def spawn(*args, **kwargs):
                    if mode == "cancel": cancelled.set()
                    return child
                with patch.object(runtime, "HPATCHZ_APP", self.helper), patch.object(runtime.subprocess, "Popen", side_effect=spawn):
                    if mode == "timeout":
                        self.assertFalse(runtime.hpatchz_patch_file(self.old, self.output, self.bundle, 0, 5, timeout=0))
                    else:
                        with self.assertRaises(TaskCancelledError if mode == "cancel" else RuntimeError):
                            runtime.hpatchz_patch_file(self.old, self.output, self.bundle, 0, 5, cancel_event=cancelled)
                self.assertFalse(self.output.exists())
                self.assertEqual(self.old.read_bytes(), b"original")
