import { describe, expect, it, vi } from "vitest";
import {
  createGameProcessMonitor,
  parseMacWineProcesses,
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

  it("parses host Wine processes without matching similar loader paths", () => {
    expect(
      parseMacWineProcesses(
        " 123 /Applications/GPTK.app/Contents/Resources/wine/bin/wine64 C:\\game\\Target.exe\n" +
          " 456 /Applications/OtherGPTK.app/Contents/Resources/wine/bin/wine64 C:\\game\\Other.exe",
        "/Applications/GPTK.app/Contents/Resources/wine/bin/wine64"
      )
    ).toEqual([
      {
        pid: "123",
        name: "C:\\game\\Target.exe",
        command:
          "/Applications/GPTK.app/Contents/Resources/wine/bin/wine64 C:\\game\\Target.exe",
      },
    ]);
  });

  it("parses Wine processes launched through the macOS preloader", () => {
    expect(
      parseMacWineProcesses(
        " 123 /Applications/GPTK.app/Contents/Resources/wine/bin/wine64-preloader C:\\game\\Target.exe",
        "/Applications/GPTK.app/Contents/Resources/wine/bin/wine64"
      )
    ).toEqual([
      {
        pid: "123",
        name: "C:\\game\\Target.exe",
        command:
          "/Applications/GPTK.app/Contents/Resources/wine/bin/wine64-preloader C:\\game\\Target.exe",
      },
    ]);
  });

  it("matches a preloader game path containing unquoted spaces", () => {
    expect(
      parseMacWineProcesses(
        " 123 /Applications/GPTK.app/Contents/Resources/wine/bin/wine64-preloader Z:\\Users\\wjj\\The Anime Game\\Target.exe -launch\n",
        "/Applications/GPTK.app/Contents/Resources/wine/bin/wine64",
        "/Users/wjj/The Anime Game/Target.exe"
      )
    ).toEqual([
      {
        pid: "123",
        name: "Z:\\Users\\wjj\\The Anime Game\\Target.exe",
        command:
          "/Applications/GPTK.app/Contents/Resources/wine/bin/wine64-preloader Z:\\Users\\wjj\\The Anime Game\\Target.exe -launch",
      },
    ]);
  });

  it("matches the direct DXMT game process by install path, not its Steam wrapper", () => {
    expect(
      parseMacWineProcesses(
        " 10 C:\\windows\\system32\\steam.exe Z:\\Users\\wjj\\GI\\YuanShen.exe\n" +
          " 11 Z:\\Users\\wjj\\GI\\YuanShen.exe -platform_type CLOUD_THIRD_PARTY_PC\n" +
          " 12 Z:\\Users\\wjj\\Other\\YuanShen.exe\n" +
          " 13 /bin/sh -c Z:\\Users\\wjj\\GI\\YuanShen.exe\n",
        "/wine/bin/wine",
        "/Users/wjj/GI/YuanShen.exe"
      )
    ).toEqual([
      {
        pid: "11",
        name: "Z:\\Users\\wjj\\GI\\YuanShen.exe",
        command:
          "Z:\\Users\\wjj\\GI\\YuanShen.exe -platform_type CLOUD_THIRD_PARTY_PC",
      },
    ]);
  });

  it("matches a game installed within the prefix through its C drive path", () => {
    expect(
      parseMacWineProcesses(
        " 22 C:\\Games\\Target.exe\n",
        "/wine/bin/wine",
        "/prefix/drive_c/Games/Target.exe"
      )
    ).toEqual([
      {
        pid: "22",
        name: "C:\\Games\\Target.exe",
        command: "C:\\Games\\Target.exe",
      },
    ]);
  });

  it("matches a direct Windows executable whose install path contains spaces", () => {
    expect(
      parseMacWineProcesses(
        " 31 Z:\\Users\\wjj\\Games\\The Anime Game\\Target.exe -launch\n" +
          " 32 Z:\\Users\\wjj\\Games\\Other Game\\Target.exe\n",
        "/wine/bin/wine",
        "/Users/wjj/Games/The Anime Game/Target.exe"
      )
    ).toEqual([
      {
        pid: "31",
        name: "Z:\\Users\\wjj\\Games\\The Anime Game\\Target.exe",
        command: "Z:\\Users\\wjj\\Games\\The Anime Game\\Target.exe -launch",
      },
    ]);
  });

  it("does not count a shell that merely launches the Wine loader", () => {
    expect(
      parseMacWineProcesses(
        " 21 /bin/sh -c /wine/bin/wine Z:\\game\\Target.exe\n" +
          " 22 /wine/bin/wine Z:\\game\\Target.exe\n",
        "/wine/bin/wine",
        "/game/Target.exe"
      )
    ).toEqual([
      {
        pid: "22",
        name: "Z:\\game\\Target.exe",
        command: "/wine/bin/wine Z:\\game\\Target.exe",
      },
    ]);
  });

  it("treats a failed pre-check as not running instead of aborting the launch", async () => {
    const monitor = createGameProcessMonitor({
      executable: "ZenlessZoneZero.exe",
      listProcesses: async () => {
        throw new Error("Wine process enumeration timed out after 10000ms");
      },
      log: async () => undefined,
    });
    await expect(monitor.isRunning()).resolves.toBe(false);
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

  it("tracks only the native PID observed for this launch", async () => {
    const samples = [
      [{ pid: "10", name: "Target.exe" }],
      [{ pid: "10", name: "Target.exe" }],
      [
        { pid: "10", name: "Target.exe" },
        { pid: "20", name: "Target.exe" },
      ],
      [{ pid: "20", name: "Target.exe" }],
    ];
    const monitor = createGameProcessMonitor({
      executable: "/game/Target.exe",
      listProcesses: async () => samples.shift() ?? [],
      pinProcessIdsOnStart: true,
      sleep: async () => undefined,
      log: async () => undefined,
    });

    await expect(
      monitor.waitForStart({ initialDelayMs: 0, pollIntervalMs: 0 })
    ).resolves.toBe("started");
    await expect(monitor.waitForExit({ pollIntervalMs: 0 })).resolves.toBe(
      "unknown"
    );
  });

  it("pins a PID only after observing the same native process twice", async () => {
    const samples = [
      [{ pid: "10", name: "Target.exe" }],
      [{ pid: "20", name: "Target.exe" }],
      [{ pid: "20", name: "Target.exe" }],
      [],
      [],
      [],
    ];
    const monitor = createGameProcessMonitor({
      executable: "/game/Target.exe",
      listProcesses: async () => samples.shift() ?? [],
      pinProcessIdsOnStart: true,
      sleep: async () => undefined,
      log: async () => undefined,
    });

    await expect(
      monitor.waitForStart({ initialDelayMs: 0, pollIntervalMs: 0 })
    ).resolves.toBe("started");
    await expect(
      monitor.waitForExit({ pollIntervalMs: 0, crashThresholdMs: 0 })
    ).resolves.toBe("exited");
  });

  it("confirms exit without consulting another process source after a pinned PID disappears", async () => {
    const sleep = vi.fn(async () => undefined);
    const samples = [
      [{ pid: "10", name: "Target.exe" }],
      [{ pid: "10", name: "Target.exe" }],
      [],
      [],
      [],
    ];
    const monitor = createGameProcessMonitor({
      executable: "/game/Target.exe",
      listProcesses: async () => samples.shift() ?? [],
      pinProcessIdsOnStart: true,
      sleep,
      log: async () => undefined,
    });

    await expect(
      monitor.waitForStart({ initialDelayMs: 0, pollIntervalMs: 0 })
    ).resolves.toBe("started");
    await expect(monitor.waitForExit({ crashThresholdMs: 0 })).resolves.toBe(
      "exited"
    );
    expect(sleep.mock.calls.slice(-2)).toEqual([[1_000], [1_000]]);
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
      exitOnWindowClose: true,
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

  it("does not probe or kill a running game when window exit monitoring is off", async () => {
    let queries = 0;
    const getWindowState = vi.fn(async () => false);
    const onWindowClosed = vi.fn(async () => undefined);
    const monitor = createGameProcessMonitor({
      executable: "StarRail.exe",
      listProcesses: async () => {
        queries++;
        return queries <= 6 ? [{ pid: "10", name: "StarRail.exe" }] : [];
      },
      getWindowState,
      onWindowClosed,
      sleep: async () => undefined,
      log: async () => undefined,
    });

    await expect(
      monitor.waitForStart({ initialDelayMs: 0, pollIntervalMs: 0 })
    ).resolves.toBe("started");
    await expect(
      monitor.waitForExit({ pollIntervalMs: 0, crashThresholdMs: 0 })
    ).resolves.toBe("exited");
    expect(getWindowState).not.toHaveBeenCalled();
    expect(onWindowClosed).not.toHaveBeenCalled();
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
