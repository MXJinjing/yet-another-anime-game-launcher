import pathlib
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from api.models import InstallRequest
from services import operations
from infrastructure.errors import TaskCancelledError


class InstallFinalizationTests(unittest.TestCase):
    def test_failed_or_cancelled_install_keeps_recorded_version(self):
        for error in [OSError("disk full"), TaskCancelledError("cancelled")]:
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                config = root / "config.ini"
                config.write_text("[General]\ngame_version=0.0.0\n")
                client = MagicMock()
                client.di_chunks.getBuild_json = {"data": {"tag": "1.2.3"}}
                client.di_chunks.manifest.files = [SimpleNamespace(filename="one")]
                client.download_game_file.side_effect = error
                progress = MagicMock()
                request = InstallRequest(gamedir=directory, game_type="hk4e", install_reltype="os")
                with patch.object(operations, "SophonClient", return_value=client), patch.object(operations, "InstallProgressHandler", return_value=progress):
                    with self.assertRaises(Exception):
                        operations.perform_install(MagicMock(), {}, "task", request, threading.Event(), threading.Event())
                self.assertIn("game_version=0.0.0", config.read_text())
                client.update_config_ini_version.assert_not_called()
                progress.job_end.assert_not_called()
