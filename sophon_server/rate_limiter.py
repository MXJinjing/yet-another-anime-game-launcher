import threading
import time


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

    def acquire(self, n: int):
        """Block until `n` bytes of quota are available; rate 0 returns at once."""
        if n <= 0:
            return
        with self._condition:
            if self._rate <= 0:
                return
            self._refill()
            if self._tokens >= n:
                self._tokens -= n
                return
            # The bucket never holds more than one second of rate, so a
            # single request can be larger than the bucket. Wait until the
            # shortfall has been earned and consume it immediately; any
            # excess becomes debt that later refills repay, keeping the
            # long-run average at `rate`. Early wakeups (e.g. from set_rate)
            # just create a little extra debt, so this is always safe.
            shortfall = n - self._tokens
            self._condition.wait(shortfall / self._rate)
            if self._rate <= 0:
                return
            self._refill()
            self._tokens -= n


# Module-level singleton shared by all download workers and the /api/limit endpoint.
limiter = RateLimiter(0)
