import { describe, expect, it, vi } from "vitest";
import { createGameProcessMonitor } from "@wine/game-process-monitor";

function timedMonitor(samples: Array<{ pid: string; name: string }[]>) {
  let now = 0;
  const log = vi.fn(async () => undefined);
  const monitor = createGameProcessMonitor({
    executable: "TargetGame.exe",
    listProcesses: async () => samples.shift() ?? [],
    now: () => now,
    sleep: async milliseconds => {
      now += milliseconds;
    },
    log,
  });
  return { monitor, log };
}

describe("game crash detection", () => {
  it("reports a crash when the confirmed game exits before five seconds", async () => {
    const target = [{ pid: "10", name: "TargetGame.exe" }];
    const { monitor, log } = timedMonitor([target, target, target, [], [], []]);

    await expect(
      monitor.waitForStart({ timeoutMs: 5_000, pollIntervalMs: 500 })
    ).resolves.toBe("started");
    await expect(
      monitor.waitForExit({ missingSamples: 3, pollIntervalMs: 1_000 })
    ).resolves.toBe("crashed");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("crashed"));
  });

  it("does not count the exit debounce time as game runtime", async () => {
    const target = [{ pid: "10", name: "TargetGame.exe" }];
    const { monitor } = timedMonitor([target, target, [], [], []]);

    await monitor.waitForStart({ timeoutMs: 5_000, pollIntervalMs: 500 });
    await expect(
      monitor.waitForExit({
        missingSamples: 3,
        pollIntervalMs: 3_000,
        crashThresholdMs: 5_000,
      })
    ).resolves.toBe("crashed");
  });

  it("reports a normal exit after the game has run for five seconds", async () => {
    const target = [{ pid: "10", name: "TargetGame.exe" }];
    const { monitor } = timedMonitor([
      target,
      target,
      target,
      target,
      target,
      target,
      target,
      [],
      [],
      [],
    ]);

    await monitor.waitForStart({ timeoutMs: 5_000, pollIntervalMs: 500 });
    await expect(
      monitor.waitForExit({ missingSamples: 3, pollIntervalMs: 1_000 })
    ).resolves.toBe("exited");
  });
});
