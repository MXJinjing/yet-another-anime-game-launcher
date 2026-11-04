# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>
"""Build API and manifest selection."""
from __future__ import annotations

from . import runtime
from google.protobuf.json_format import MessageToJson
import json
import manifest_ldiff_pb2
import manifest_pb2
import time
import urllib.request as request
import zstandard
from .runtime import DownloadInfo, tempdir
from .logging import abortlog, debuglog, infolog, warnlog

class ManifestMixin:
	def load_cached_api_file(self, fname, url, POST_data = None):
		"""
		Cached file download. For JSON (API) files only!

		fname: file name without path prefix
		url:   str or function ptr to retrieve the URL
		Returns: File handle
		"""
		fullname = tempdir(fname)
		do_download = True

		if fullname.is_file():
			# keep cached for 24 hours
			do_download = time.time() - fullname.stat().st_mtime > (24 * 3600)

		if runtime.OPT.force_use_cache:
			do_download = False

		if do_download:
			# Check whether the file is still up-to-date
			if callable(url):
				url = url()

			if POST_data != None:
				req = request.Request(url, data=POST_data)
				resp = request.urlopen(req)
				with fullname.open("wb") as fh:
					fh.write(resp.read())
			else:
				request.urlretrieve(url, fullname)
			debuglog(f"Downloaded new file '{fname}'") #, src={url}")
		else:
			debuglog(f"Loaded existing file '{fname}'")

		return fullname


	def load_or_download_json(self, fname, url):
		path = self.load_cached_api_file(fname, url)
		with path.open("rb") as fh:
			js = json.load(fh)
		ret = js["retcode"]
		assert ret == 0, (f"Failed to retrieve '{fname}': " +
			f"server returned status code {ret} ({js['message']})")
		return js["data"]


	def retrieve_API_keys(self):
		"""
		Retrieves passkeys for authentication to download URLs
		Depends on "initialize_*".
		"""

		assert isinstance(self.rel_type, str), "Missing initialize"

		base_url: str = None
		if self.rel_type == "os":
			base_url = "https://sg-hyp-api.hoy" + "overse.com/hyp/hyp-connect/api"
		else:
			base_url = "https://hyp-api.mih" + "oyo.com/hyp/hyp-connect/api"
			warnlog("CN/BB is yet not tested!")

		game_ids: str = None
		launcher_id: str = None

		assert self.game_type in ["hk4e", "nap", "hkrpg"], "Unknown game type. Must be 'hk4e' or 'nap'."

		if self.rel_type == "os":
			# Up-to-date as of 2024-06-15 (4.7.0)
			if self.game_type == "nap":
				game_ids = "U5hbdsT9W7"
			elif self.game_type == "hk4e":
				game_ids = "gopR6Cufr3"
			elif self.game_type == "hkrpg":
				game_ids = "4ziysqXOQ8"
			launcher_id = "VYTpXlbWo8"
		elif self.rel_type == "cn":
			# From DGP-Studio/Snap.Hutao (GitHub), MIT
			launcher_id = "jGHBHlcOq1"
			if self.game_type == "nap":
				game_ids = "x6znKlJ0xK"
			elif self.game_type == "hk4e":
				game_ids = "1Z8W5NHUQb"
			elif self.game_type == "hkrpg":
				game_ids = "64kMb5iAWu"
		elif self.rel_type == "bb":
			# From DGP-Studio/Snap.Hutao (GitHub), MIT
			assert self.game_type == "hk4e", "Bilibili is only available for 'hk4e' game type"
			launcher_id = "umfgRO5gh5"
			game_ids = "T2S0Gz4Dr2"
		else:
			assert False, "unhandled rel_type"

		tail = f"game_ids[]={game_ids}&launcher_id={launcher_id}"

		if not self.branches_json:
			# MANDATORY. JSON with package_id, password and tag(s)
			js = self.load_or_download_json("getGameBranches.json", f"{base_url}/getGameBranches?{tail}")

			# Array length corresponds to the amount of "game_ids" requested.
			self.branches_json = js["game_branches"][0][self.branch]
			assert self.branches_json is not None, \
				"Cannot find API keys for the selected branch. Maybe retry without pre-download?"

			ver = self.branches_json["tag"]
			infolog(f"Sophon provides game version {ver}")

		if False:  # TODO
			# JSON with game paths for voiceover packs, logs, screenshots
			self.load_cached_api_file("getGameConfigs.json", f"{base_url}/getGameConfigs?{tail}")

		if False:  # TODO
			# JSON with SDK files (BiliBili ?)
			channel = 1
			sub_channel = 0
			self.load_cached_api_file("getGameChannelSDKs.json",
			                          f"{base_url}/getGameChannelSDKs?channel={channel}&{tail}&sub_channel={sub_channel}")


	def make_getBuild_url(self, api_file):
		"""
		Compose the URL for the main JSON file for chunk-based downloads (sophon)
		api_file: 'getPatchBuild' or 'getBuild'
		Returns: URL
		"""
		if not self.branches_json:
			self.retrieve_API_keys()


		url: str = None
		if runtime.OPT.do_update:
			if self.rel_type == "os":
				url = "sg-downloader-api.ho" + "yoverse.com"
			elif self.rel_type == "cn":
				# Unlike the overseas service, the CN service exposes both
				# getBuild (GET) and getPatchBuild (POST) on the public API host.
				url = "api-takumi.mih" + "oyo.com"
		else:
			if self.rel_type == "os":
				url = "sg-public-api.ho" + "yoverse.com"
			elif self.rel_type == "cn":
				url = "api-takumi.mih" + "oyo.com"

		assert not (url is None), f"Unhandled release type {self.rel_type}"

		url = (
				"https://" + url + "/downloader/sophon_chunk/api/" + api_file
				+ "?branch=" + self.branches_json["branch"]
				+ "&package_id=" + self.branches_json["package_id"]
				+ "&password=" + self.branches_json["password"]
		)

		infolog("Created " + api_file + " JSON URL")
		return url


	def get_getBuild_json(self, is_new_file: bool):
		"""
		Returns the main JSON for manifest and chunk/diff information
		is_new_file:
			True:  For new files manifest
			False: For patch files manifest
		"""
		api = "getBuild" if is_new_file else "getPatchBuild"
		path = self.load_cached_api_file(f"{api}.json", lambda : self.make_getBuild_url(api),
		                                 # POST is required for patch
		                                 None if is_new_file else []
		                                 )
		contents = None
		with path.open("rb") as fh:
			contents = json.load(fh)
		debuglog(f"Loaded {api} JSON")
		return contents


	def _select_category(self, dlinfo: DownloadInfo, cat_name):
		"""
		Retrieves the manifest to download the specified category
		Fills in the 'DownloadInfo' values
		"""

		jd = dlinfo.getBuild_json["data"]
		infolog(dlinfo.name, f"Server provides game version {jd['tag']}")

		category = None
		fuzzy_str = ""
		# Precise search
		for jdm in jd["manifests"]:
			if jdm["matching_field"] == cat_name:
				category = jdm
				break

		if not category and not cat_name == "main":
			fuzzy_str = " (fuzzy match)"
			# Fuzzy match
			for jdm in jd["manifests"]:
				if cat_name in jdm["matching_field"]:
					if category:
						abortlog(f"Ambigous category '{cat_name}'")
					category = jdm
			cat_name = category["matching_field"]

		assert not (category is None), f"Cannot find the specified field '{cat_name}'"
		debuglog(dlinfo.name, f"Found category '{cat_name}'" + fuzzy_str)
		dlinfo.category_json = category

		# Download and decompress manifest protobuf
		fname_raw = category["manifest"]["id"]
		url = category["manifest_download"]["url_prefix"] + "/" + category["manifest"]["id"]

		zstd_path = self.load_cached_api_file(fname_raw + ".zstd", url)
		with zstd_path.open('br') as zfh:
			reader = zstandard.ZstdDecompressor().stream_reader(zfh)
			pb = None
			if dlinfo == self.di_diffs:
				pb = manifest_ldiff_pb2.DiffManifest()
			elif dlinfo == self.di_chunks:
				pb = manifest_pb2.Manifest()
			else:
				assert False, "unknown instance"
			pb.ParseFromString(reader.read())
		nfiles = len(pb.files)
		debuglog(dlinfo.name, f"Decompressed manifest protobuf ({nfiles} files)")

		if runtime.EXPORT_JSON_FILES:
			# For development purposes: write the manifest as JSON to a file
			# NOTE: Underscores may be converted to uppercase letters
			json_fname = tempdir(fname_raw + ".json")
			if not json_fname.is_file():
				with json_fname.open("w+") as jfh:
					json.dump(json.loads(MessageToJson(pb)), jfh)
				infolog(dlinfo.name, "Exported protobuf to JSON file")

		dlinfo.manifest = pb


	def load_manifest(self, cat_name):
		"""
		Retrieve information about available patches/chunks for each game version
		cat_name: "game", "en-us", "zh-cn", "ja-jp", "ko-kr"
		"""

		# Always load manifest again
		self.di_chunks.getBuild_json = self.get_getBuild_json(True)

		if runtime.OPT.do_update:
			# Error early.
			if self.installed_ver == self.di_chunks.getBuild_json["data"]["tag"]:
				abortlog("There is no update available.")


		# The rest of the fucking owl
		self._select_category(self.di_chunks, cat_name)

		if runtime.OPT.do_update:
			# Do almost the same thing again
			self.di_diffs.getBuild_json = self.get_getBuild_json(False)

			self._select_category(self.di_diffs, cat_name)


	def ldiff_manifest_required(self):
		assert isinstance(self.di_diffs.manifest, manifest_ldiff_pb2.DiffManifest), \
			"ldiff manifest is missing or invalid"


	def find_chunks_by_file_name(self, file_name):
		"""
		Helper function. Searches a specific file name in the manifest
		Returns: FileInfo or None
		"""
		assert isinstance(file_name, str)
		for v in self.di_chunks.manifest.files:
			if v.filename == file_name:
				return v

		warnlog(f"Cannot find chunks for file: {file_name}")
		return None
