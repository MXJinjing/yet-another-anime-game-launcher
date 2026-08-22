import { describe, expect, it, vi } from "vitest";
import { createGameProcessMonitor } from "@wine/game-process-monitor";

function startupMonitor(
  samples: Array<{ pid: string; name: string }[] | Error>
) {
  let now = 0;
  return createGameProcessMonitor({
    executable: "C:\\Games\\TargetGame.exe",
    listProcesses: async () => {
      const sample = samples.shift() ?? [];
      if (sample instanceof Error) throw sample;
      return sample;
    },
    now: () => now,
    sleep: async milliseconds => {
      now += milliseconds;
    },
    log: async () => undefined,
  });
}

describe("game process startup detection", () => {
  it("matches the exact executable name case-insensitively", async () => {
    const monitor = startupMonitor([
      [{ pid: "1", name: "winedevice.exe" }],
      [{ pid: "20", name: "C:\\Games\\TARGETGAME.EXE" }],
      [{ pid: "21", name: "targetgame.exe" }],
    ]);

    await expect(
      monitor.waitForStart({ timeoutMs: 1_000, pollIntervalMs: 100 })
    ).resolves.toBe("started");
  });

  it("does not accept a single transient observation", async () => {
    const monitor = startupMonitor([
      [{ pid: "20", name: "TargetGame.exe" }],
      [],
      [{ pid: "21", name: "TargetGame.exe" }],
      [{ pid: "21", name: "TargetGame.exe" }],
    ]);

    await expect(
      monitor.waitForStart({ timeoutMs: 1_000, pollIntervalMs: 100 })
    ).resolves.toBe("started");
  });

  it("returns timed-out when the target never appears", async () => {
    const monitor = startupMonitor([
      [{ pid: "1", name: "services.exe" }],
      [{ pid: "2", name: "winedevice.exe" }],
      [],
    ]);

    await expect(
      monitor.waitForStart({ timeoutMs: 200, pollIntervalMs: 100 })
    ).resolves.toBe("timed-out");
  });

  it("returns unknown after three consecutive enumeration failures", async () => {
    const monitor = startupMonitor([
      new Error("tasklist unavailable"),
      new Error("winedbg unavailable"),
      new Error("process source unavailable"),
    ]);

    await expect(
      monitor.waitForStart({ timeoutMs: 1_000, pollIntervalMs: 0 })
    ).resolves.toBe("unknown");
  });

  it("times out one blocked query and recovers on later samples", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const monitor = createGameProcessMonitor({
        executable: "TargetGame.exe",
        listProcesses: async () => {
          calls++;
          if (calls === 1) return await new Promise(() => undefined);
          return [{ pid: "20", name: "TargetGame.exe" }];
        },
        log: async () => undefined,
        sleep: async () => undefined,
      });

      const result = monitor.waitForStart({
        timeoutMs: 1_000,
        pollIntervalMs: 0,
        queryTimeoutMs: 100,
        initialDelayMs: 0,
      });
      await vi.advanceTimersByTimeAsync(100);

      await expect(result).resolves.toBe("started");
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("delays the first startup query to avoid racing the launch command", async () => {
    vi.useFakeTimers();
    try {
      const listProcesses = vi.fn(async () => [
        { pid: "20", name: "TargetGame.exe" },
      ]);
      const monitor = createGameProcessMonitor({
        executable: "TargetGame.exe",
        listProcesses,
        log: async () => undefined,
      });

      const result = monitor.waitForStart({
        timeoutMs: 2_000,
        pollIntervalMs: 0,
        initialDelayMs: 750,
      });
      await vi.advanceTimersByTimeAsync(749);
      expect(listProcesses).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTimersAsync();

      await expect(result).resolves.toBe("started");
    } finally {
      vi.useRealTimers();
    }
  });
});
