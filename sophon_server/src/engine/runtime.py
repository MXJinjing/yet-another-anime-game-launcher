# Sophon chunk/diff installer and updater implementation
# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>

"""Shared downloader options and native patch invocation.

The server serializes downloader operations because OPT remains process-global.
SCRIPTDIR deliberately points to src for source and standalone asset discovery.
"""

from __future__ import annotations

import argparse
import gc
import pathlib
import subprocess # for hpatchz (ldiff)
import sys # stdout
import tempfile # patch extraction
import time
from typing import Literal, Optional
from typing import TYPE_CHECKING

import psutil

import manifest_pb2 # generated
import manifest_ldiff_pb2 # generated


from infrastructure.rate_limiter import limiter
from infrastructure.errors import TaskCancelledError
from .logging import warnlog, abortlog
from .control import raise_if_cancelled

if TYPE_CHECKING:
	from os import PathLike

SCRIPTDIR = pathlib.Path(__file__).resolve().parent.parent

# Needed for ldiff; keep the original launcher layouts as fallbacks.
from infrastructure.platform import resolve_hpatchz, memory_relief
HPATCHZ_APP = resolve_hpatchz(SCRIPTDIR)

def force_memory_release():
	gc.collect()
	memory_relief()


# Run only in compiled binary
RUN_MEMORY_HACK = True

# Worker count for multithreaded downloads
WORKER_CNT = 8
# Worker count for verifying files
# Do not use all cpu cores because it causes system slowdown
WORKER_CNT_VERIFY = max(2, (psutil.cpu_count(logical=False) or psutil.cpu_count() or 4) - 4)

# Not needed. Only helpful for development purposes.
EXPORT_JSON_FILES = True


# ------------------- CLI options

class Options(argparse.Namespace):
	gamedir:   pathlib.Path | None = None
	tempdir:   pathlib.Path | None = SCRIPTDIR / "tmp" # cache
	# where to place ldiff files and patched output files
	#outputdir: pathlib.Path | None = SCRIPTDIR / "tmp" / "out"
	force_use_cache: bool = False # True: disallow downloads, False: download if not cached
	predownload: bool = False
	install_reltype: str | None = None
	game_type: Literal["hk4e", "nap"] | None # hk4e or nap
	do_install: bool = False
	do_update: bool = False         # True: ldiff, False: chunks
	repair_mode: str | None = None  # "quick"|"reliable"|None
	dry_run: bool = False           # True: prevents modifying game files
	disallow_download: bool = False # True: prevents media downloads

	# `True` ignores the "empty directory" requirement for installs and skips sanity checks for updates
	ignore_conditions: bool = False
	TESTING_FILE: str | None = None # if != None: only update/download the specified file

	# main() script only
	selected_lang_packs: str = ""

# Cannot be overwritten by other scripts :(
OPT = Options()


# ------------------- Translate between voiceover pack names
VOICEOVERS_LUT = {
	# "Friendly/short": {"short": "aa-bb", "friendly": "Longname"}
	"English(US)": {"short": "en-us"},
	"Japanese":    {"short": "ja-jp"},
	"Korean":      {"short": "ko-kr"},
	"Chinese":     {"short": "zh-cn"}
}
if True:
	keys: list = list(VOICEOVERS_LUT.keys())
	for k in keys:
		v = VOICEOVERS_LUT[k]
		v["friendly"] = k

		# Add reverse lookup for the short version
		VOICEOVERS_LUT[v["short"]] = v


# ------------------- Utilities


def tempdir(*args: str | PathLike[str]) -> pathlib.Path:
	return OPT.tempdir.joinpath(*args)

def gamedir(*args: str | PathLike[str]) -> pathlib.Path:
	return OPT.gamedir.joinpath(*args)


	# exit(1)


def hpatchz_patch_file(oldfile: pathlib.Path, dstfile: pathlib.Path, patchfile: pathlib.Path,
		p_offset: int, p_len: int, timeout: int = 50, cancel_event = None, progress_callback = None):
	"""
	Patches a file, throws an exception upon failure
	One ldiff file may contain multiple patches, thus the offset

	Returns `True` on success, `False` on timeout
	"""

	raise_if_cancelled(cancel_event)
	pfile_in = None   # keep alive until functoin exit

	# Extract the relevant patch section
	# Note: This is also needed if `p_offset == 0`. Unlike other archiver programs or
	# libraries, hpatchz does not allow tailing data.
	pfile_in = patchfile.open("rb")
	pfile_in.seek(p_offset)
	pfile_out = tempfile.NamedTemporaryFile("wb")
	pfile_out.write(pfile_in.read(p_len))
	pfile_out.flush()
	raise_if_cancelled(cancel_event)

	if not HPATCHZ_APP.is_file():
		raise FileNotFoundError(f"hpatchz required for ldiff: {HPATCHZ_APP}; set SOPHON_HPATCHZ")
	proc = subprocess.Popen(
		# -f: overwrite the target (temporary) file
		[HPATCHZ_APP, "-f", oldfile, pfile_out.name, dstfile],
		stdout=subprocess.PIPE, stderr=subprocess.PIPE,
		text=True
	)
	# Wait in short intervals so cancellation can terminate hpatchz without
	# allowing its temporary output to replace the original game file.
	deadline = time.monotonic() + timeout
	while True:
		if cancel_event and cancel_event.is_set():
			proc.terminate()
			try:
				proc.communicate(timeout=5)
			except subprocess.TimeoutExpired:
				proc.kill()
				proc.communicate()
			dstfile.unlink(True)
			raise TaskCancelledError("cancelled")
		if progress_callback:
			progress_callback()
		remaining = deadline - time.monotonic()
		if remaining <= 0:
			proc.terminate()
			pout, perr = proc.communicate()
			dstfile.unlink(True) # maybe stuck at writing
			warnlog(f"hpatchz timeout ({timeout} s) reached on file '{dstfile.name}'.")
			return False
		try:
			pout, perr = proc.communicate(timeout=min(0.2, remaining))
			break
		except subprocess.TimeoutExpired:
			continue

	retcode = proc.returncode
	if retcode != 0 or perr != "":
		dstfile.unlink(True) # hpatchz may create 0 byte files on failure. Remove it.
		abortlog(f"Failed to patch file '{oldfile.name}' using '{patchfile.name}':"
		         + f"\n\t Exit code: {retcode}"
		         +  "\n\t Message:   " + perr)

	#debuglog("\n", pout)
	"""
	Error Messages And Their Meaning
	~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

	oldFile dataSize <integer> != diffFile saved oldDataSize <integer> ERROR!
		Wrong diff file; it does not match the file "signature"
	open oldFile for read ERROR!
		Missing source file
	patch run ERROR!
		Patch file has an unexpected length
	"""
	return True


# -------------------

class DownloadInfo:
	name: str | None = None # for logging
	getBuild_json = None # json object. 'get(Patch)Build' contents for URL information
	# Category-specific list of files and checksums
	manifest: manifest_pb2.Manifest | manifest_ldiff_pb2.DiffManifest | None = None
	category_json: None  # json object. "game", or language pack information
