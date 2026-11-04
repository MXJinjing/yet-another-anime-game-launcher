# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>
"""Console diagnostics for the downloader."""
from __future__ import annotations
import sys

def _handle_kwargs(kwargs):
	sys.stdout.write("\33[2K")


def debuglog(*args, **kwargs):
	_handle_kwargs(kwargs)
	print("\033[37mDEBUG ", *args, "\033[0m", **kwargs)


def infolog(*args, **kwargs):
	_handle_kwargs(kwargs)
	print("INFO  ", *args, **kwargs)


def warnlog(*args, **kwargs):
	_handle_kwargs(kwargs)
	print("\033[36mWARN  ", *args, "\033[0m", **kwargs)


def abortlog(*args, **kwargs):
	_handle_kwargs(kwargs)
	print("\033[31mERROR ", *args, "\033[0m", **kwargs)
	exception_string = " ".join(str(a) for a in args)
	raise RuntimeError(exception_string)
