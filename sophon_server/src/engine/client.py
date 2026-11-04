# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>
"""Client initialization and installed-game metadata."""
from __future__ import annotations

from . import runtime
from typing import Literal, Optional
import manifest_ldiff_pb2
import pathlib
import re
import shutil
from .runtime import DownloadInfo, Options, SCRIPTDIR, VOICEOVERS_LUT, gamedir
from .logging import abortlog, debuglog, infolog, warnlog
from .files import cmp_versions, get_game_version, try_get_file_size
from .metadata import ManifestMixin
from .downloads import DownloadMixin
from .patches import PatchMixin
from .repair import RepairMixin

class SophonClient(ManifestMixin, DownloadMixin, PatchMixin, RepairMixin):
	installed_ver: None  # "major.minor.patch" or "new" for new installations
	rel_type: str | None = None  # os / cn / bb
	game_type: Literal["hk4e", "nap"] | None = None  # hk4e / nap
	gamedatadir: str | None= None # "*_Data"
	branch: str          # main / pre_download
	branches_json = None # package_id, password, tag

	# chunks: For files to download from scratch
	# diffs:  For files to update by patching or removal
	di_chunks = DownloadInfo()
	di_diffs  = DownloadInfo()

	new_files_to_download = set() # Update only. Relative file name
	ldiff_files_to_remove = set() # Update only. File name (no path)

	def __init__(self):
		# Downloads may run in separate tasks; their manifests and work queues
		# must not leak into one another.
		self.di_chunks = DownloadInfo()
		self.di_diffs = DownloadInfo()
		self.new_files_to_download = set()
		self.ldiff_files_to_remove = set()
		self.branches_json = None


	def initialize(self, opts: Options):
		runtime.OPT = opts

		self.di_chunks.name = "[chunks]"
		self.di_diffs.name  = "[diffs]"

		if runtime.OPT.install_reltype:
			runtime.OPT.do_install = True
			self.rel_type = runtime.OPT.install_reltype

		if runtime.OPT.game_type:
			assert runtime.OPT.game_type in ["hk4e", "nap"], "Unknown game type. Must be 'hk4e' or 'nap'."
			self.game_type = runtime.OPT.game_type

		if runtime.OPT.do_install + runtime.OPT.do_update + isinstance(runtime.OPT.repair_mode, str) > 1:
			abortlog("Do either install, update or repair!")

		assert runtime.OPT.gamedir != None, "Game directory not specified."

		self.branch = "pre_download" if runtime.OPT.predownload else "main"
		infolog(f"Selected branch '{self.branch}'")

		if runtime.OPT.dry_run:
			infolog("Simulation mode is enabled.")

		# Autodetection
		if runtime.OPT.do_install:
			self._initialize_install()
		if runtime.OPT.do_update or runtime.OPT.repair_mode:
			self._initialize_update()

		runtime.OPT.tempdir.mkdir(exist_ok=True)

		if not runtime.OPT.gamedir.is_dir():
			abortlog("Game directory does not exist.")


	def _initialize_install(self):
		self.installed_ver = None

		runtime.OPT.gamedir.mkdir(exist_ok=True)
		if not runtime.OPT.ignore_conditions:
			# must be empty (allow config.ini)
			assert len(list(runtime.OPT.gamedir.glob("*"))) < 2, "The specified install path is not empty"

		# Create "config.ini"
		templates = {}
		if runtime.OPT.game_type == "hk4e":
			templates = {
				"os": "[General]\r\nchannel=1\r\ncps=mihoyo\r\ngame_version=0.0.0\r\nsdk_version=\r\nsub_channel=0\r\n",
				"cn": "[General]\r\nchannel=1\r\ncps=mihoyo\r\ngame_version=0.0.0\r\nsdk_version=\r\nsub_channel=1\r\n",
				"bb": "[General]\r\nchannel=14\r\ncps=bilibili\r\ngame_version=0.0.0\r\nsdk_version=\r\nsub_channel=0\r\n"
			}
		elif runtime.OPT.game_type == "nap":
			templates = {
				"os": "[General]\r\nchannel=1\r\ncps=mihoyo\r\ngame_version=0.0.0\r\nsdk_version=\r\nsub_channel=0\r\n",
				"cn": "[General]\r\nchannel=1\r\ncps=mihoyo\r\ngame_version=0.0.0\r\nsdk_version=\r\nsub_channel=1\r\n",
			}
		assert templates[self.rel_type], "Unknown reltype"
		with gamedir("config.ini").open("w") as fh:
			fh.write(templates[self.rel_type])
		infolog("Created config.ini")


	def _get_gamedatadir(self):
		# Absolute path to the game data directory
		path = next(runtime.OPT.gamedir.glob("*_Data"), None)
		assert path, "Cannot determine game data dir"
		self.gamedatadir = path.name


	def _initialize_update(self):
		"""
		Find out what kind of installation we need to update
		"""
		self._get_gamedatadir()
		if self.game_type == "hk4e":
			if gamedir("GenshinImpact.exe").is_file():
				self.rel_type = "os"
			elif gamedir("YuanShen.exe").is_file():
				if gamedir(self.gamedatadir, "Plugins", "PCGameSDK.dll").is_file():
					self.rel_type = "bb"
				else:
					self.rel_type = "cn"
			if not isinstance(self.rel_type, str):
				abortlog("Failed to detect release type. " \
				         + f"Game executable in '{runtime.OPT.gamedir}' could not be found.")
		elif self.game_type == "nap":
			with open(gamedir("config.ini"), "r") as f:
				contents = f.read()
				if "sub_channel=0" in contents:
					self.rel_type = "os"
				elif "sub_channel=1" in contents:
					self.rel_type = "cn"
			if not isinstance(self.rel_type, str):
				abortlog("Failed to detect release type. " \
				         + f"config.ini in '{runtime.OPT.gamedir}' has wrong information.")

		infolog(f"Release type: {self.rel_type}")

		# Retrieve the installed game version
		if not runtime.OPT.ignore_conditions:
			if self.game_type == "hk4e":
				fullname = gamedir(self.gamedatadir, "globalgamemanagers")
				assert fullname.is_file(), "Game install is incomplete!"

				contents = fullname.read_bytes()
				ver = re.findall(br"\0(\d+\.\d+\.\d+)_\d+_\d+\0", contents)
				assert len(ver) == 1, "Broken script or corrupted game installation"

				self.installed_ver = ver[0].decode("utf-8")
				infolog(f"Installed game version: {self.installed_ver} (anchor 1: globalgamemanagers)")
			elif self.game_type == "nap":
				ver = get_game_version(gamedir(self.gamedatadir), 0xc4)
				assert ver, "Failed to retrieve game version from globalgamemanagers"
				self.installed_ver = ver
		else:
			# Change this if needed
			self.installed_ver = "5.5.0"

		# Compare game version with what's contained in "config.ini"
		self.check_config_ini()


	def check_config_ini(self):
		"""
		Internal function. Picks the version as follows: min(config.ini, globalgamemanagers)
		"""
		fullname = gamedir("config.ini")
		if not fullname.is_file():
			warnlog("config.ini not found")
			return

		contents = fullname.read_text()
		ver = re.findall(r"game_version=(\d+\.\d+\.\d+)", contents)
		if len(ver) != 1:
			warnlog("config.ini is incomplete or corrupt")
			return

		infolog(f"Installed game version: {ver[0]} (anchor 2: config.ini)")
		# config.ini is updated last. Use the older version
		ver_cfg = [int(v) for v in ver[0].split(".")]
		ver_ggm = [int(v) for v in self.installed_ver.split(".")]

		if cmp_versions(ver_cfg, ver_ggm) == 1:
			warnlog("Potential issue: config.ini documents a more recent version!")
			# keep `self.installed_ver` to continue the update if possible
		else:
			# equal version or lower
			self.installed_ver = ver[0]


	def get_voiceover_packs(self):
		"""
		Returns a set of the installed packs: { "en-us", "ja-jp", "ko-kr", "zh-cn" }
		"""

		# This path is also specified in 'getGameConfigs'
		fullname = gamedir(self.gamedatadir, "Persistent/audio_lang_14")

		packs = set()
		for line in fullname.open("r"):
			line = line.strip()
			if line == "":
				continue

			if not (line in VOICEOVERS_LUT):
				warnlog("Unknown voiceover pack in 'audio_lang_14': " + line)
				continue

			mediapath = gamedir(self.gamedatadir, "StreamingAssets/AudioAssets", line)
			num_files = len(list(mediapath.glob("*.*")))
			if num_files < 10:
				# These will be updated after the login screen
				infolog(f"Skipping voiceover pack '{line}': Pack was installed in-game.")
				continue

			packs.add(VOICEOVERS_LUT[line]["short"])

		debuglog("Found voiceover packs:", ", ".join(packs))
		return packs


	def update_voiceover_meta_file(self):
		"""
		[Install only] Auto-detect installed language packs and update audio_lang_14
		"""
		self._get_gamedatadir()

		languages = set()
		filename: pathlib.Path
		for filename in runtime.OPT.gamedir.glob("*"):
			groups = re.findall(r"^Audio_(.+)_pkg_version$", filename.name)
			if len(groups) != 1:
				continue
			longname = groups[0]
			if not (longname in VOICEOVERS_LUT):
				warnlog(f"Unknown voiceover pack '{filename.name}'")
				continue
			languages.add(longname)

		languages = list(languages)
		languages.sort()

		# Update the lang file
		langfile = gamedir(self.gamedatadir, "Persistent/audio_lang_14")
		lang_str = ", ".join(languages)
		if runtime.OPT.dry_run:
			infolog(f"[update lang file: {lang_str}]")
			return

		langfile.parent.mkdir(parents=True, exist_ok=True)
		with langfile.open("w", newline="\r\n") as fh:
			for lang in languages:
				fh.write(lang + "\n")
		infolog(f"Wrote the lang file to contain '{lang_str}'")


	def cleanup_temp(self):
		"""
		Removes all temporary files
		"""

		# DANGER
		if runtime.OPT.tempdir.resolve() in runtime.OPT.gamedir.resolve():
			abortlog("Temp is within the game directory.")
		if runtime.OPT.gamedir.resolve() in runtime.OPT.tempdir.resolve():
			abortlog("Temp is a parent of the game directory.")
		if runtime.OPT.tempdir.resolve() in SCRIPTDIR:
			abortlog("Temp is a parent of this script.")

		assert False
		if runtime.OPT.dry_run:
			info(f"[Delete temp dir '{runtime.OPT.tempdir}']")
			return

		shutil.rmtree(runtime.OPT.tempdir)


	def update_config_ini_version(self):
		"""
		Quick file sanity check + file update after install or update
		"""
		if runtime.OPT.do_install + runtime.OPT.do_update != 1:
			abortlog("Invalid operation")

		confname = gamedir("config.ini")
		contents = confname.read_text()
		ver = re.findall(r"game_version=(\d+\.\d+\.\d+)", contents)
		if len(ver) != 1:
			warnlog("config.ini is incomplete or corrupt")
			return

		infolog("Checking game file integrity (quick) ...")
		# Do not abort in dry run
		error_fn = warnlog if runtime.OPT.dry_run else abortlog
		if runtime.OPT.do_install:
			for v in self.di_chunks.manifest.files:
				if v.flags == 64: # directory
					continue

				if try_get_file_size(gamedir(v.filename)) != v.size:
					error_fn(f"File missing or invalid size: {v.filename}")

		# Similar check after updating
		if runtime.OPT.do_update:
			self.ldiff_manifest_required()

			for v in self.di_diffs.manifest.files:
				if try_get_file_size(gamedir(v.filename)) != v.size:
					error_fn(f"File missing or invalid size: {v.filename}")

			# Check whether all old files are gone
			# Similar to "self.process_deletefiles"

			# Default to empty list in case there are no files to delete.
			deletelist: manifest_ldiff_pb2.PatchInfo = []
			for v in self.di_diffs.manifest.files_delete:
				if v.key == self.installed_ver:
					deletelist = v.info.list

			for v in deletelist:
				if gamedir(v.filename).is_file():
					error_fn(f"Old file still exists: {v.filename}")

		self.installed_ver = self.di_chunks.getBuild_json["data"]["tag"] # "MAJOR.MINOR.PATCH"
		contents = contents.replace(ver[0], self.installed_ver)
		if runtime.OPT.dry_run:
			infolog(f"[update config.ini to {self.installed_ver}]")
			return

		confname.write_text(contents)
		infolog(f"Updated config.ini to {self.installed_ver}")
