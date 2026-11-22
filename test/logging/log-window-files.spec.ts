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

const genshin = [
  "/prefix/drive_c/users/a/AppData/LocalLow/miHoYo/原神/output_log.txt",
  "/prefix/drive_c/users/a/AppData/LocalLow/miHoYo/Genshin Impact/output_log.txt",
  "/prefix/drive_c/users/a/AppData/LocalLow/HoYoverse/Genshin Impact/Player.log",
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
    expect(gameLogTabLabel(genshin[2], genshin)).toBe("Player.log");
    expect(gameLogTabLabel(genshin[0], genshin)).toBe("原神/output_log.txt");
    expect(gameLogTabLabel(genshin[1], genshin)).toBe(
      "Genshin Impact/output_log.txt"
    );
  });

  it("uses another parent folder when the same product name exists twice", () => {
    const paths = [
      "/prefix/drive_c/users/a/AppData/LocalLow/miHoYo/原神/output_log.txt",
      "/prefix/drive_c/users/b/AppData/LocalLow/miHoYo/原神/output_log.txt",
    ];
    expect(gameLogTabLabel(paths[0], paths)).toBe(
      "a/AppData/LocalLow/miHoYo/原神/output_log.txt"
    );
    expect(gameLogTabLabel(paths[1], paths)).toBe(
      "b/AppData/LocalLow/miHoYo/原神/output_log.txt"
    );
  });

  it("opens every monitored file until the user closes it", () => {
    expect(openMonitoredPaths(genshin, new Set())).toEqual(genshin);
    const closed = closeMonitoredPath(new Set(), genshin[0]);
    expect(openMonitoredPaths(genshin, closed)).toEqual(genshin.slice(1));
    expect(
      openMonitoredPaths(genshin, reopenMonitoredPath(closed, genshin[0]))
    ).toEqual(genshin);
  });

  it("leaves the launcher tab selected when a different file tab is closed", () => {
    expect(selectionAfterClose("launcher", genshin.slice(1))).toBe("launcher");
    expect(selectionAfterClose(genshin[0], genshin.slice(1))).toBe(genshin[1]);
    expect(selectionAfterClose(genshin[0], [])).toBe("launcher");
  });
});
