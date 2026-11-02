import json
import os
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import sophon_api as api


@pytest.fixture
def client(tmp_path, monkeypatch):
    options = api.Options()
    options.gamedir = tmp_path
    options.tempdir = tmp_path / "cache"
    options.tempdir.mkdir()
    options.force_use_cache = False
    options.dry_run = False
    options.do_install = True
    options.do_update = False
    monkeypatch.setattr(api, "OPT", options)
    return api.SophonClient()


def test_cache_reuses_recent_data_without_network(client, monkeypatch):
    cache = api.OPT.tempdir / "one.json"
    cache.write_text("cached")
    network = MagicMock()
    monkeypatch.setattr(api.request, "urlretrieve", network)
    assert client.load_cached_api_file("one.json", "https://example.invalid").read_text() == "cached"
    network.assert_not_called()


def test_cache_refreshes_stale_data_and_resolves_lazy_urls(client, monkeypatch):
    cache = api.OPT.tempdir / "one.json"
    cache.write_text("old")
    old = time.time() - 25 * 3600
    os.utime(cache, (old, old))
    network = MagicMock(side_effect=lambda url, path: path.write_text("fresh"))
    monkeypatch.setattr(api.request, "urlretrieve", network)
    url = MagicMock(return_value="https://example.invalid")
    assert client.load_cached_api_file("one.json", url).read_text() == "fresh"
    url.assert_called_once()
    network.assert_called_once_with("https://example.invalid", cache)


def test_force_cache_never_downloads_stale_data(client, monkeypatch):
    cache = api.OPT.tempdir / "one.json"
    cache.write_text("cached")
    os.utime(cache, (0, 0))
    api.OPT.force_use_cache = True
    network = MagicMock()
    monkeypatch.setattr(api.request, "urlretrieve", network)
    assert client.load_cached_api_file("one.json", "https://example.invalid").read_text() == "cached"
    network.assert_not_called()


def test_api_json_handles_post_and_remote_error_codes(client, monkeypatch):
    response = MagicMock()
    response.read.return_value = b'{"retcode": 0, "data": {"tag": "1.2.3"}}'
    request = MagicMock(return_value=response)
    monkeypatch.setattr(api.request, "urlopen", request)
    client.load_cached_api_file("post.json", "https://example.invalid", POST_data=b"query")
    assert request.call_args.args[0].data == b"query"
    assert client.load_or_download_json("post.json", "https://example.invalid") == {"tag": "1.2.3"}
    (api.OPT.tempdir / "post.json").write_text(json.dumps({"retcode": 5, "message": "denied"}))
    with pytest.raises(AssertionError, match="denied"):
        client.load_or_download_json("post.json", "https://example.invalid")


@pytest.mark.parametrize("config,anchor,expected", [
    ("1.0.0", "2.0.0", "1.0.0"), ("3.0.0", "2.0.0", "2.0.0"),
    ("2.0.0", "2.0.0", "2.0.0"),
])
def test_version_anchor_uses_the_older_config_or_game_version(client, config, anchor, expected):
    (api.OPT.gamedir / "config.ini").write_text(f"game_version={config}")
    client.installed_ver = anchor
    client.check_config_ini()
    assert client.installed_ver == expected


def test_invalid_or_missing_config_does_not_change_the_anchor(client):
    client.installed_ver = "1.0.0"
    client.check_config_ini()
    (api.OPT.gamedir / "config.ini").write_text("invalid")
    client.check_config_ini()
    assert client.installed_ver == "1.0.0"


def test_voiceover_discovery_requires_full_packs(client):
    client.gamedatadir = "Data"
    names = list(api.VOICEOVERS_LUT)[:2]
    language = api.OPT.gamedir / "Data/Persistent/audio_lang_14"
    language.parent.mkdir(parents=True)
    language.write_text("\nunknown\n" + "\n".join(names))
    for index, name in enumerate(names):
        folder = api.OPT.gamedir / "Data/StreamingAssets/AudioAssets" / name
        folder.mkdir(parents=True)
        for number in range(10 if index == 0 else 2):
            (folder / f"{number}.pck").write_bytes(b"data")
    assert client.get_voiceover_packs() == {api.VOICEOVERS_LUT[names[0]]["short"]}


def test_voiceover_meta_writes_only_known_sorted_languages(client, monkeypatch):
    client.gamedatadir = "Data"
    monkeypatch.setattr(client, "_get_gamedatadir", lambda: None)
    names = list(api.VOICEOVERS_LUT)[:2]
    for name in [*names, "Unknown"]:
        (api.OPT.gamedir / f"Audio_{name}_pkg_version").touch()
    client.update_voiceover_meta_file()
    meta = api.OPT.gamedir / "Data/Persistent/audio_lang_14"
    assert meta.read_text().splitlines() == sorted(names)
    meta.unlink()
    api.OPT.dry_run = True
    client.update_voiceover_meta_file()
    assert not meta.exists()


def test_install_version_is_committed_only_after_quick_integrity_check(client):
    config = api.OPT.gamedir / "config.ini"
    config.write_text("game_version=1.0.0")
    (api.OPT.gamedir / "data.bin").write_bytes(b"abc")
    client.di_chunks = SimpleNamespace(
        getBuild_json={"data": {"tag": "2.0.0"}},
        manifest=SimpleNamespace(files=[SimpleNamespace(filename="data.bin", size=3, flags=0), SimpleNamespace(flags=64)]),
    )
    client.update_config_ini_version()
    assert config.read_text() == "game_version=2.0.0"


def test_version_dry_run_preserves_config_contents(client):
    config = api.OPT.gamedir / "config.ini"
    config.write_text("game_version=1.0.0")
    api.OPT.dry_run = True
    client.di_chunks = SimpleNamespace(getBuild_json={"data": {"tag": "2.0.0"}}, manifest=SimpleNamespace(files=[]))
    client.update_config_ini_version()
    assert config.read_text() == "game_version=1.0.0"
