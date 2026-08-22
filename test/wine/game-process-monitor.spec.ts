import { describe, expect, it, vi } from "vitest";
import {
  createGameProcessMonitor,
  parseTasklistCsv,
  parseWinedbgProcesses,
} from "@wine/game-process-monitor";

describe("Wine game process monitor", () => {
  it("parses tasklist output without depending on localized headers", () => {
    expect(
      parseTasklistCsv(
        '"StarRail.exe","1234","Console","1","100,000 K"\r\n' +
          '"winedevice.exe","5678","Console","1","20,000 K"'
      )
    ).toEqual([
      { name: "StarRail.exe", pid: "1234" },
      { name: "winedevice.exe", pid: "5678" },
    ]);
  });

  it("parses the winedbg fallback process table", () => {
    expect(
      parseWinedbgProcesses(
        " pid command\n 20 services.exe\n 2a C:\\games\\StarRail.exe\n"
      )
    ).toEqual([
      { pid: "20", name: "services.exe" },
      { pid: "2a", name: "C:\\games\\StarRail.exe" },
    ]);
  });

  it("requires two consecutive observations before declaring startup", async () => {
    let now = 0;
    const samples = [
      [],
      [{ pid: "10", name: "StarRail.exe" }],
      [{ pid: "10", name: "StarRail.exe" }],
    ];
    const monitor = createGameProcessMonitor({
      executable: "C:\\games\\StarRail.exe",
      listProcesses: async () => samples.shift() ?? [],
      now: () => now,
      log: async () => undefined,
      sleep: async milliseconds => {
        now += milliseconds;
      },
    });
    await expect(
      monitor.waitForStart({ timeoutMs: 5_000, pollIntervalMs: 100 })
    ).resolves.toBe("started");
  });

  it("waits for stable disappearance and ignores a one-sample gap", async () => {
    const samples = [
      [
        { pid: "10", name: "StarRail.exe" },
        { pid: "11", name: "winedevice.exe" },
      ],
      [],
      [
        { pid: "20", name: "StarRail.exe" },
        { pid: "12", name: "wineserver" },
      ],
      [{ pid: "12", name: "wineserver" }],
      [{ pid: "12", name: "wineserver" }],
      [{ pid: "12", name: "wineserver" }],
    ];
    const monitor = createGameProcessMonitor({
      executable: "StarRail.exe",
      listProcesses: async () => samples.shift() ?? [],
      sleep: async () => undefined,
      log: async () => undefined,
    });
    await expect(
      monitor.waitForExit({
        missingSamples: 3,
        pollIntervalMs: 0,
        crashThresholdMs: 0,
      })
    ).resolves.toBe("exited");
  });

  it("reports unknown when enumeration fails instead of treating it as exit", async () => {
    const monitor = createGameProcessMonitor({
      executable: "StarRail.exe",
      listProcesses: async () => {
        throw new Error("process source unavailable");
      },
      sleep: async () => undefined,
      log: async () => undefined,
    });
    await expect(
      monitor.waitForExit({ missingSamples: 3, pollIntervalMs: 0 })
    ).resolves.toBe("unknown");
  });

  it("does not treat a blocked exit query as process disappearance", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const monitor = createGameProcessMonitor({
        executable: "StarRail.exe",
        listProcesses: async () => {
          calls++;
          if (calls === 1) return await new Promise(() => undefined);
          if (calls === 2) return [{ pid: "10", name: "StarRail.exe" }];
          return [];
        },
        sleep: async () => undefined,
        log: async () => undefined,
      });

      const result = monitor.waitForExit({
        missingSamples: 2,
        pollIntervalMs: 0,
        queryTimeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(100);

      await expect(result).resolves.toBe("exited");
      expect(calls).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a residual process after its application window stays closed", async () => {
    let now = 0;
    let hasWindow = true;
    const onWindowClosed = vi.fn(async () => undefined);
    const monitor = createGameProcessMonitor({
      executable: "StarRail.exe",
      listProcesses: async () => [{ pid: "10", name: "StarRail.exe" }],
      getWindowState: async () => hasWindow,
      onWindowClosed,
      now: () => now,
      sleep: async milliseconds => {
        now += milliseconds;
        hasWindow = false;
      },
      log: async () => undefined,
    });

    await expect(
      monitor.waitForStart({ initialDelayMs: 0, pollIntervalMs: 1 })
    ).resolves.toBe("started");
    await expect(
      monitor.waitForExit({
        pollIntervalMs: 1_000,
        crashThresholdMs: 0,
        missingWindowSamples: 3,
        missingWindowGraceMs: 2_000,
      })
    ).resolves.toBe("exited");
    expect(onWindowClosed).toHaveBeenCalledOnce();
  });

  it("does not treat a process as exited before an application window was seen", async () => {
    let calls = 0;
    const monitor = createGameProcessMonitor({
      executable: "StarRail.exe",
      listProcesses: async () => {
        calls++;
        return calls < 7 ? [{ pid: "10", name: "StarRail.exe" }] : [];
      },
      getWindowState: async () => false,
      sleep: async () => undefined,
      log: async () => undefined,
    });

    await expect(
      monitor.waitForStart({ initialDelayMs: 0, pollIntervalMs: 0 })
    ).resolves.toBe("started");
    await expect(
      monitor.waitForExit({
        missingSamples: 3,
        pollIntervalMs: 0,
        crashThresholdMs: 0,
      })
    ).resolves.toBe("exited");
  });
});
