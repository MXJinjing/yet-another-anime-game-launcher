# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>
"""File integrity, safe manifest names and game version parsing."""
from __future__ import annotations
import hashlib
import pathlib
import re
import struct
from typing import Optional

def try_get_file_size(filename: pathlib.Path):
	"""
	Returns -1 if the file was not found
	"""
	try:
		return filename.stat().st_size
	except FileNotFoundError:
		return -1


def file_md5(filename: pathlib.Path, progress_callback=None, cancel_event=None, pause_event=None) -> str:
	"""Hash large game files without loading them into memory."""
	from .control import wait_if_paused
	digest = hashlib.md5()
	processed = 0
	total = filename.stat().st_size
	if progress_callback:
		progress_callback(0, total)
	with filename.open("rb") as fh:
		for block in iter(lambda: fh.read(8 * 1024 * 1024), b""):
			wait_if_paused(pause_event, cancel_event)
			digest.update(block)
			processed += len(block)
			if progress_callback:
				progress_callback(processed, total)
	return digest.hexdigest()


def file_matches(filename: pathlib.Path, size: int, md5: str, **hash_options) -> bool:
	return try_get_file_size(filename) == size and file_md5(filename, **hash_options) == md5


def filename_safety_check(filename):
	"""
	Checks whether the path is relative AND within this tree
	This ensures that no files are written to unpredictable locations.
	"""
	assert (".." not in str(filename)), f"Security alert! {filename}"
	assert (str(filename)[0] != '/'), f"Security alert! {filename}"


def bytes_to_MiB(n: float):
	return int(n / (1024 * 1024 / 10) + 0.5) / 10


def cmp_versions(lhs: list, rhs: list) -> int:
	"""
	Returns [1 if lhs > rhs], [-1 if lhs < rhs], [0 if equal]
	"""
	assert len(lhs) == len(rhs)
	for i in range(len(lhs)):
		if lhs[i] < rhs[i]:
			return -1
		if lhs[i] > rhs[i]:
			return 1
	return 0


def compare_game_versions(lhs: str, rhs: str) -> int:
	"""Compare two strict ``major.minor.patch`` game versions."""
	version_pattern = r"\d+\.\d+\.\d+"
	if not re.fullmatch(version_pattern, lhs):
		raise ValueError(f"Invalid installed game version: {lhs}")
	if not re.fullmatch(version_pattern, rhs):
		raise ValueError(f"Invalid target game version: {rhs}")

	return cmp_versions(
		[int(component) for component in lhs.split(".")],
		[int(component) for component in rhs.split(".")],
	)


def get_game_version(game_data_dir: pathlib.Path, offset: int = 0x88) -> Optional[str]:
	ggm_path = game_data_dir / "globalgamemanagers"
	with open(ggm_path, "rb") as f:
		view = f.read()

	pattern = bytes([0x69, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x2d, 0x63, 0x61, 0x74, 0x65, 0x67, 0x6f, 0x72, 0x79, 0x2e])
	plen = len(pattern)
	index = -1
	for i in range(len(view) - plen + 1):
		if view[i:i+plen] == pattern:
			index = i
			break

	if index == -1:
		raise ValueError("pattern not found")
	else:
		len_index = index + offset
		strlen = struct.unpack_from('<I', view, len_index)[0]
		str_bytes = view[len_index + 4: len_index + 4 + strlen]
		str_val = str_bytes.decode('ascii')
		return str_val.split('_')[0]
