import pathlib
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

import sophon_api
from rate_limiter import RateLimiter
from task_errors import TaskCancelledError


class RateLimiterTests(unittest.TestCase):
    def test_acquire_waits_roughly_n_over_rate(self):
        rate = 1000
        limiter = RateLimiter(rate)
        # The first request consumes the initial one-second bucket at once.
        t0 = time.monotonic()
        limiter.acquire(rate)
        first_elapsed = time.monotonic() - t0
        # The second request has to wait for the bucket to refill (~1s).
        t0 = time.monotonic()
        limiter.acquire(rate)
        second_elapsed = time.monotonic() - t0

        self.assertLess(first_elapsed, 0.5)
        self.assertGreaterEqual(second_elapsed, 0.8)
        self.assertLess(second_elapsed, 2.0)

    def test_zero_rate_returns_immediately(self):
        limiter = RateLimiter(0)
        t0 = time.monotonic()
        for _ in range(100):
            limiter.acquire(1024 * 1024)
        self.assertLess(time.monotonic() - t0, 1.0)

    def test_single_request_larger_than_rate_does_not_deadlock(self):
        limiter = RateLimiter(1000)
        t0 = time.monotonic()
        # 5000 bytes at 1000 B/s is larger than the one-second bucket cap;
        # it must still complete (roughly 4s after the pre-filled second).
        limiter.acquire(5000)
        elapsed = time.monotonic() - t0
        self.assertGreaterEqual(elapsed, 3.5)
        self.assertLess(elapsed, 6.0)

    def test_no_burst_after_idle(self):
        limiter = RateLimiter(1000)
        time.sleep(1.2)  # idle for longer than the one-second cap
        t0 = time.monotonic()
        limiter.acquire(1000)  # only one second's worth is available
        self.assertLess(time.monotonic() - t0, 0.5)
        t0 = time.monotonic()
        limiter.acquire(1000)  # the next request must wait again
        self.assertGreaterEqual(time.monotonic() - t0, 0.8)

    def test_set_rate_changes_throttle(self):
        limiter = RateLimiter(1000)
        limiter.acquire(1000)  # drain the initial bucket
        t0 = time.monotonic()
        limiter.acquire(1000)
        self.assertGreaterEqual(time.monotonic() - t0, 0.8)  # ~1s at 1000 B/s

        limiter.set_rate(100)  # slow down
        limiter.acquire(100)  # drain the (smaller) bucket
        t0 = time.monotonic()
        limiter.acquire(100)
        self.assertGreaterEqual(time.monotonic() - t0, 0.8)  # ~1s at 100 B/s

        limiter.set_rate(5000)  # speed up
        limiter.acquire(5000)
        t0 = time.monotonic()
        limiter.acquire(5000)
        self.assertGreaterEqual(time.monotonic() - t0, 0.8)  # ~1s at 5000 B/s
        self.assertLess(time.monotonic() - t0, 2.0)

    def test_set_rate_wakes_waiting_thread(self):
        limiter = RateLimiter(1000)
        started = threading.Event()
        result = {}

        def waiter():
            started.set()
            t0 = time.monotonic()
            limiter.acquire(2000)  # larger than the bucket cap; would wait ~1s
            result["elapsed"] = time.monotonic() - t0

        thread = threading.Thread(target=waiter)
        thread.start()
        self.assertTrue(started.wait(1))
        time.sleep(0.2)
        limiter.set_rate(5000)  # raise the rate and wake the waiter
        thread.join(2)
        self.assertFalse(thread.is_alive(), "set_rate should wake waiting threads")
        self.assertLess(result["elapsed"], 1.0)

    def test_concurrent_workers_share_the_rate(self):
        rate = 2000
        chunk = 200
        limiter = RateLimiter(rate)
        stop = threading.Event()
        total = 0
        lock = threading.Lock()

        def worker():
            nonlocal total
            while not stop.is_set():
                limiter.acquire(chunk)
                with lock:
                    total += chunk

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()

        t0 = time.monotonic()
        time.sleep(5)
        elapsed = time.monotonic() - t0
        stop.set()
        for t in threads:
            t.join()

        # Combined throughput must not exceed the configured rate, with
        # generous slack for the initial one-second burst and scheduling.
        self.assertLessEqual(total, rate * elapsed * 1.5)
        # And the limiter must actually have transferred a meaningful amount.
        self.assertGreaterEqual(total, rate * elapsed * 0.5)

    def test_concurrent_waiters_do_not_consume_the_same_tokens(self):
        rate = 100
        limiter = RateLimiter(rate)
        limiter.acquire(rate)  # drain the initial bucket
        barrier = threading.Barrier(4)
        completed_at = []
        lock = threading.Lock()

        def worker():
            barrier.wait()
            limiter.acquire(20)
            with lock:
                completed_at.append(time.monotonic())

        threads = [threading.Thread(target=worker) for _ in range(3)]
        for thread in threads:
            thread.start()
        barrier.wait()
        started_at = time.monotonic()
        for thread in threads:
            thread.join(2)

        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(len(completed_at), 3)
        # Three 20-byte requests require about 0.6s after the bucket is empty.
        self.assertGreaterEqual(max(completed_at) - started_at, 0.45)
        with limiter._condition:
            self.assertGreaterEqual(limiter._tokens, 0)

    def test_pause_stops_a_large_acquire_until_resumed(self):
        limiter = RateLimiter(100)
        limiter.acquire(100)
        pause_event = threading.Event()
        pause_event.set()
        completed = threading.Event()

        def worker():
            limiter.acquire(100, pause_event=pause_event)
            completed.set()

        thread = threading.Thread(target=worker)
        thread.start()
        self.assertFalse(completed.wait(0.4))
        pause_event.clear()
        self.assertTrue(completed.wait(1.5))
        thread.join(1)

    def test_cancel_interrupts_a_large_acquire(self):
        limiter = RateLimiter(100)
        limiter.acquire(100)
        cancel_event = threading.Event()
        result = {}

        def worker():
            try:
                limiter.acquire(1000, cancel_event=cancel_event)
            except Exception as error:
                result["error"] = error

        thread = threading.Thread(target=worker)
        thread.start()
        time.sleep(0.1)
        cancel_event.set()
        thread.join(0.6)

        self.assertFalse(thread.is_alive())
        self.assertIsInstance(result.get("error"), TaskCancelledError)

    def test_module_singleton_is_shared(self):
        import rate_limiter

        self.assertIsInstance(rate_limiter.limiter, RateLimiter)
        self.assertIs(sophon_api.limiter, rate_limiter.limiter)


class DownloadFileResumeTests(unittest.TestCase):
    def _make_curl(self, response_code=200, perform_writes=()):
        curl = MagicMock()
        curl.URL = "URL"
        curl.RANGE = "RANGE"
        curl.WRITEFUNCTION = "WRITEFUNCTION"
        curl.RESPONSE_CODE = "RESPONSE_CODE"
        curl.getinfo.return_value = response_code
        captured = {}
        calls = []

        def setopt(opt, value):
            calls.append((opt, value))
            if opt == "WRITEFUNCTION":
                captured["write_callback"] = value

        curl.setopt.side_effect = setopt

        def perform():
            for data in perform_writes:
                captured["write_callback"](data)

        curl.perform.side_effect = perform
        return curl, captured, calls

    def test_acquire_is_called_for_each_write_chunk(self):
        curl, captured, calls = self._make_curl(
            response_code=200,
            perform_writes=(b"chunk-1", b"-part2"),
        )
        acquired = []

        with tempfile.TemporaryDirectory() as tmp:
            dstfile = pathlib.Path(tmp) / "out.bin"
            with (
                patch.object(sophon_api.pycurl, "Curl", return_value=curl),
                patch.object(sophon_api, "limiter") as mock_limiter,
            ):
                mock_limiter.acquire.side_effect = (
                    lambda n, **_kwargs: acquired.append(n)
                )
                sophon_api.SophonClient()._download_file_resume(
                    "https://example.com/chunk", dstfile, 13
                )
                # The write callback itself returns len(data) (and still
                # acquires the limiter first).
                write_callback = captured["write_callback"]
                self.assertEqual(write_callback(b"extra"), 5)
            written = dstfile.read_bytes()

        # The limiter is acquired once per write callback invocation, before
        # each segment is written, and the whole payload lands on disk.
        self.assertEqual(acquired, [len(b"chunk-1"), len(b"-part2"), 5])
        self.assertEqual(written, b"chunk-1-part2")

    def test_416_short_circuits_without_acquiring(self):
        curl, captured, calls = self._make_curl(response_code=416)
        with tempfile.TemporaryDirectory() as tmp:
            dstfile = pathlib.Path(tmp) / "out.bin"
            dstfile.write_bytes(b"12345")
            with (
                patch.object(sophon_api.pycurl, "Curl", return_value=curl),
                patch.object(sophon_api, "limiter") as mock_limiter,
            ):
                sophon_api.SophonClient()._download_file_resume(
                    "https://example.com/chunk", dstfile, 10
                )
                # The RANGE resume header is kept for the existing partial file...
                self.assertIn(("RANGE", "5-"), calls)
                # ...but a 416 response short-circuits without writing or acquiring.
                mock_limiter.acquire.assert_not_called()
                self.assertEqual(dstfile.read_bytes(), b"12345")

    def test_skips_download_when_file_is_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            dstfile = pathlib.Path(tmp) / "out.bin"
            dstfile.write_bytes(b"complete")
            with (
                patch.object(sophon_api.pycurl, "Curl") as curl_mock,
                patch.object(sophon_api, "limiter") as mock_limiter,
            ):
                sophon_api.SophonClient()._download_file_resume(
                    "https://example.com/chunk", dstfile, len(b"complete")
                )
        curl_mock.assert_not_called()
        mock_limiter.acquire.assert_not_called()

    def test_transient_curl_error_retries_instead_of_returning(self):
        curl, captured, calls = self._make_curl(response_code=200)
        curl.perform.side_effect = [
            sophon_api.pycurl.error(7, "first failure"),
            sophon_api.pycurl.error(7, "second failure"),
            None,
        ]
        with tempfile.TemporaryDirectory() as tmp:
            dstfile = pathlib.Path(tmp) / "out.bin"
            with (
                patch.object(sophon_api.pycurl, "Curl", return_value=curl),
                patch.object(sophon_api.time, "sleep"),
            ):
                sophon_api.SophonClient()._download_file_resume(
                    "https://example.com/chunk", dstfile, 1
                )
        self.assertEqual(curl.perform.call_count, 3)

    def test_cancel_from_write_callback_is_not_retried(self):
        curl, captured, calls = self._make_curl(response_code=200)
        cancel_event = threading.Event()

        def perform():
            cancel_event.set()
            captured["write_callback"](b"data")

        curl.perform.side_effect = perform
        with tempfile.TemporaryDirectory() as tmp:
            dstfile = pathlib.Path(tmp) / "out.bin"
            with patch.object(sophon_api.pycurl, "Curl", return_value=curl):
                with self.assertRaises(TaskCancelledError):
                    sophon_api.SophonClient()._download_file_resume(
                        "https://example.com/chunk",
                        dstfile,
                        4,
                        cancel_event=cancel_event,
                    )
        self.assertEqual(curl.perform.call_count, 1)


if __name__ == "__main__":
    unittest.main()
