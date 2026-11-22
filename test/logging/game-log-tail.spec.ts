import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BH3_GAME_LOG_LOCATIONS,
  CBJQ_GAME_LOG_LOCATIONS,
  getHK4EGameLogLocations,
  HKRPG_GAME_LOG_LOCATIONS,
  NAP_GAME_LOG_LOCATIONS,
} from "@src/clients/game-log-paths";
import {
  createGameLogTail,
  findGameLogFiles,
} from "@src/logging/game-log-tail";

const prefix = "/prefix";
const gameDir = "/games/The Anime Game";
const driverLog = `${gameDir}/driverError.log`;

const users = `${prefix}/drive_c/users`;
const localLow = `${users}/crossover/AppData/LocalLow`;
const mainLog = `${localLow}/miHoYo/原神/output_log.txt`;

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
        [localLow + "/miHoYo/Genshin Impact/output_log.txt", "other release"],
        [localLow + "/unrelated/output_log.txt", "unrelated"],
      ])
    );
    const locations = [
      ...getHK4EGameLogLocations("cn"),
      {
        root: "wine-user",
        path: "AppData/LocalLow/miHoYo/原神/output_log.txt",
      } as const,
    ];
    expect(await findGameLogFiles({ prefix, gameDir, locations })).toEqual([
      mainLog,
    ]);
    expect(readDirectory.mock.calls).toEqual([[users]]);
    expect(getStats).not.toHaveBeenCalledWith(
      localLow + "/miHoYo/Genshin Impact/output_log.txt"
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
