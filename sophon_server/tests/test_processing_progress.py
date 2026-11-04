"""Local work must be visible even before a transfer starts."""
import hashlib
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import threading

import unittest
import tempfile
from pathlib import Path

from engine import files, runtime
from engine.client import SophonClient
from infrastructure.errors import TaskCancelledError
from services.progress import UpdateProgressHandler


class ProcessingProgressTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_processing_reports_phase_counts_bytes_and_periodic_heartbeat(self):
        manager = MagicMock()
        handler = UpdateProgressHandler("task", manager, {})
        with patch("services.progress.time.monotonic", return_value=10) as clock:
            handler.processing_start("patching", "Data/one", 0, 2)
            assert manager.send_message_threadsafe.call_args.args[0]["processed_files"] == 0
            handler.processing_file_bytes(20, 100)
            assert manager.send_message_threadsafe.call_count == 1  # throttled
            clock.return_value = 12
            handler.processing_heartbeat()
            message = manager.send_message_threadsafe.call_args.args[0]
            assert message["elapsed_seconds"] == 2
            assert message["current_bytes"] == 20 and message["file_bytes"] == 100
            assert message["overall_progress"] == {"overall_percent": 0}
            handler.processing_complete()
            handler.processing_start("patching", "Data/two", 1, 2)
            handler.processing_complete()
            message = manager.send_message_threadsafe.call_args.args[0]
            assert message["processed_files"] == 2
            assert message["overall_progress"]["overall_percent"] == 100
            # A new phase emits immediately, without waiting for the rate limit.
            handler.processing_start("calculating_download", "Data/two", 0, 1)
            assert manager.send_message_threadsafe.call_args.args[0]["phase"] == "calculating_download"


    def test_hash_reports_real_read_bytes_and_honors_cancellation(self):
        tmp_path = self.root
        path = tmp_path / "large.bin"
        contents = b"x" * (9 * 1024 * 1024)
        path.write_bytes(contents)
        observed = []
        assert files.file_md5(path, lambda current, total: observed.append((current, total))) == hashlib.md5(contents).hexdigest()
        assert observed == [(0, len(contents)), (8 * 1024 * 1024, len(contents)), (len(contents), len(contents))]
        cancelled = threading.Event()
        def stop_after_one_block(current, total):
            if current:
                cancelled.set()
        with self.assertRaises(TaskCancelledError):
            files.file_md5(path, stop_after_one_block, cancel_event=cancelled)


    def test_download_size_reports_all_inspected_files_including_reused(self):
        client = SophonClient()
        entries = [SimpleNamespace(filename="one"), SimpleNamespace(filename="two")]
        client.di_chunks.manifest = SimpleNamespace(files=entries)
        client.new_files_to_download = {"two"}
        progress = MagicMock()
        with patch.object(client, "remaining_chunk_download_size", return_value=5) as size:
            assert client.get_chunk_download_size(True, progress_handler=progress) == 5
        assert size.call_args.args[0] is entries[1]
        progress.processing_start.assert_called_once_with("calculating_download", "two", 0, 1)
        progress.processing_complete.assert_called_once_with()


    def test_patch_loop_reports_skipped_files_as_processed(self):
        tmp_path = self.root
        client = SophonClient()
        entries = [SimpleNamespace(filename="one"), SimpleNamespace(filename="two")]
        client.di_diffs.manifest = SimpleNamespace(files=entries)
        progress = MagicMock()
        with patch.object(runtime, "OPT", SimpleNamespace(predownload=False, TESTING_FILE=None)), patch.object(runtime, "RUN_MEMORY_HACK", False), patch("engine.patches.gamedir", return_value=tmp_path), patch.object(client, "ldiff_manifest_required"), patch.object(client, "get_ldiff_patchinfo", return_value=None), patch.object(client, "_download_ldiff_file", return_value=None):
            client.apply_or_prepare_ldiff_files(progress_handler=progress)
        assert progress.processing_start.call_args_list[0].args == ("patching", "one", 0, 2)
        assert progress.processing_start.call_args_list[1].args == ("patching", "two", 1, 2)
        assert progress.processing_complete.call_count == 2
