"""Verify region/version URL selection without contacting remote services."""
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from engine import runtime
from engine.client import SophonClient


@pytest.mark.parametrize("region", ["os", "cn", "bb"])
@pytest.mark.parametrize("game", ["hk4e", "nap", "hkrpg"])
def test_branch_lookup_selects_region_and_game(region, game):
    client = SophonClient()
    client.rel_type = region
    client.game_type = game
    client.branch = "main"
    client.branches_json = None
    with patch.object(client, "load_or_download_json", return_value={"game_branches": [{"main": {"tag": "7.2.0"}}]}) as load:
        if region == "bb" and game != "hk4e":
            with pytest.raises(AssertionError): client.retrieve_API_keys()
        else:
            client.retrieve_API_keys()
            assert client.branches_json["tag"] == "7.2.0"
            assert "getGameBranches?game_ids[]=" in load.call_args.args[1]


@pytest.mark.parametrize("region,update,host", [
    ("os", True, "sg-downloader-api"), ("os", False, "sg-public-api"),
    ("cn", True, "api-takumi"), ("cn", False, "api-takumi"),
])
def test_build_urls_keep_branch_package_and_region(region, update, host):
    client = SophonClient()
    client.rel_type = region
    client.branches_json = {"branch": "main", "package_id": "package", "password": "pass"}
    with patch.object(runtime, "OPT", SimpleNamespace(do_update=update)):
        url = client.make_getBuild_url("getPatchBuild")
    assert host in url
    assert url.endswith("?branch=main&package_id=package&password=pass")


def test_manifest_lookup_finds_requested_file_and_reports_missing():
    client = SophonClient()
    client.di_chunks.manifest = SimpleNamespace(files=[SimpleNamespace(filename="one")])
    assert client.find_chunks_by_file_name("one").filename == "one"
    assert client.find_chunks_by_file_name("missing") is None
