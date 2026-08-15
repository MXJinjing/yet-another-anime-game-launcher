import threading
import time

from task_errors import TaskCancelledError


class RateLimiter:
    """Process-wide, thread-safe token bucket rate limiter (bytes/s).

    All download workers share the same module-level instance, so the
    combined throughput across the whole Sophon process never exceeds the
    configured rate. A rate of 0 means unlimited: acquire() returns
    immediately without consuming any tokens.
    """

    def __init__(self, rate: int = 0):
        self._condition = threading.Condition(threading.Lock())
        self._rate = 0
        self._tokens = 0.0
        self._last_refill = time.monotonic()
        self.set_rate(rate)

    def set_rate(self, rate: int):
        """Set the rate in bytes/s (0 = unlimited) and reset bucket state."""
        rate = max(0, int(rate))
        with self._condition:
            self._rate = rate
            # Reset the bucket so there is no accumulated burst after a
            # speed change; cap the initial tokens at one second of rate.
            self._tokens = float(rate)
            self._last_refill = time.monotonic()
            self._condition.notify_all()

    def _refill(self):
        """Add tokens earned since the last refill, capped at 1 second of rate."""
        if self._rate <= 0:
            self._last_refill = time.monotonic()
            return
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self._tokens + elapsed * self._rate, float(self._rate))
        self._last_refill = now

    def acquire(self, n: int, cancel_event=None, pause_event=None):
        """Block until `n` bytes of quota are available; rate 0 returns at once."""
        if n <= 0:
            return
        remaining = float(n)
        with self._condition:
            while remaining > 0:
                if cancel_event and cancel_event.is_set():
                    raise TaskCancelledError("cancelled")
                if pause_event and pause_event.is_set():
                    self._condition.wait(0.2)
                    continue
                if self._rate <= 0:
                    return
                self._refill()
                consumed = min(remaining, self._tokens)
                self._tokens -= consumed
                remaining -= consumed
                if remaining <= 0:
                    return

                # Recalculate after every wake-up. This prevents concurrent
                # waiters from all consuming the same future tokens and keeps
                # cancellation/pause checks in curl callbacks responsive.
                next_segment = min(remaining, float(self._rate))
                shortfall = max(0.0, next_segment - self._tokens)
                self._condition.wait(min(0.2, shortfall / self._rate))


# Module-level singleton shared by all download workers and the /api/limit endpoint.
limiter = RateLimiter(0)
