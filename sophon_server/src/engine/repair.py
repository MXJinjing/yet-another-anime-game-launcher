# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>
"""Integrity verification and repair scheduling."""
from __future__ import annotations

from . import runtime
import concurrent.futures
import threading
from .logging import abortlog, infolog
from .files import compare_game_versions, file_md5, try_get_file_size
from .runtime import force_memory_release, gamedir
from .control import wait_if_paused

class RepairMixin:
	def repair_by_category(self, cat_name: str, repair_progress_handler = None, cancel_event = None, pause_event = None):
		"""
		Use sophon chunks to restore missing or incorrect files
		`load_manifest` must be used to select the correct category to repair
		"""
		assert not runtime.OPT.predownload, "Not allowed for pre-downloads."

		# Here we can either use the manifest or pkg_version

		self.load_manifest(cat_name)

		target_ver = self.di_chunks.getBuild_json["data"]["tag"]
		version_comparison = compare_game_versions(self.installed_ver, target_ver)
		if version_comparison < 0:
			abortlog(
				f"The installed version requires an update. "
				f"{self.installed_ver} / {target_ver}"
			)
		if version_comparison > 0:
			abortlog(
				f"The installed version is newer than the available repair manifest. "
				f"{self.installed_ver} / {target_ver}"
			)

		self.new_files_to_download.clear()

		reliable_checking = (runtime.OPT.repair_mode == "reliable")
		infolog(f"Repair started. Mode: {reliable_checking}")

		files_checked = 0
		files_total = len(self.di_chunks.manifest.files)

		if repair_progress_handler:
			repair_progress_handler.repair_summary(
				repair_mode=runtime.OPT.repair_mode,
				total_files=files_total
			)
		import threading
		lock = threading.Lock()
		def _verify_file(v):
			wait_if_paused(pause_event, cancel_event)

			reason = None
			gamefile = gamedir(v.filename)
			gamefilesize = try_get_file_size(gamefile)
			if gamefilesize != v.size:
				reason = f"size mismatch. is={gamefilesize}, should={v.size}"
			elif reliable_checking:
				md5 = file_md5(gamefile)
				if md5 != v.md5:
					reason = f"md5 mismatch. is={md5}, should={v.md5}"
				del md5
			del gamefilesize, gamefile

			if runtime.RUN_MEMORY_HACK:
				force_memory_release()

			if repair_progress_handler:
				repair_progress_handler.check_file(
					filename=v.filename,
					requires_repair= (reason is not None),
					reason=reason,
				)

			if not reason:
				return # file is OK

			print("")
			infolog(f"Need to repair file '{v.filename}': " + reason)
			with lock:
				self.new_files_to_download.add(v.filename)

		with concurrent.futures.ThreadPoolExecutor(max_workers=runtime.WORKER_CNT_VERIFY) as executor:
			futures = [
				executor.submit(_verify_file, v) for v in self.di_chunks.manifest.files
			]
			for future in concurrent.futures.as_completed(futures):
				future.result()

		print("") # Keep the last "100 %" line
		self.diff_download_new_files(progress_handler=repair_progress_handler, cancel_event=cancel_event, pause_event=pause_event)
