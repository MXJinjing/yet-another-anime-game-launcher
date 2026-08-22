import { describe, expect, it } from "vitest";
import { createGameProcessMonitor } from "@wine/game-process-monitor";

function exitMonitor(samples: Array<{ pid: string; name: string }[] | Error>) {
  return createGameProcessMonitor({
    executable: "TargetGame.exe",
    listProcesses: async () => {
      const sample = samples.shift() ?? [];
      if (sample instanceof Error) throw sample;
      return sample;
    },
    sleep: async () => undefined,
    log: async () => undefined,
  });
}

describe("game process exit detection", () => {
  it("tracks the image across PID replacement", async () => {
    const monitor = exitMonitor([
      [{ pid: "10", name: "TargetGame.exe" }],
      [{ pid: "20", name: "TargetGame.exe" }],
      [],
      [],
      [],
    ]);

    await expect(
      monitor.waitForExit({ missingSamples: 3, pollIntervalMs: 0 })
    ).resolves.toBe("exited");
  });

  it("ignores residual Wine services after the target exits", async () => {
    const residual = [
      { pid: "1", name: "services.exe" },
      { pid: "2", name: "winedevice.exe" },
      { pid: "3", name: "rpcss.exe" },
    ];
    const monitor = exitMonitor([
      [{ pid: "10", name: "TargetGame.exe" }, ...residual],
      residual,
      residual,
      residual,
    ]);

    await expect(
      monitor.waitForExit({ missingSamples: 3, pollIntervalMs: 0 })
    ).resolves.toBe("exited");
  });

  it("resets the exit debounce when the target reappears", async () => {
    const monitor = exitMonitor([
      [],
      [],
      [{ pid: "30", name: "TargetGame.exe" }],
      [],
      [],
      [],
    ]);

    await expect(
      monitor.waitForExit({ missingSamples: 3, pollIntervalMs: 0 })
    ).resolves.toBe("exited");
  });

  it("never treats enumeration errors as a clean exit", async () => {
    const monitor = exitMonitor([
      new Error("first failure"),
      new Error("second failure"),
      new Error("third failure"),
    ]);

    await expect(
      monitor.waitForExit({ missingSamples: 3, pollIntervalMs: 0 })
    ).resolves.toBe("unknown");
  });
});
