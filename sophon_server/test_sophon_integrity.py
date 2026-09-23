import hashlib
import pathlib
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import zstandard

import manifest_ldiff_pb2
import manifest_pb2
import sophon_api


def digest(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


class SophonIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.game = self.root / "game"
        self.stage = self.game / ".tmp"
        self.game.mkdir()
        self.stage.mkdir()
        options = sophon_api.Options()
        options.gamedir = self.game
        options.tempdir = self.stage
        options.repair_mode = "reliable"
        self.options_patch = patch.object(sophon_api, "OPT", options)
        self.options_patch.start()
        self.addCleanup(self.options_patch.stop)
        self.memory_patch = patch.object(sophon_api, "RUN_MEMORY_HACK", False)
        self.memory_patch.start()
        self.addCleanup(self.memory_patch.stop)
        self.client = sophon_api.SophonClient()
        self.client.installed_ver = "7.0.0"
        self.client.di_chunks.category_json = {"chunk_download": {"url_prefix": "https://example.test"}}

    def make_diff(self, name="Data/level0", old=b"old!", new=b"new!"):
        diff = manifest_ldiff_pb2.DiffFileInfo(
            filename=name, size=len(new), hash=digest(new)
        )
        info = diff.patches.add(key="7.0.0").info
        info.original_size = len(old)
        info.original_hash = digest(old)
        info.patch_id = "patch-1"
        info.patch_size = 5
        info.patch_length = 5
        return diff

    def make_file(self, name, data):
        compressed = zstandard.ZstdCompressor().compress(data)
        info = manifest_pb2.FileInfo(filename=name, size=len(data), md5=digest(data))
        chunk = info.chunks.add()
        chunk.chunk_id = digest(name.encode())
        chunk.offset = 0
        chunk.compressed_size = len(compressed)
        chunk.uncompressed_size = len(data)
        return info, compressed

    def write_game(self, name, data):
        path = self.game / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def test_predownload_rejects_same_size_wrong_source_without_changing_game(self):
        diff = self.make_diff()
        path = self.write_game(diff.filename, b"bad!")
        sophon_api.OPT.predownload = True
        with self.assertRaisesRegex(RuntimeError, "Check Game Integrity"):
            self.client._download_ldiff_file(self.game / "ldiff", diff)
        self.assertEqual(path.read_bytes(), b"bad!")
        self.assertEqual(self.client.new_files_to_download, set())

    def test_predownload_skips_file_already_at_target_hash(self):
        diff = self.make_diff()
        self.write_game(diff.filename, b"new!")
        sophon_api.OPT.predownload = True
        self.assertIsNone(self.client._download_ldiff_file(self.game / "ldiff", diff))

    def test_update_queues_full_file_when_source_hash_is_wrong(self):
        diff = self.make_diff()
        self.write_game(diff.filename, b"bad!")
        self.assertIsNone(self.client._download_ldiff_file(self.game / "ldiff", diff))
        self.assertEqual(self.client.new_files_to_download, {diff.filename})

    def test_failed_diff_download_uses_full_file_only_for_real_update(self):
        diff = self.make_diff()
        self.write_game(diff.filename, b"old!")
        ldiff_dir = self.game / "ldiff"
        ldiff_dir.mkdir()
        self.client.di_diffs.category_json = {"diff_download": {"url_prefix": "https://example.test"}}
        with patch.object(self.client, "_download_file_resume", side_effect=RuntimeError("offline")):
            self.assertIsNone(self.client._download_ldiff_file(ldiff_dir, diff))
        self.assertEqual(self.client.new_files_to_download, {diff.filename})

        self.client.new_files_to_download.clear()
        sophon_api.OPT.predownload = True
        with patch.object(self.client, "_download_file_resume", side_effect=RuntimeError("offline")):
            with self.assertRaisesRegex(RuntimeError, "offline"):
                self.client._download_ldiff_file(ldiff_dir, diff)
        self.assertEqual(self.client.new_files_to_download, set())

    def test_merge_rechecks_source_after_predownload(self):
        diff = self.make_diff()
        path = self.write_game(diff.filename, b"old!")
        ldiff_dir = self.game / "ldiff"
        ldiff_dir.mkdir()
        (ldiff_dir / "patch-1").write_bytes(b"patch")
        path.write_bytes(b"bad!")
        with patch.object(sophon_api, "hpatchz_patch_file") as patcher:
            self.assertFalse(self.client._apply_ldiff_file(ldiff_dir, diff))
        patcher.assert_not_called()
        self.assertEqual(path.read_bytes(), b"bad!")
        self.assertEqual(self.client.new_files_to_download, {diff.filename})

    def test_bad_patch_output_and_patch_error_preserve_original(self):
        diff = self.make_diff()
        path = self.write_game(diff.filename, b"old!")
        ldiff_dir = self.game / "ldiff"
        ldiff_dir.mkdir()
        (ldiff_dir / "patch-1").write_bytes(b"patch")

        def bad_output(_old, output, *_args, **_kwargs):
            output.write_bytes(b"bad!")
            return True

        with patch.object(sophon_api, "hpatchz_patch_file", side_effect=bad_output):
            self.assertFalse(self.client._apply_ldiff_file(ldiff_dir, diff))
        self.assertEqual(path.read_bytes(), b"old!")
        self.assertFalse((self.stage / "patches" / diff.filename).exists())
        self.assertEqual(self.client.new_files_to_download, {diff.filename})

        self.client.new_files_to_download.clear()
        with patch.object(sophon_api, "hpatchz_patch_file", side_effect=RuntimeError("patch failed")):
            self.assertFalse(self.client._apply_ldiff_file(ldiff_dir, diff))
        self.assertEqual(path.read_bytes(), b"old!")
        self.assertEqual(self.client.new_files_to_download, {diff.filename})

        self.client.new_files_to_download.clear()
        (ldiff_dir / "patch-1").unlink()
        self.assertFalse(self.client._apply_ldiff_file(ldiff_dir, diff))
        self.assertEqual(path.read_bytes(), b"old!")
        self.assertEqual(self.client.new_files_to_download, {diff.filename})

    def test_valid_patch_replaces_original_only_after_checksum(self):
        diff = self.make_diff()
        path = self.write_game(diff.filename, b"old!")
        ldiff_dir = self.game / "ldiff"
        ldiff_dir.mkdir()
        (ldiff_dir / "patch-1").write_bytes(b"patch")

        def valid_output(_old, output, *_args, **_kwargs):
            output.write_bytes(b"new!")
            return True

        with patch.object(sophon_api, "hpatchz_patch_file", side_effect=valid_output):
            self.assertTrue(self.client._apply_ldiff_file(ldiff_dir, diff))
        self.assertEqual(path.read_bytes(), b"new!")
        self.assertEqual(self.client.new_files_to_download, set())

    def test_repair_replaces_same_size_wrong_hash(self):
        name = "Data/level0"
        path = self.write_game(name, b"bad!")
        info, compressed = self.make_file(name, b"new!")
        self.client.installed_ver = "7.1.0"
        self.client.di_chunks.manifest = manifest_pb2.Manifest(files=[info])
        self.client.di_chunks.getBuild_json = {"data": {"tag": "7.1.0"}}

        def download_chunk(_url, output, _size, **_kwargs):
            output.write_bytes(compressed)

        with (
            patch.object(self.client, "load_manifest"),
            patch.object(self.client, "_download_file_resume", side_effect=download_chunk),
        ):
            self.client.repair_by_category("game")
        self.assertEqual(path.read_bytes(), b"new!")
        self.assertEqual(self.client.new_files_to_download, set())

    def test_bad_diff_falls_back_to_full_verified_file(self):
        diff = self.make_diff()
        path = self.write_game(diff.filename, b"old!")
        info, compressed = self.make_file(diff.filename, b"new!")
        self.client.di_diffs.manifest = manifest_ldiff_pb2.DiffManifest(files=[diff])
        self.client.di_chunks.manifest = manifest_pb2.Manifest(files=[info])
        self.client.di_chunks.getBuild_json = {"data": {"tag": "7.1.0"}}
        ldiff_dir = self.game / "ldiff"
        ldiff_dir.mkdir()
        (ldiff_dir / "patch-1").write_bytes(b"patch")

        def bad_output(_old, output, *_args, **_kwargs):
            output.write_bytes(b"bad!")
            return True

        def download_chunk(_url, output, _size, **_kwargs):
            output.write_bytes(compressed)

        with (
            patch.object(sophon_api, "hpatchz_patch_file", side_effect=bad_output),
            patch.object(self.client, "_download_file_resume", side_effect=download_chunk),
        ):
            self.client.apply_or_prepare_ldiff_files()
            self.assertEqual(path.read_bytes(), b"old!")
            self.client.diff_download_new_files()
        self.assertEqual(path.read_bytes(), b"new!")

    def test_same_basename_uses_distinct_staging_files(self):
        first, first_chunk = self.make_file("A/level0", b"aaaa")
        second, second_chunk = self.make_file("B/level0", b"bbbb")
        self.write_game(first.filename, b"xxxx")
        self.write_game(second.filename, b"yyyy")
        payloads = {first.chunks[0].chunk_id: first_chunk, second.chunks[0].chunk_id: second_chunk}

        def download_chunk(url, output, _size, **_kwargs):
            output.write_bytes(payloads[url.rsplit("/", 1)[1]])

        sophon_api.OPT.dry_run = True
        with patch.object(self.client, "_download_file_resume", side_effect=download_chunk):
            self.client.download_game_file(first)
            self.client.download_game_file(second)
        self.assertEqual((self.stage / "files" / first.filename).read_bytes(), b"aaaa")
        self.assertEqual((self.stage / "files" / second.filename).read_bytes(), b"bbbb")

    def test_bad_same_size_staging_file_is_rebuilt(self):
        info, compressed = self.make_file("Data/level0", b"new!")
        staged = self.stage / "files" / info.filename
        staged.parent.mkdir(parents=True)
        staged.write_bytes(b"bad!")

        def download_chunk(_url, output, _size, **_kwargs):
            output.write_bytes(compressed)

        with patch.object(self.client, "_download_file_resume", side_effect=download_chunk):
            self.client.download_game_file(info)
        self.assertEqual((self.game / info.filename).read_bytes(), b"new!")

    def test_download_size_excludes_cached_diff_and_counts_partial_transfer(self):
        diff = self.make_diff()
        info = diff.patches[0].info
        ldiff_dir = self.game / "ldiff"
        ldiff_dir.mkdir()
        self.assertEqual(self.client.remaining_ldiff_download_size(ldiff_dir, info), 5)
        (ldiff_dir / "patch-1_tmp").write_bytes(b"ab")
        self.assertEqual(self.client.remaining_ldiff_download_size(ldiff_dir, info), 3)
        (ldiff_dir / "patch-1").write_bytes(b"patch")
        self.assertEqual(self.client.remaining_ldiff_download_size(ldiff_dir, info), 0)

    def test_predownloaded_diff_reports_zero_remaining_bytes(self):
        diff = self.make_diff()
        self.write_game(diff.filename, b"old!")
        self.client.di_diffs.manifest = manifest_ldiff_pb2.DiffManifest(files=[diff])
        ldiff_dir = self.game / "ldiff"
        ldiff_dir.mkdir()
        (ldiff_dir / "patch-1").write_bytes(b"patch")
        sophon_api.OPT.predownload = True
        progress = MagicMock()
        self.client.apply_or_prepare_ldiff_files(progress_handler=progress)
        progress.ldiff_download_summary.assert_called_once_with(total_files=1, total_size=0)

    def test_download_size_excludes_cached_chunks_and_verified_staging_file(self):
        file_info, compressed = self.make_file("Data/level0", b"new!")
        self.client.di_chunks.manifest = manifest_pb2.Manifest(files=[file_info])
        self.client.new_files_to_download.add(file_info.filename)
        self.assertEqual(self.client.get_chunk_download_size(True), len(compressed))
        (self.stage / file_info.chunks[0].chunk_id).write_bytes(compressed[:2])
        self.assertEqual(self.client.get_chunk_download_size(True), len(compressed) - 2)
        (self.stage / file_info.chunks[0].chunk_id).write_bytes(compressed)
        self.assertEqual(self.client.get_chunk_download_size(True), 0)
        (self.stage / file_info.chunks[0].chunk_id).unlink()
        staged = self.stage / "files" / file_info.filename
        staged.parent.mkdir(parents=True)
        staged.write_bytes(b"new!")
        self.assertEqual(self.client.get_chunk_download_size(True), 0)


if __name__ == "__main__":
    unittest.main()
