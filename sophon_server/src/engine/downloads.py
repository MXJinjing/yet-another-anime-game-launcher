# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>
"""Resumable transfers and verified chunk assembly."""
from __future__ import annotations

from . import runtime
from infrastructure.errors import TaskCancelledError
from io import BytesIO
import concurrent.futures
import manifest_pb2
import pathlib
import pycurl
import shutil
import time
import zstandard
from .logging import abortlog, debuglog, infolog, warnlog
from .files import bytes_to_MiB, file_matches, file_md5, filename_safety_check, try_get_file_size
from .runtime import force_memory_release, gamedir, tempdir
from .control import raise_if_cancelled, wait_if_paused

class DownloadMixin:
	def _chunk_cache_path(self, chunk_id):
		directory = getattr(self, "_history_chunk_directory", None)
		if directory is None:
			return tempdir(chunk_id)
		directory.mkdir(parents=True, exist_ok=True)
		return directory / chunk_id

	def remaining_chunk_download_size(self, file_info, **hash_options) -> int:
		"""Compressed bytes still needed from the network for one file."""
		filename_safety_check(file_info.filename)
		if file_info.flags == 64:
			return 0
		filename = pathlib.Path(file_info.filename)
		if file_matches(gamedir(filename), file_info.size, file_info.md5, **hash_options):
			return 0
		if file_matches(tempdir("files", filename), file_info.size, file_info.md5, **hash_options):
			return 0
		remaining = 0
		for chunk in file_info.chunks:
			cached = try_get_file_size(self._chunk_cache_path(chunk.chunk_id))
			remaining += chunk.compressed_size - cached if 0 <= cached <= chunk.compressed_size else chunk.compressed_size
		return remaining

	def get_chunk_download_size(self, filter_by_new: bool, progress_handler=None, cancel_event=None, pause_event=None) -> int:
		"""Inspect reusable files and report the work before downloading."""
		files = [v for v in self.di_chunks.manifest.files
		         if not filter_by_new or v.filename in self.new_files_to_download]
		total = 0
		for index, info in enumerate(files):
			wait_if_paused(pause_event, cancel_event)
			options = {}
			if progress_handler:
				progress_handler.processing_start("calculating_download", info.filename, index, len(files))
				options = dict(progress_callback=progress_handler.processing_file_bytes,
				               cancel_event=cancel_event, pause_event=pause_event)
			total += self.remaining_chunk_download_size(info, **options)
			if progress_handler:
				progress_handler.processing_complete()
		return total


	def _download_file_resume(self, url: str, dstfile: pathlib.Path, dstsize: int, cancel_event = None, pause_event = None, progress_callback = None):
		raise_if_cancelled(cancel_event)
		filesize = try_get_file_size(dstfile)
		if filesize > dstsize:
			if runtime.OPT.dry_run:
				warnlog(f"[remove corrupted file '{dstfile.name}'")
			else:
				warnlog(f"Removing corrupted file: {dstfile.name}")
				dstfile.unlink()
				filesize = 0
		if filesize == dstsize:
			return

		errCnt = 0
		errLogs = []
		while True: # run up to 5 times
			raise_if_cancelled(cancel_event)
			buffer = BytesIO()
			c = pycurl.Curl()
			c.setopt(c.URL, url)
			if filesize > 0:
				c.setopt(c.RANGE, f"{filesize}-")
			def write_callback(data):
				wait_if_paused(pause_event, cancel_event)
				runtime.limiter.acquire(
					len(data),
					cancel_event=cancel_event,
					pause_event=pause_event,
				)
				wait_if_paused(pause_event, cancel_event)
				buffer.write(data)
				if progress_callback:
					progress_callback(len(data))
				return len(data)

			c.setopt(c.WRITEFUNCTION, write_callback)

			response_code = None
			try:
				c.perform()
				response_code = c.getinfo(c.RESPONSE_CODE)

				if response_code == 416:
					# 416: Out of range. Our _tmp file is already complete.
					infolog(f"File '{dstfile.name}' is already downloaded.")
					return

				break
			except TaskCancelledError:
				raise
			except pycurl.error as e:
				if progress_callback and buffer.tell() > 0:
					progress_callback(-buffer.tell())
				raise_if_cancelled(cancel_event)
				errno, errstr = e.args
				errCnt += 1
				errLogs.append(f"Error {errno}: {errstr}")
				if errCnt >= 5:
					abortlog(f"Cannot download file '{dstfile.name}': " + ", ".join(errLogs))
				else:
					warnlog(f"Error {errno}: {errstr}. Retrying ({errCnt}/5)...")
					if cancel_event and cancel_event.wait(10):
						raise TaskCancelledError("cancelled")
					elif cancel_event is None:
						time.sleep(10)
			finally:
				c.close()

		raise_if_cancelled(cancel_event)
		with dstfile.open("ab") as fh:
			fh.write(buffer.getvalue())

	def download_game_file(self, file_info: manifest_pb2.FileInfo, install_progress_handler = None, cancel_event = None, pause_event = None):
		"""
		Downloads the chunks and patches a file
		file_info: FileInfo, one of the manifest.files[] objects

		Returns `True` if the file is (now) present.
		"""

		total_download_bytes = self.remaining_chunk_download_size(file_info)
		if install_progress_handler:
			install_progress_handler.file_download_start(file_info.filename, total_download_bytes)

		if file_info.flags == 64:
			# Created as soon a file is put inside
			infolog(f"Skipping directory entry: {file_info.filename}")
			if install_progress_handler:
				install_progress_handler.file_download_skipped(file_info.filename, "directory")
			return False
		assert (file_info.flags == 0), f"Unknown flags {file_info.flags} for '{file_info.filename}'"

		if runtime.OPT.TESTING_FILE and not (runtime.OPT.TESTING_FILE in file_info.filename):
			return True

		filename_safety_check(file_info.filename)
		filename = pathlib.Path(file_info.filename) # "UnityGame_Data/Subdirectory/file.txt"

		# A matching size alone does not make an existing file safe to reuse.
		if file_matches(gamedir(filename), file_info.size, file_info.md5):
			if install_progress_handler:
				install_progress_handler.file_download_skipped(file_info.filename, "exists")
			#infolog(f"File '{filename.name}' already exists. ")
			return True

		CHUNK_URL_PREFIX = self.di_chunks.category_json["chunk_download"]["url_prefix"]

		# Inform the user
		size_mib = bytes_to_MiB(file_info.size)
		infolog(f"Downloading '{filename.name}', {size_mib} MiB, {len(file_info.chunks)} chunks")
		if install_progress_handler:
			install_progress_handler.chunk_download_progress(file_info.filename, len(file_info.chunks), 0, 0.0, 0, file_info.size, 0)

		if runtime.OPT.disallow_download:
			warnlog(f"NOT downloading chunks for {filename.name}")
			return

		# Download to the temporary directory. Move after we're done.
		dstfile = tempdir("files", filename)
		dstfile.parent.mkdir(parents=True, exist_ok=True)
		bytes_written = 0

		while True: # run once
			if try_get_file_size(dstfile) == file_info.size:
				# A completed staging file may be reused only after verification.
				if file_md5(dstfile) == file_info.md5:
					break
				dstfile.unlink()

			with dstfile.open("wb") as fh:
				# Download all chunks. Closing this handle before integrity
				# verification also flushes every decompressed write to disk.
				for chunk in file_info.chunks:
					wait_if_paused(pause_event, cancel_event)
					cfname = self._chunk_cache_path(chunk.chunk_id) # compressed file path

					if chunk.offset != bytes_written:
						warnlog("\t Unexpected offset. Seek may fail.")

					# Download chunk if not already done
					self._download_file_resume(
						CHUNK_URL_PREFIX + "/" + chunk.chunk_id,
						cfname,
						chunk.compressed_size,
						cancel_event=cancel_event,
						pause_event=pause_event,
						progress_callback=(
							lambda byte_count: install_progress_handler.file_transfer_progress(
								file_info.filename,
								byte_count,
								total_download_bytes,
							)
							if install_progress_handler else None
						),
					)

					# Write chunk to file
					try:
						with cfname.open("rb") as zfh:
							reader = zstandard.ZstdDecompressor().stream_reader(zfh)
							data = reader.read()
					except zstandard.ZstdError:
						cfname.unlink(True)
						raise
					fh.seek(chunk.offset)
					fh.write(data)
					bytes_written += len(data)

					debuglog(f"\t Progress: {(bytes_written * 100 / file_info.size):2.0f} % | "
					         + f" {bytes_to_MiB(bytes_written)} / {size_mib} MiB", end="\r")
					if install_progress_handler:
						install_progress_handler.chunk_download_progress(
							file_info.filename, len(file_info.chunks), chunk.chunk_id, bytes_written * 100 / file_info.size, bytes_written, file_info.size, chunk.compressed_size)
					del data, reader, zfh, cfname

					if runtime.RUN_MEMORY_HACK:
						force_memory_release()
			print("") # Keep the last "100 %" line

		# Verify file integrity
		md5 = file_md5(dstfile)
		if file_info.md5 == md5:
			infolog("\t File is correct (md5 check)")
		else:
			dstfile.unlink() # delete
			for chunk in file_info.chunks:
				self._chunk_cache_path(chunk.chunk_id).unlink(True)
			abortlog(f"\t File is corrupt after download: {filename.name}. Please retry.")

		if runtime.RUN_MEMORY_HACK:
			force_memory_release()

		# Remove chunks after downloading
		for chunk in file_info.chunks:
			self._chunk_cache_path(chunk.chunk_id).unlink(True)

		# Move the completed files to the game directory
		if runtime.OPT.dry_run:
			infolog(f"[move new '{filename.name}' -> game dir]")
			return True
		gamefile = gamedir(filename).resolve()
		gamefile.parent.mkdir(parents=True, exist_ok=True)
		shutil.move(dstfile, gamefile)
		if install_progress_handler:
			install_progress_handler.file_download_complete(file_info.filename, file_info.size)
		return True


	def diff_download_new_files(self, progress_handler = None, cancel_event = None, pause_event = None):
		"""
		[Update/repair only] Downloads files that were added in the new version.
		"""

		if runtime.OPT.predownload:
			infolog("New files download is DISABLED for predownloads!")
			self.new_files_to_download.clear()
			return

		download_size_total = self.get_chunk_download_size(True, progress_handler=progress_handler, cancel_event=cancel_event, pause_event=pause_event)
		infolog(f"New files to download: {len(self.new_files_to_download)} files\n")
		infolog(f"Downloading newly added files (up to {bytes_to_MiB(download_size_total)} MiB) ...")
		if progress_handler:
			progress_handler.download_summary(
				game_version = self.di_chunks.getBuild_json["data"]["tag"],
				download_size = download_size_total,
				download_file_count = len(self.new_files_to_download),
				download_categories = [ "game" ]
			)
		del download_size_total

		# Not accurate when there are too many new files (chunks)
		files_total = len(self.new_files_to_download)
		files_done = 0

		def download_file(v):
			err_cnt = 0
			err_logs = []
			while err_cnt < 5:
				try:
					wait_if_paused(pause_event, cancel_event)
					self.download_game_file(
						v, install_progress_handler=progress_handler,
						cancel_event=cancel_event, pause_event=pause_event,
					)
					break
				except TaskCancelledError:
					raise
				except Exception as e:
					err_cnt += 1
					err_logs.append(str(e))
			if err_cnt == 5:
				raise RuntimeError(f"Download file {v.filename} failed after 5 attempts: {err_logs}")

		with concurrent.futures.ThreadPoolExecutor(max_workers=runtime.WORKER_CNT) as executor:
			repair_files = [v for v in self.di_chunks.manifest.files if v.filename in self.new_files_to_download]
			missing = self.new_files_to_download - {v.filename for v in repair_files}
			if missing:
				abortlog(f"Files missing from target manifest: {sorted(missing)}")
			futures = [executor.submit(download_file, v) for v in repair_files]
			for future in concurrent.futures.as_completed(futures):
				future.result()

		infolog("Download complete.")
		self.new_files_to_download.clear()
