import time

from progress_handlers import InstallProgressHandler, UpdateProgressHandler


class RecordingConnectionManager:
    def __init__(self):
        self.messages = []

    def send_message_threadsafe(self, message, task_id):
        self.messages.append((task_id, message))


def test_active_file_snapshot_is_capped_at_eight_and_uses_network_bytes():
    manager = RecordingConnectionManager()
    handler = InstallProgressHandler("task", manager, {})
    handler.download_size = 800
    handler.total_file_count = 10

    for index in range(10):
        name = f"dir/file-{index}.bin"
        handler.file_download_start(name, 100)
        with handler._progress_lock:
            handler.active_files[name]["speed_at"] = time.time() - 2
        handler.file_transfer_progress(name, 25, 100)

    snapshot = handler._active_files_snapshot_locked()
    assert len(snapshot) == 8
    assert snapshot[0]["filename"] == "dir/file-0.bin"
    assert snapshot[0]["downloaded_size"] == 25
    assert snapshot[0]["total_size"] == 100
    assert snapshot[0]["progress_percent"] == 25
    assert snapshot[0]["download_speed"] > 0


def test_completed_and_skipped_files_leave_the_active_snapshot():
    manager = RecordingConnectionManager()
    handler = InstallProgressHandler("task", manager, {})
    handler.download_size = 200

    handler.file_download_start("complete.bin", 100)
    handler.file_transfer_progress("complete.bin", 50, 100)
    handler.file_download_complete("complete.bin", 150)
    assert handler.downloaded_size == 100
    assert handler._active_files_snapshot_locked() == []

    handler.file_download_start("skip.bin", 100)
    handler.file_download_skipped("skip.bin", "exists")
    assert handler._active_files_snapshot_locked() == []


def test_retry_resets_file_bytes_without_incrementing_the_file_counter():
    manager = RecordingConnectionManager()
    handler = InstallProgressHandler("task", manager, {})
    handler.download_size = 100

    handler.file_download_start("retry.bin", 100)
    handler.file_transfer_progress("retry.bin", 40, 100)
    handler.file_transfer_progress("retry.bin", -10, 100)
    assert handler.downloaded_size == 30

    handler.file_download_start("retry.bin", 100)
    snapshot = handler._active_files_snapshot_locked()
    assert handler.current_file_index == 1
    assert handler.downloaded_size == 0
    assert snapshot[0]["downloaded_size"] == 0

def test_ldiff_progress_uses_the_same_live_file_protocol():
    manager = RecordingConnectionManager()
    handler = UpdateProgressHandler("task", manager, {})
    handler.download_size = 64
    handler.total_file_count = 1

    handler.ldiff_download_start("patch.diff", 64)
    handler.ldiff_transfer_progress("patch.diff", 16, 64)
    snapshot = handler._active_files_snapshot_locked()
    assert snapshot[0]["downloaded_size"] == 16
    assert snapshot[0]["progress_percent"] == 25

    handler.ldiff_download_complete("patch.diff", 64)
    assert handler.downloaded_size == 64
    assert handler._active_files_snapshot_locked() == []
