"""Source synchronization must preserve adapters and reject unbackported edits."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/sync-sophon.py"
spec = importlib.util.spec_from_file_location("sync_sophon", SCRIPT)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class SourceSyncTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source"
        self.destination = self.root / "launcher"
        self.lock = self.destination / "upstream-lock.json"
        self.upstream = self.source / "src/server.py"
        self.upstream.parent.mkdir(parents=True)
        self.upstream.write_text("version = 1\n")
        self.license = self.source / "LICENSE"
        self.license.write_text("shared license\n")
        self.destination.mkdir()
        self.adapter = self.destination / "build.py"
        self.adapter.write_text("launcher adapter\n")
        self.regression = self.destination / "tests/test_launcher_local.py"
        self.regression.parent.mkdir()
        self.regression.write_text("launcher regression\n")
        self.snapshot = patch.object(sync, "source_snapshot", side_effect=lambda source: (
            "revision", {"src/server.py": self.upstream, "LICENSE": self.license},
        ))
        self.snapshot.start()
        self.addCleanup(self.snapshot.stop)

    def apply(self):
        return sync.synchronize(self.source, self.destination, self.lock, apply=True)

    def test_apply_and_check_preserve_launcher_files(self):
        self.apply()
        sync.synchronize(self.source, self.destination, self.lock)
        self.assertEqual(self.adapter.read_text(), "launcher adapter\n")
        self.assertEqual(self.regression.read_text(), "launcher regression\n")
        self.assertIn("src/server.py", json.loads(self.lock.read_text())["files"])

    def test_check_is_read_only_and_apply_updates_clean_baseline(self):
        self.apply()
        self.upstream.write_text("version = 2\n")
        with self.assertRaisesRegex(ValueError, "needs synchronization"):
            sync.synchronize(self.source, self.destination, self.lock)
        local = self.destination / "src/server.py"
        self.assertEqual(local.read_text(), "version = 1\n")
        self.apply()
        self.assertEqual(local.read_text(), "version = 2\n")

    def test_divergent_edits_are_rejected_until_backported(self):
        self.apply()
        local = self.destination / "src/server.py"
        local.write_text("local fix\n")
        with self.assertRaisesRegex(ValueError, "unsynchronized edits"):
            self.apply()
        self.assertEqual(local.read_text(), "local fix\n")
        self.upstream.write_bytes(local.read_bytes())
        self.apply()
        sync.synchronize(self.source, self.destination, self.lock)

    def test_upstream_deletion_removes_only_unchanged_managed_files(self):
        self.apply()
        self.snapshot.stop()
        with patch.object(sync, "source_snapshot", return_value=("new-revision", {})):
            self.apply()
        self.assertFalse((self.destination / "src/server.py").exists())
        self.assertTrue(self.adapter.exists())
        self.assertTrue(self.regression.exists())

    def test_discovery_excludes_generated_and_launcher_tests(self):
        (self.destination / "src").mkdir()
        (self.destination / "src/manifest_pb2.py").write_text("generated\n")
        (self.destination / "tests/test_release_assets.py").write_text("standalone packaging\n")
        self.assertEqual(sync.shared_files(self.destination), {})

    def test_invalid_lock_path_is_rejected_without_writing(self):
        self.lock.write_text(json.dumps({"files": {"../outside": "digest"}}))
        with self.assertRaisesRegex(ValueError, "Invalid path"):
            self.apply()
        self.assertFalse((self.root / "outside").exists())

    def test_source_snapshot_rejects_dirty_shared_tree(self):
        source = self.root / "canonical"
        entry = source / "sophon-server/src/server.py"
        entry.parent.mkdir(parents=True)
        entry.write_text("source\n")
        self.snapshot.stop()
        with patch.object(sync.subprocess, "check_output", return_value=" M sophon-server/src/server.py\n"):
            with self.assertRaisesRegex(ValueError, "Commit shared Sophon changes"):
                sync.source_snapshot(source)

    def test_local_checksum_verification_needs_no_source_checkout(self):
        self.apply()
        sync.verify_lock(self.destination, self.lock)
        (self.destination / "src/server.py").write_text("drift\n")
        with self.assertRaisesRegex(ValueError, "differs from the revision lock"):
            sync.verify_lock(self.destination, self.lock)
