# SPDX-License-Identifier: MIT
# Copyright (C) 2025 Krock <mk939@ymail.com>
"""Cancellation and pause checkpoints for long-running work."""
from __future__ import annotations
import time
from infrastructure.errors import TaskCancelledError

def raise_if_cancelled(cancel_event):
	if cancel_event and cancel_event.is_set():
		raise TaskCancelledError("cancelled")


def wait_if_paused(pause_event, cancel_event=None):
	"""Block while a pause request is active; returns as soon as the
	operation is resumed (or when no pause is in effect). A cancel
	request made while paused is also honoured so cancelling still works
	without having to resume first."""
	raise_if_cancelled(cancel_event)
	if pause_event is None:
		return
	while pause_event.is_set():
		raise_if_cancelled(cancel_event)
		time.sleep(0.2)
	raise_if_cancelled(cancel_event)
