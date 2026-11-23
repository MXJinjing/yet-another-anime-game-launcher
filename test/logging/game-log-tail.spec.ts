import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BH3_GAME_LOG_LOCATIONS,
  CBJQ_GAME_LOG_LOCATIONS,
  getHK4EGameLogLocations,
  HKRPG_GAME_LOG_LOCATIONS,
  NAP_GAME_LOG_LOCATIONS,
} from "@src/clients/game-log-paths";
import { HK4E_CN_OUTPUT_LOG } from "@src/clients/secret";
import {
  createGameLogTail,
  createLogFileTail,
  findGameLogFiles,
} from "@src/logging/game-log-tail";

const prefix = "/prefix";
const gameDir = "/games/The Anime Game";
const driverLog = `${gameDir}/driverError.log`;
const manualLog = "/logs/chosen.log";
const gameTarget = {
  prefix,
  gameDir,
  locations: [{ root: "game-install", path: "driverError.log" }] as const,
};

const users = `${prefix}/drive_c/users`;
const localLow = `${users}/crossover/AppData/LocalLow`;
const mainLog = `${users}/crossover/${HK4E_CN_OUTPUT_LOG}`;

function mockFilesystem(files: Map<string, string>) {
  const readDirectory = vi.fn(async (path: string) => {
    if (path === users) {
      return [
        { entry: "Public", type: "DIRECTORY" },
        { entry: "crossover", type: "DIRECTORY" },
      ];
    }
    throw new Error("Unexpected directory: " + path);
  });
  const readFile = vi.fn(async (path: string) => files.get(path));
  const getStats = vi.fn(async (path: string) => {
    if (path === driverLog && !files.has(path)) {
      return { isFile: false, size: 0 };
    }
    const content = files.get(path);
    if (content === undefined) throw new Error("No such file: " + path);
    return { isFile: true, size: content.length };
  });
  vi.stubGlobal("Neutralino", {
    filesystem: { readDirectory, readFile, getStats },
  });
  return { readDirectory, readFile, getStats };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("game log discovery", () => {
  it("only finds existing fixed paths for the current release", async () => {
    const { readDirectory, getStats } = mockFilesystem(
      new Map([
        [mainLog, "main log"],
        [
          localLow + "/AnimeCompany/The Anime Game Global/output_log.txt",
          "other release",
        ],
        [localLow + "/unrelated/output_log.txt", "unrelated"],
      ])
    );
    const locations = [
      ...getHK4EGameLogLocations("cn"),
      {
        root: "wine-user",
        path: HK4E_CN_OUTPUT_LOG,
      } as const,
    ];
    expect(await findGameLogFiles({ prefix, gameDir, locations })).toEqual([
      mainLog,
    ]);
    expect(readDirectory.mock.calls).toEqual([[users]]);
    expect(getStats).not.toHaveBeenCalledWith(
      localLow + "/AnimeCompany/The Anime Game Global/output_log.txt"
    );
  });

  it("checks the install-root driver log for every game", () => {
    for (const locations of [
      getHK4EGameLogLocations("cn"),
      getHK4EGameLogLocations("os"),
      getHK4EGameLogLocations("bb"),
      HKRPG_GAME_LOG_LOCATIONS,
      NAP_GAME_LOG_LOCATIONS,
      BH3_GAME_LOG_LOCATIONS,
      CBJQ_GAME_LOG_LOCATIONS,
    ]) {
      expect(locations).toContainEqual({
        root: "game-install",
        path: "driverError.log",
      });
      expect(
        locations.some(location => location.path === "AppData/LocalLow")
      ).toBe(false);
    }
  });

  it("discovers a driver log created after the main log without reading it early", async () => {
    vi.useFakeTimers();
    const files = new Map([[mainLog, "main log\n"]]);
    const { readFile } = mockFilesystem(files);
    const onPaths = vi.fn();
    const onFileLine = vi.fn();
    const stop = createGameLogTail({
      prefix,
      gameDir,
      locations: getHK4EGameLogLocations("cn"),
      onLine: () => undefined,
      onPaths,
      onFileLine,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onPaths.mock.calls).toEqual([[[mainLog]]]);
      expect(readFile.mock.calls).toEqual([[mainLog]]);
      expect(onFileLine).toHaveBeenCalledWith(mainLog, "main log");

      files.set(driverLog, "driver error\n");
      await vi.advanceTimersByTimeAsync(6000);
      expect(onPaths.mock.calls).toEqual([[[mainLog]], [[mainLog, driverLog]]]);
      expect(readFile.mock.calls).toEqual([[mainLog], [driverLog]]);
      expect(onFileLine).toHaveBeenCalledWith(driverLog, "driver error");
    } finally {
      stop();
    }
  });
});

describe("dynamic log file tracking", () => {
  it("deduplicates auto and manual paths when the user picks files later", async () => {
    vi.useFakeTimers();
    const { readFile } = mockFilesystem(
      new Map([
        [driverLog, "driver error\n"],
        [manualLog, "manual log\r\n"],
      ])
    );
    let manualPaths: readonly string[] = [];
    const onPaths = vi.fn();
    const onLine = vi.fn();
    const onFileLine = vi.fn();
    const stop = createLogFileTail({
      getGameTarget: () => gameTarget,
      getManualPaths: () => manualPaths,
      onPaths,
      onLine,
      onFileLine,
      pollIntervalMs: 10,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(onPaths.mock.calls).toEqual([[[driverLog]]]);

      manualPaths = [driverLog, manualLog, driverLog];
      await vi.advanceTimersByTimeAsync(10);
      expect(onPaths.mock.calls).toEqual([
        [[driverLog]],
        [[driverLog, manualLog]],
      ]);
      expect(readFile.mock.calls).toEqual([[driverLog], [manualLog]]);
      expect(onLine.mock.calls).toEqual([["driver error"], ["manual log"]]);
      expect(onFileLine.mock.calls).toEqual([
        [driverLog, "driver error"],
        [manualLog, "manual log"],
      ]);

      manualPaths = [];
      await vi.advanceTimersByTimeAsync(10);
      expect(onPaths).toHaveBeenLastCalledWith([driverLog]);
    } finally {
      stop();
    }
  });

  it("keeps the manual offset across games even when the old game discovered that file", async () => {
    vi.useFakeTimers();
    const nextTarget = { ...gameTarget, gameDir: "/games/Next" };
    const nextDriverLog = `${nextTarget.gameDir}/driverError.log`;
    const files = new Map([
      [driverLog, "original\n"],
      [nextDriverLog, "new game\n"],
    ]);
    const { readFile } = mockFilesystem(files);
    let target: typeof gameTarget | undefined = gameTarget;
    const onPaths = vi.fn();
    const onFileLine = vi.fn();
    const stop = createLogFileTail({
      getGameTarget: () => target,
      getManualPaths: () => [driverLog],
      onPaths,
      onLine: () => undefined,
      onFileLine,
      pollIntervalMs: 10,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(readFile.mock.calls).toEqual([[driverLog]]);

      target = nextTarget;
      files.set(driverLog, "original\nmanual append\n");
      await vi.advanceTimersByTimeAsync(10);
      expect(onPaths).toHaveBeenLastCalledWith([nextDriverLog, driverLog]);

      target = undefined;
      files.set(driverLog, "original\nmanual append\nmanual only\n");
      files.set(nextDriverLog, "new game\nstale append\n");
      await vi.advanceTimersByTimeAsync(10);
      expect(onPaths).toHaveBeenLastCalledWith([driverLog]);
      expect(onFileLine.mock.calls).toEqual([
        [driverLog, "original"],
        [nextDriverLog, "new game"],
        [driverLog, "manual append"],
        [driverLog, "manual only"],
      ]);
    } finally {
      stop();
    }
  });

  it("republishes identical paths and resets auto-only state for a new target reference", async () => {
    vi.useFakeTimers();
    const { readFile } = mockFilesystem(new Map([[driverLog, ""]]));
    let target = gameTarget;
    const onPaths = vi.fn();
    const stop = createLogFileTail({
      getGameTarget: () => target,
      getManualPaths: () => [],
      onPaths,
      onLine: () => undefined,
      pollIntervalMs: 10,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      target = { ...target };
      await vi.advanceTimersByTimeAsync(20);
      expect(onPaths.mock.calls).toEqual([[[driverLog]], [[driverLog]]]);
      expect(readFile.mock.calls).toEqual([[driverLog], [driverLog]]);
    } finally {
      stop();
    }
  });

  it("ignores discovery that resolves after the game target changes", async () => {
    vi.useFakeTimers();
    const nextTarget = { ...gameTarget, gameDir: "/games/Next" };
    const nextDriverLog = `${nextTarget.gameDir}/driverError.log`;
    const { getStats, readFile } = mockFilesystem(
      new Map([[nextDriverLog, "new game\n"]])
    );
    let resolveStats!: (stat: { isFile: boolean; size: number }) => void;
    getStats.mockImplementationOnce(
      () =>
        new Promise<{ isFile: boolean; size: number }>(resolve => {
          resolveStats = resolve;
        })
    );
    let target = gameTarget;
    const onPaths = vi.fn();
    const stop = createLogFileTail({
      getGameTarget: () => target,
      getManualPaths: () => [],
      onPaths,
      onLine: () => undefined,
      pollIntervalMs: 10,
    });
    try {
      expect(getStats.mock.calls).toEqual([[driverLog]]);
      target = nextTarget;
      resolveStats({ isFile: true, size: 0 });
      await vi.advanceTimersByTimeAsync(10);
      expect(onPaths.mock.calls).toEqual([[[nextDriverLog]]]);
      expect(readFile.mock.calls).toEqual([[nextDriverLog]]);
    } finally {
      stop();
    }
  });
});
