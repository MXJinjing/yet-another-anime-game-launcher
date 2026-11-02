import pathlib
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import tasks
from models import InstallRequest
from task_errors import TaskCancelledError


@pytest.fixture
def install_harness(tmp_path, monkeypatch):
    (tmp_path / "config.ini").write_text("[General]\ngame_version=0.0.0\n")
    cli = MagicMock()
    cli.di_chunks.getBuild_json = {"data": {"tag": "1.2.3"}}
    cli.di_chunks.manifest.files = [SimpleNamespace(filename="globalgamemanagers", name="data")]
    cli.installed_ver = "1.2.3"
    cli.get_chunk_download_size.return_value = 100
    monkeypatch.setattr(tasks, "SophonClient", lambda: cli)
    monkeypatch.setattr(tasks, "RUN_MEMORY_HACK", False)
    progress = MagicMock()
    monkeypatch.setattr(tasks, "InstallProgressHandler", lambda *args: progress)
    request = InstallRequest(gamedir=str(tmp_path), game_type="hk4e", install_reltype="os")
    return cli, progress, request


def test_install_finishes_only_after_all_downloads(install_harness):
    cli, progress, request = install_harness
    cancelled, paused = threading.Event(), threading.Event()
    tasks.perform_install(MagicMock(), {}, "task", request, cancelled, paused)
    cli.download_game_file.assert_called_once_with(
        cli.di_chunks.manifest.files[0], install_progress_handler=progress,
        cancel_event=cancelled, pause_event=paused,
    )
    cli.update_config_ini_version.assert_called_once()
    progress.job_end.assert_called_once()
    assert "game_version=1.2.3" in (pathlib.Path(request.gamedir) / "config.ini").read_text()


def test_install_retries_transient_file_failure(install_harness):
    cli, progress, request = install_harness
    cli.download_game_file.side_effect = [OSError("temporary"), None]
    tasks.perform_install(MagicMock(), {}, "task", request)
    assert cli.download_game_file.call_count == 2
    progress.job_end.assert_called_once()


@pytest.mark.parametrize("error,attempts", [(TaskCancelledError("cancelled"), 1), (OSError("disk full"), 5)])
def test_install_never_finalizes_failed_or_cancelled_downloads(install_harness, error, attempts):
    cli, progress, request = install_harness
    cli.download_game_file.side_effect = error
    with pytest.raises(Exception):
        tasks.perform_install(MagicMock(), {}, "task", request)
    assert cli.download_game_file.call_count == attempts
    cli.update_config_ini_version.assert_not_called()
    progress.job_end.assert_not_called()


def test_config_version_requires_one_unambiguous_anchor(tmp_path):
    for body in ["invalid", "game_version=1.0.0\ngame_version=2.0.0"]:
        config = tmp_path / "config.ini"
        config.write_text(body)
        with pytest.raises(ValueError, match="Invalid config.ini"):
            tasks.update_config_ini_version(tmp_path, "3.0.0")
        assert config.read_text() == body


def test_cache_cleanup_preserves_unrelated_and_directory_data(tmp_path):
    cache = tmp_path / "cache"
    tasks.remove_cached_files(cache)
    cache.mkdir()
    for name in ["one.json", "two.zstd", "save.dat"]:
        (cache / name).write_text("data")
    (cache / "folder.json").mkdir()
    tasks.remove_cached_files(cache)
    assert sorted(p.name for p in cache.iterdir()) == ["folder.json", "save.dat"]


@pytest.mark.parametrize("release,predownload", [("os", True), ("cn", True), ("bb", False)])
@pytest.mark.parametrize("manifest_fails", [True, False])
def test_online_info_keeps_version_when_manifest_is_unavailable(tmp_path, monkeypatch, release, predownload, manifest_fails):
    monkeypatch.chdir(tmp_path)
    cli = MagicMock()
    cli.branches_json = {"tag": "2.0.0", "diff_tags": ["1.0.0"]}
    cli.get_chunk_download_size.return_value = 123
    if manifest_fails:
        cli.load_manifest.side_effect = ValueError("new protocol")
    monkeypatch.setattr(tasks, "SophonClient", lambda: cli)
    monkeypatch.setattr(tasks, "RUN_MEMORY_HACK", False)
    result = tasks.fetch_online_game_info(release, "nap")
    assert result.version == "2.0.0" and result.error is None
    assert result.install_size == (0 if manifest_fails else 123)
    assert result.pre_download == predownload
    assert result.updatable_versions == ["1.0.0"]
    assert not pathlib.Path("sidecar/sophon_server/gametemp").exists()


def test_online_info_handles_missing_predownload_and_reports_api_errors(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    cli = MagicMock()
    cli.branches_json = {"tag": "2.0.0"}
    cli.get_chunk_download_size.return_value = 1
    cli.retrieve_API_keys.side_effect = [None, AssertionError("not released")]
    monkeypatch.setattr(tasks, "SophonClient", lambda: cli)
    monkeypatch.setattr(tasks, "RUN_MEMORY_HACK", False)
    result = tasks.fetch_online_game_info("os", "hk4e")
    assert result.version == "2.0.0" and not result.pre_download
    cli.retrieve_API_keys.side_effect = OSError("offline")
    result = tasks.fetch_online_game_info("os", "hk4e")
    assert result.game_type == "" and "offline" in result.error
    assert "Unsupported" in tasks.fetch_online_game_info("os", "unknown").error
