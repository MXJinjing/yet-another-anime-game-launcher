# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>
"""Differential patch preparation, application and cleanup."""
from __future__ import annotations

from . import runtime
from infrastructure.errors import TaskCancelledError
import manifest_ldiff_pb2
import pathlib
import shutil
from .logging import abortlog, debuglog, infolog, warnlog
from .files import bytes_to_MiB, file_matches, file_md5, filename_safety_check, try_get_file_size
from .runtime import force_memory_release, gamedir, tempdir
from .control import raise_if_cancelled, wait_if_paused

class PatchMixin:
	def get_ldiff_patchinfo(self, v) -> manifest_ldiff_pb2.PatchInfo:
		"""
		Helper function. Find the patch file for our installed binary

		May return `None` if the file has not been changed.
		"""
		pinfo: manifest_ldiff_pb2.PatchInfo = None
		for w in v.patches:
			if w.key == self.installed_ver:
				pinfo = w.info
				break

		return pinfo

	def remaining_ldiff_download_size(self, ldiff_dir: pathlib.Path, pinfo) -> int:
		filename_safety_check(pinfo.patch_id)
		ldiffname = ldiff_dir / pinfo.patch_id
		if try_get_file_size(ldiffname) == pinfo.patch_size:
			return 0
		cached = try_get_file_size(pathlib.Path(f"{ldiffname}_tmp"))
		return pinfo.patch_size - cached if 0 <= cached <= pinfo.patch_size else pinfo.patch_size


	def _download_ldiff_file(self, ldiff_dir: pathlib.Path, v: manifest_ldiff_pb2.DiffFileInfo, progress_handler = None, cancel_event = None, pause_event = None):
		"""
		Helper function to download one diff file.

		Returns the patch file name on success, else None.
		"""
		if progress_handler:
			progress_handler.ldiff_download_start(v.filename)

		if len(v.patches) == 0:
			# These will be downloaded by chunks.
			fn = pathlib.Path(v.filename).name
			debuglog(f"File '{fn}' has no patches. Need to download by chunks.")
			if progress_handler:
				progress_handler.ldiff_download_skipped(v.filename, "no file")
			self.new_files_to_download.add(v.filename)
			return None

		if runtime.OPT.TESTING_FILE:
			if not (runtime.OPT.TESTING_FILE in v.filename):
				return None
			else:
				print("ENTER TO DOWNLOAD: ", v.filename)
				input()

		filename_safety_check(v.filename)

		# Find the patch file for our installed binary
		pinfo = self.get_ldiff_patchinfo(v)
		if not pinfo:
			if progress_handler:
				progress_handler.ldiff_download_skipped(v.filename, "not modified")
			return None # The file was not modified in the new version
		if progress_handler:
			progress_handler.ldiff_download_start(v.filename, self.remaining_ldiff_download_size(ldiff_dir, pinfo))

		# Old and new files can have the same size. Verify their content before
		# reusing a patch, both during pre-download and during the real update.
		gamefile = gamedir(v.filename)
		gamefilesize = try_get_file_size(gamefile)
		md5 = file_md5(gamefile, progress_callback=progress_handler.processing_file_bytes if progress_handler else None, cancel_event=cancel_event) if gamefilesize >= 0 else None
		if gamefilesize == v.size and md5 == v.hash:
			if progress_handler:
				progress_handler.ldiff_download_skipped(v.filename, "already updated")
			return None
		if gamefilesize != pinfo.original_size or md5 != pinfo.original_hash:
			if runtime.OPT.predownload:
				abortlog(
					f"Cannot pre-download {v.filename}: installed file does not match "
					"the official source checksum. Run Check Game Integrity first."
				)
			if progress_handler:
				progress_handler.ldiff_download_skipped(v.filename, "file corrupt")
			warnlog(f"Source file differs from the patch manifest: {v.filename}. Downloading full file.")
			self.new_files_to_download.add(v.filename)
			return None

		ldiffname = ldiff_dir.joinpath(pinfo.patch_id)

		if try_get_file_size(ldiffname) == pinfo.patch_size:
			# Already downloaded. Skip.
			# TODO: do a proper hash check
			if progress_handler:
				progress_handler.ldiff_download_skipped(v.filename, "already present")
			debuglog(f"Diff '{ldiffname.name}' is already present. Skipping download.")
			return ldiffname.name

		tmp_file = pathlib.Path(f"{ldiffname}_tmp")

		size_mib = bytes_to_MiB(pinfo.patch_size)
		infolog(f"Downloading diff for '{v.filename}', {size_mib} MiB\n"
		        f"\t -> {pinfo.patch_id}"
		        )

		if runtime.OPT.disallow_download:
			warnlog(f"NOT downloading diff for {ldiffname.name}")
			return None

		try:
			DIFF_URL_PREFIX = self.di_diffs.category_json["diff_download"]["url_prefix"]
			wait_if_paused(pause_event, cancel_event)
			self._download_file_resume(
				DIFF_URL_PREFIX + "/" + pinfo.patch_id,
				tmp_file,
				pinfo.patch_size,
				cancel_event=cancel_event,
				pause_event=pause_event,
				progress_callback=(
					lambda byte_count: progress_handler.ldiff_transfer_progress(
						v.filename, byte_count, pinfo.patch_size,
					)
					if progress_handler else None
				),
			)
			raise_if_cancelled(cancel_event)
			if tmp_file.stat().st_size != pinfo.patch_size:
				raise RuntimeError("Corrupted patch download")
		except TaskCancelledError:
			raise
		except (OSError, RuntimeError) as error:
			# Pre-download must remain incomplete. A real update can recover
			# using chunks even when its diff is unavailable.
			if runtime.OPT.predownload:
				raise
			tmp_file.unlink(True)
			if progress_handler:
				progress_handler.ldiff_download_error(v.filename, str(error))
			warnlog(f"Cannot download diff for {v.filename}: {error}. Downloading full file.")
			self.new_files_to_download.add(v.filename)
			return None
		debuglog("Download done")

		# Move to original ldiff file name (without _tmp)
		# This does not need special dry-run handling (game files are not affected)
		shutil.move(tmp_file, ldiffname)
		if progress_handler:
			progress_handler.ldiff_download_complete(v.filename, pinfo.patch_size)
		return ldiffname.name


	def _apply_ldiff_file(self, ldiff_dir: pathlib.Path, v: manifest_ldiff_pb2.DiffFileInfo, progress_handler = None, cancel_event = None):
		"""
		Helper function to apply one diff file.
		"""

		assert (not runtime.OPT.predownload or runtime.OPT.TESTING_FILE), "Not allowed for pre-downloads."
		assert not (v.filename in self.new_files_to_download), "invalid script usage"

		if runtime.OPT.TESTING_FILE and not (runtime.OPT.TESTING_FILE in v.filename):
			return

		filename_safety_check(v.filename)

		# Find the patch file for our installed binary
		pinfo = self.get_ldiff_patchinfo(v)
		if not pinfo:
			return

		gamefile = gamedir(v.filename)
		# The file may have changed since pre-download or since the diff was
		# selected. Do not feed such a file to hpatchz.
		gamefilesize = try_get_file_size(gamefile)
		md5 = file_md5(gamefile, progress_callback=progress_handler.processing_file_bytes if progress_handler else None, cancel_event=cancel_event) if gamefilesize >= 0 else None
		if gamefilesize == v.size and md5 == v.hash:
			return True
		if gamefilesize != pinfo.original_size or md5 != pinfo.original_hash:
			self.new_files_to_download.add(v.filename)
			return False

		# Patched file goes into the temporary directory (at first)
		dstfile = tempdir("patches", v.filename)
		dstfile.parent.mkdir(parents=True, exist_ok=True)
		dstfile.unlink(True)  # remove any existing duplicate temporary file

		ldiffname = ldiff_dir.joinpath(pinfo.patch_id)

		if not ldiffname.is_file():
			if progress_handler:
				progress_handler.ldiff_patch_error(v.filename, "diff file missing")
			self.new_files_to_download.add(v.filename)
			return False

		try:
			raise_if_cancelled(cancel_event)
			if progress_handler:
				progress_handler.processing_file_bytes(0, 0)
			done = runtime.hpatchz_patch_file(
				gamefile,
				dstfile,
				ldiffname,
				pinfo.patch_offset,
				pinfo.patch_length,
				cancel_event=cancel_event,
				progress_callback=progress_handler.processing_heartbeat if progress_handler else None,
			)
			if not done:
				done = runtime.hpatchz_patch_file(
					gamefile, dstfile, ldiffname, pinfo.patch_offset,
					pinfo.patch_length, 300, cancel_event=cancel_event,
					progress_callback=progress_handler.processing_heartbeat if progress_handler else None,
				)
			if not done or not file_matches(dstfile, v.size, v.hash, progress_callback=progress_handler.processing_file_bytes if progress_handler else None, cancel_event=cancel_event):
				raise RuntimeError("patched file checksum failed")
		except TaskCancelledError:
			dstfile.unlink(True)
			raise
		except (OSError, RuntimeError, AssertionError) as error:
			dstfile.unlink(True)
			if progress_handler:
				progress_handler.ldiff_patch_error(v.filename, str(error))
			warnlog(f"Cannot patch {v.filename}: {error}. Downloading full file.")
			self.new_files_to_download.add(v.filename)
			return False
		infolog(f"Patched file {v.filename}")

		# Replace the game install file
		if runtime.OPT.dry_run:
			infolog(f"[move patched '{dstfile.name}' -> game dir]")
			return True

		raise_if_cancelled(cancel_event)
		shutil.move(dstfile, gamefile)
		return True


	def apply_or_prepare_ldiff_files(self, progress_handler = None, cancel_event = None, pause_event = None):
		"""
		Downloads the ldiff files and patches the destination file if not predownload.
		Requires self.load_manifest(CATEGORY)
		"""
		self.ldiff_manifest_required()

		assert len(self.new_files_to_download) == 0, "List must be empty!"

		ldiff_dir = gamedir("ldiff")
		ldiff_dir.mkdir(exist_ok=True)

		# Sum up the entire download size
		download_sizes_checked = set() # values: patchname
		download_size_total = 0
		for v in self.di_diffs.manifest.files:
			pinfo = self.get_ldiff_patchinfo(v)
			if not pinfo:
				continue
			if pinfo.patch_id in download_sizes_checked:
				continue

			download_sizes_checked.add(pinfo.patch_id)
			download_size_total += self.remaining_ldiff_download_size(ldiff_dir, pinfo)
		infolog(f"Downloading ldiff files (up to {bytes_to_MiB(download_size_total)} MiB) ...")
		if progress_handler:
			progress_handler.ldiff_download_summary(
				total_files=len(self.di_diffs.manifest.files),
				total_size=download_size_total,
			)
		del download_sizes_checked
		del download_size_total

		# Not accurate when there are too many new files (chunks)
		files_total = len(self.di_diffs.manifest.files)
		files_done = 0

		what_txt = " and patched" if runtime.OPT.predownload else ""

		checked = set()
		# Loop through the file list and download what's missing
		for v in self.di_diffs.manifest.files:
			# TODO: Download one file an apply the patches to all files that make use of it
			# Motivation: less space consumption by temporary files

			wait_if_paused(pause_event, cancel_event)
			if progress_handler:
				progress_handler.processing_start("patching", v.filename, files_done, files_total)
			downloaded = self._download_ldiff_file(
				ldiff_dir,
				v,
				progress_handler=progress_handler,
				cancel_event=cancel_event,
				pause_event=pause_event,
			)
			if runtime.RUN_MEMORY_HACK:
				force_memory_release()
			if downloaded:
				self.ldiff_files_to_remove.add(downloaded)
				if not runtime.OPT.predownload:
					# Normal case: update the file
					if progress_handler:
						progress_handler.ldiff_patch_start(v.filename)
					patched = self._apply_ldiff_file(
						ldiff_dir,
						v,
						progress_handler=progress_handler,
						cancel_event=cancel_event,
					)
					if patched and progress_handler:
						progress_handler.ldiff_patch_complete(v.filename)
					if runtime.RUN_MEMORY_HACK:
						force_memory_release()
				elif runtime.OPT.TESTING_FILE and (runtime.OPT.TESTING_FILE in v.filename):
					# Allow patching individual files beforehand
					warnlog(f"ENTER TO APPLY PATCH (will create backup file): ", runtime.OPT.TESTING_FILE)
					input()
					gamefile = gamedir(v.filename)
					shutil.copy2(gamefile, f"{gamefile}.bak")
					self._apply_ldiff_file(ldiff_dir, v)

			files_done += 1
			if progress_handler:
				progress_handler.processing_complete()
			relname = pathlib.Path(v.filename).name
			infolog(f"Progress: {files_done} / {files_total} files | Downloaded: {relname}", end="\r")
			if files_done % 100 == 0:
				print("")
		infolog("\nFiles downloaded" + what_txt + ".") # keep the last "100 %" line

	# Note: the downloaded ldiff files are removed by `self.remove_ldiff_files`


	def process_deletefiles(self, progress_handler = None):
		"""
		[Update only] Remove old files
		"""
		self.ldiff_manifest_required()
		assert not runtime.OPT.predownload, "Not allowed for pre-downloads."

		# Default to empty list in case there are no files to delete.
		deletelist: manifest_ldiff_pb2.PatchInfo = []
		for v in self.di_diffs.manifest.files_delete:
			if v.key == self.installed_ver:
				deletelist = v.info.list

		infolog(f"Deleting {len(deletelist)} old files ...")
		if progress_handler:
			progress_handler.delete_file_summary(
				total_files=len(deletelist)
			)

		for v in deletelist:
			filename_safety_check(v.filename)
			gamefile = gamedir(v.filename)

			if not gamefile.is_file():
				continue

			# Remove the file
			if runtime.OPT.dry_run:
				infolog(f"[delete old file {v.filename}]")
				continue

			infolog(f"Deleted old file: {v.filename}")
			if progress_handler:
				progress_handler.delete_file(v.filename)
			gamefile.unlink() # remove


	def remove_ldiff_files(self, progress_handler = None):
		"""
		[Update only] Removes all downloaded ldiff files
		"""
		self.ldiff_manifest_required()
		assert not runtime.OPT.predownload, "Not allowed for pre-downloads."

		ldiff_dir = gamedir("ldiff")
		if not ldiff_dir.is_dir():
			warnlog(f"Directory {ldiff_dir} not found. Cannot cleanup.")
			return

		count = 0
		# TODO: This does not remove all files downloaded by the official launcher
		# because it also downloads new files. How can those be applied?
		if progress_handler:
			progress_handler.delete_file_summary(
				total_files=len(self.ldiff_files_to_remove),
				ldiff=True
			)
		for v in self.ldiff_files_to_remove:
			filename : pathlib.Path = ldiff_dir.joinpath(v)
			if not filename.is_file():
				if progress_handler:
					progress_handler.delete_file(filename.name, ldiff=True)
				continue

			count += 1
			if runtime.OPT.dry_run:
				infolog(f"[remove now unused ldiff '{v}']")
				continue

			filename.unlink() # delete
			if progress_handler:
				progress_handler.delete_file(filename.name, ldiff=True)
		infolog(f"Cleaned up {count} now unused ldiff files.")
