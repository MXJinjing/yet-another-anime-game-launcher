import { describe, expect, it } from "vitest";
import {
  closeMonitoredPath,
  gameLogTabLabel,
  LAUNCHER_LOG_TAB,
  layoutLogTabs,
  openMonitoredPaths,
  reopenMonitoredPath,
  selectionAfterClose,
  validatePickedLogPaths,
} from "@src/logging/log-window-files";

const gameLogs = [
  "/prefix/drive_c/users/a/AppData/LocalLow/AnimeCompany/示例游戏/output_log.txt",
  "/prefix/drive_c/users/a/AppData/LocalLow/AnimeCompany/The Anime Game Global/output_log.txt",
  "/prefix/drive_c/users/a/AppData/LocalLow/OtherAnimeCompany/The Anime Game Global/Player.log",
];

describe("game log tabs", () => {
  it("folds excess and closed files without hiding the selected file", () => {
    const paths = ["/one.log", "/two.log", "/three.log", "/closed.log"];
    const closed = new Set([paths[3]]);
    expect(layoutLogTabs(paths, closed, paths[2], 435)).toEqual({
      visible: [paths[0], paths[2]],
      folded: [paths[1], paths[3]],
    });
    expect(layoutLogTabs(paths, closed, paths[1], 1)).toEqual({
      visible: [paths[1]],
      folded: [paths[0], paths[2], paths[3]],
    });
    expect(layoutLogTabs(paths, closed, LAUNCHER_LOG_TAB, 580)).toEqual({
      visible: paths.slice(0, 3),
      folded: [paths[3]],
    });
  });

  it("accepts distinct absolute regular files and ignores invalid selections", async () => {
    const checked: string[] = [];
    const isFile = async (path: string) => {
      checked.push(path);
      if (path === "/missing.log") throw new Error("not found");
      return path !== "/directory";
    };
    expect(await validatePickedLogPaths([], isFile)).toEqual([]);
    expect(
      await validatePickedLogPaths(
        [
          "relative.log",
          "/a/log.txt",
          "/a/./log.txt",
          "/missing.log",
          "/directory",
          "/b.log",
        ],
        isFile
      )
    ).toEqual(["/a/log.txt", "/b.log"]);
    expect(checked).toEqual([
      "/a/log.txt",
      "/missing.log",
      "/directory",
      "/b.log",
    ]);
  });
  it("keeps a unique file name and disambiguates collisions with parent folders", () => {
    expect(gameLogTabLabel(gameLogs[2], gameLogs)).toBe("Player.log");
    expect(gameLogTabLabel(gameLogs[0], gameLogs)).toBe(
      "示例游戏/output_log.txt"
    );
    expect(gameLogTabLabel(gameLogs[1], gameLogs)).toBe(
      "The Anime Game Global/output_log.txt"
    );
  });

  it("uses another parent folder when the same product name exists twice", () => {
    const paths = [
      "/prefix/drive_c/users/a/AppData/LocalLow/AnimeCompany/示例游戏/output_log.txt",
      "/prefix/drive_c/users/b/AppData/LocalLow/AnimeCompany/示例游戏/output_log.txt",
    ];
    expect(gameLogTabLabel(paths[0], paths)).toBe(
      "a/AppData/LocalLow/AnimeCompany/示例游戏/output_log.txt"
    );
    expect(gameLogTabLabel(paths[1], paths)).toBe(
      "b/AppData/LocalLow/AnimeCompany/示例游戏/output_log.txt"
    );
  });

  it("opens every monitored file until the user closes it", () => {
    expect(openMonitoredPaths(gameLogs, new Set())).toEqual(gameLogs);
    const closed = closeMonitoredPath(new Set(), gameLogs[0]);
    expect(openMonitoredPaths(gameLogs, closed)).toEqual(gameLogs.slice(1));
    expect(
      openMonitoredPaths(gameLogs, reopenMonitoredPath(closed, gameLogs[0]))
    ).toEqual(gameLogs);
  });

  it("leaves the launcher tab selected when a different file tab is closed", () => {
    expect(selectionAfterClose("launcher", gameLogs.slice(1))).toBe("launcher");
    expect(selectionAfterClose(gameLogs[0], gameLogs.slice(1))).toBe(
      gameLogs[1]
    );
    expect(selectionAfterClose(gameLogs[0], [])).toBe("launcher");
  });
});
