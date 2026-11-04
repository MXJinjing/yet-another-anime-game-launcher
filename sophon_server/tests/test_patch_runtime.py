"""Exercise native patch waiting, timeout, and cancellation with a fake child."""
from unittest.mock import MagicMock, patch
import subprocess
import threading
import pytest
from engine import runtime
from infrastructure.errors import TaskCancelledError


def test_patch_wait_reports_liveness_without_touching_game_source(tmp_path):
    old, output, bundle, helper = [tmp_path / n for n in ["old", "out", "patch", "hpatchz"]]
    old.write_bytes(b"original"); bundle.write_bytes(b"patch"); helper.touch()
    child = MagicMock(returncode=0)
    child.communicate.side_effect = [subprocess.TimeoutExpired("hpatchz", 0.2), ("", "")]
    heartbeat = MagicMock()
    with patch.object(runtime, "HPATCHZ_APP", helper), patch.object(runtime.subprocess, "Popen", return_value=child):
        assert runtime.hpatchz_patch_file(old, output, bundle, 0, 5, progress_callback=heartbeat)
    assert heartbeat.call_count == 2
    assert old.read_bytes() == b"original"


@pytest.mark.parametrize("mode", ["timeout", "cancel", "error"])
def test_failed_native_patch_never_replaces_original(tmp_path, mode):
    old, output, bundle, helper = [tmp_path / n for n in ["old", "out", "patch", "hpatchz"]]
    old.write_bytes(b"original"); output.write_bytes(b"incomplete"); bundle.write_bytes(b"patch"); helper.touch()
    cancelled = threading.Event()
    child = MagicMock(returncode=1 if mode == "error" else 0)
    child.communicate.return_value = ("", "bad patch" if mode == "error" else "")
    def spawn(*args, **kwargs):
        if mode == "cancel": cancelled.set()
        return child
    with patch.object(runtime, "HPATCHZ_APP", helper), patch.object(runtime.subprocess, "Popen", side_effect=spawn):
        if mode == "timeout":
            assert not runtime.hpatchz_patch_file(old, output, bundle, 0, 5, timeout=0)
        else:
            with pytest.raises(TaskCancelledError if mode == "cancel" else RuntimeError):
                runtime.hpatchz_patch_file(old, output, bundle, 0, 5, cancel_event=cancelled)
    assert not output.exists()
    assert old.read_bytes() == b"original"
