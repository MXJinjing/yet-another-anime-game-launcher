import tempfile
import unittest
from unittest.mock import ANY, MagicMock, patch

import tasks
from models import RepairRequest, TaskStatus, UpdateRequest
from sophon_api import compare_game_versions
from tasks import determine_repair_action, is_predownload_enabled


class GameVersionComparisonTests(unittest.TestCase):
    def test_compares_numeric_components(self):
        self.assertLess(compare_game_versions("6.7.0", "7.0.0"), 0)
        self.assertGreater(compare_game_versions("6.10.0", "6.9.0"), 0)
        self.assertEqual(compare_game_versions("7.0.0", "7.0.0"), 0)

    def test_rejects_invalid_versions(self):
        with self.assertRaisesRegex(ValueError, "Invalid installed game version"):
            compare_game_versions("6.7", "7.0.0")


class PredownloadAvailabilityTests(unittest.TestCase):
    def test_predownload_is_disabled_for_domestic_releases(self):
        self.assertFalse(is_predownload_enabled("cn"))
        self.assertFalse(is_predownload_enabled("bb"))

    def test_predownload_remains_enabled_for_overseas_release(self):
        self.assertTrue(is_predownload_enabled("os"))

    def test_domestic_predownload_request_is_rejected_before_api_access(self):
        client = MagicMock()
        client.rel_type = "cn"

        with tempfile.TemporaryDirectory() as game_dir:
            request = UpdateRequest(
                gamedir=game_dir,
                game_type="hk4e",
                predownload=True,
            )
            with patch.object(tasks, "SophonClient", return_value=client):
                with self.assertRaisesRegex(RuntimeError, "Pre-download is disabled"):
                    tasks._perform_update(MagicMock(), request)

        client.retrieve_API_keys.assert_not_called()


class RepairWorkflowTests(unittest.TestCase):
    def test_updates_supported_older_version_before_repair(self):
        self.assertEqual(
            determine_repair_action("6.7.0", "7.0.0", ["6.7.0"]),
            "update",
        )

    def test_repairs_matching_version_directly(self):
        self.assertEqual(
            determine_repair_action("7.0.0", "7.0.0", ["6.7.0"]),
            "repair",
        )

    def test_rejects_unsupported_incremental_update(self):
        with self.assertRaisesRegex(RuntimeError, "too old for an incremental update"):
            determine_repair_action("6.6.0", "7.0.0", ["6.7.0"])

    def test_reports_newer_install_accurately(self):
        with self.assertRaisesRegex(
            RuntimeError,
            "newer than the available repair manifest",
        ):
            determine_repair_action("7.1.0", "7.0.0", ["6.7.0"])

    def test_repair_task_runs_update_then_integrity_check(self):
        old_client = MagicMock()
        old_client.installed_ver = "6.7.0"
        old_client.branches_json = {
            "tag": "7.0.0",
            "diff_tags": ["6.7.0"],
        }
        updated_client = MagicMock()
        updated_client.installed_ver = "7.0.0"

        manager = MagicMock()
        task_id = "repair-task"
        task_statuses = {
            task_id: TaskStatus(task_id=task_id, status="running"),
        }

        with tempfile.TemporaryDirectory() as game_dir:
            request = RepairRequest(
                gamedir=game_dir,
                game_type="hk4e",
                repair_mode="reliable",
            )
            with (
                patch.object(
                    tasks,
                    "SophonClient",
                    side_effect=[old_client, updated_client],
                ),
                patch.object(tasks, "_perform_update") as perform_update,
                patch.object(tasks, "RUN_MEMORY_HACK", False),
            ):
                tasks.perform_repair(manager, task_statuses, task_id, request)

        perform_update.assert_called_once()
        update_request = perform_update.call_args.args[1]
        self.assertEqual(update_request.gamedir, request.gamedir)
        self.assertFalse(update_request.predownload)
        updated_client.repair_by_category.assert_called_once_with(
            "game",
            repair_progress_handler=ANY,
            cancel_event=None,
        )


if __name__ == "__main__":
    unittest.main()
