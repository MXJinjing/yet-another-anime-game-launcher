import { describe, expect, it } from "vitest";
import {
  appendCapped,
  chooseLogWindowSession,
  consumeLauncherLogText,
  gameTailIdentity,
  isLogWindowArgs,
  isLogWindowProcessRunning,
  logWindowCreateRequest,
  logWindowProcessArgs,
  logWindowProcessStateCommand,
  parentPidFromArgs,
  parseLauncherLogLine,
  parseLogWindowSession,
  posixSignalCommand,
  seedLauncherLog,
  serializeLogWindowSession,
  withFocusedTab,
} from "@src/logging/log-window-protocol";

describe("log window protocol", () => {
  it("recognizes the log window flag in split or combined arguments", () => {
    expect(isLogWindowArgs(["--yaagl-window=logs"])).toBe(true);
    expect(
      isLogWindowArgs([
        "--load-dir-res",
        "--yaagl-window=logs --yaagl-parent-pid=42",
      ])
    ).toBe(true);
    expect(isLogWindowArgs(["--window-id=main"])).toBe(false);
    expect(isLogWindowArgs(undefined)).toBe(false);
  });

  it("reads only a positive integer parent pid", () => {
    expect(parentPidFromArgs(["--yaagl-parent-pid=42"])).toBe(42);
    expect(
      parentPidFromArgs(["--yaagl-window=logs --yaagl-parent-pid=7"])
    ).toBe(7);
    expect(parentPidFromArgs(["--yaagl-parent-pid=0"])).toBeUndefined();
    expect(parentPidFromArgs(["--yaagl-parent-pid=nope"])).toBeUndefined();
    expect(logWindowProcessArgs(1.5)).toBeUndefined();
  });

  it("asks for an independent closable window that does not save over the main window", () => {
    expect(logWindowCreateRequest(9)).toMatchObject({
      url: "/",
      processArgs: "--yaagl-window=logs --yaagl-parent-pid=9",
      hidden: false,
      resizable: true,
      exitProcessOnClose: true,
      useSavedState: false,
      enableInspector: false,
    });
    expect(logWindowCreateRequest(-1)).toBeUndefined();
  });

  it("builds kill commands only for real process ids", () => {
    expect(posixSignalCommand(15, "0")).toBe("/bin/kill -0 15");
    expect(posixSignalCommand(15, "KILL")).toBe("/bin/kill -KILL 15");
    expect(posixSignalCommand(0, "KILL")).toBeUndefined();
    expect(posixSignalCommand(Number.NaN, "KILL")).toBeUndefined();
  });

  it("inspects the logged window process instead of signalling it", () => {
    expect(logWindowProcessStateCommand(15)).toBe(
      "/bin/ps -p 15 -ww -o stat= -o command="
    );
    expect(logWindowProcessStateCommand(0)).toBeUndefined();
    expect(logWindowProcessStateCommand(Number.NaN)).toBeUndefined();
  });

  it("treats zombies, recycled pids and empty output as closed windows", () => {
    const running =
      "S+ /Applications/Yaaglm.app/Contents/MacOS/Yaaglm --url=/ " +
      "--yaagl-window=logs --yaagl-parent-pid=42";
    expect(isLogWindowProcessRunning(running, 42)).toBe(true);
    expect(isLogWindowProcessRunning(running, 43)).toBe(false);
    // A closed window keeps its pid as a zombie until the launcher exits.
    expect(isLogWindowProcessRunning(running.replace("S+", "Z+"), 42)).toBe(
      false
    );
    // The pid may be reused by an unrelated process after a restart.
    expect(isLogWindowProcessRunning("S /usr/bin/other --flag", 42)).toBe(
      false
    );
    expect(isLogWindowProcessRunning("", 42)).toBe(false);
    expect(isLogWindowProcessRunning(undefined, 42)).toBe(false);
  });

  it("parses launcher log lines and keeps a partial trailing line", () => {
    expect(
      parseLauncherLogLine("[2026-01-02T03:04:05.000Z] [ERROR] disk full")
    ).toEqual({
      time: "2026-01-02T03:04:05.000Z",
      level: "ERROR",
      message: "disk full",
    });
    expect(parseLauncherLogLine("not a launcher line")).toBeUndefined();
    const first = consumeLauncherLogText(
      "",
      "[2026-01-02T03:04:05.000Z] [INFO] one\n[2026-01-02T03:04:06.000Z] [WARNING] tw"
    );
    expect(first.entries.map(entry => entry.message)).toEqual(["one"]);
    const second = consumeLauncherLogText(first.pending, "o\n");
    expect(second.entries.map(entry => entry.message)).toEqual(["two"]);
    expect(second.pending).toBe("");
  });

  it("seeds only the recent launcher history", () => {
    const text = [
      "[2026-01-02T03:04:05.000Z] [INFO] old",
      "[2026-01-02T03:04:06.000Z] [INFO] new",
      "",
    ].join("\n");
    const seeded = seedLauncherLog(text, 1);
    expect(seeded.entries.map(entry => entry.message)).toEqual(["new"]);
    expect(seeded.offset).toBe(text.length);
    expect(seeded.pending).toBe("");
  });

  it("caps retained lines without mutating the previous list", () => {
    const current = ["a", "b"];
    expect(appendCapped(current, ["c", "d"], 3)).toEqual(["b", "c", "d"]);
    expect(current).toEqual(["a", "b"]);
    expect(appendCapped(["a"], [], 2)).toEqual(["a"]);
  });

  it("round-trips a session and ignores a corrupt game payload", () => {
    const session = {
      parentPid: 4,
      windowPid: 8,
      tab: "game" as const,
      focusNonce: 2,
      launcherLogPath: "/tmp/yaaglm.log",
      accent: "#0091FF",
      game: {
        prefix: "/prefix",
        gameDir: "/game",
        generation: 3,
        locations: [{ root: "game-install" as const, path: "Player.log" }],
      },
    };
    const parsed = parseLogWindowSession(serializeLogWindowSession(session));
    expect(parsed).toEqual(session);
    const broken = parseLogWindowSession(
      JSON.stringify({ ...session, game: { prefix: 1 } })
    );
    expect(broken?.game).toBeUndefined();
    expect(broken?.launcherLogPath).toBe("/tmp/yaaglm.log");
    expect(parseLogWindowSession("{")).toBeUndefined();
    expect(
      parseLogWindowSession(JSON.stringify({ tab: "launcher" }))
    ).toBeUndefined();
  });

  it("drops an accent that is not a plain hex colour", () => {
    const base = {
      parentPid: 4,
      tab: "launcher",
      focusNonce: 1,
      launcherLogPath: "/tmp/yaaglm.log",
    };
    expect(
      parseLogWindowSession(JSON.stringify({ ...base, accent: "#0091FF" }))
        ?.accent
    ).toBe("#0091FF");
    expect(
      parseLogWindowSession(
        JSON.stringify({ ...base, accent: "url(http://example.com)" })
      )?.accent
    ).toBeUndefined();
  });

  it("prefers the session with the newer focus request", () => {
    const older = serializeLogWindowSession({
      parentPid: 1,
      tab: "launcher",
      focusNonce: 1,
      launcherLogPath: "/tmp/yaaglm.log",
    });
    const newer = serializeLogWindowSession({
      parentPid: 1,
      tab: "game",
      focusNonce: 2,
      launcherLogPath: "/tmp/yaaglm.log",
    });
    expect(chooseLogWindowSession([older, undefined, newer])?.tab).toBe("game");
    expect(chooseLogWindowSession([undefined, "nope"])).toBeUndefined();
  });

  it("changes the game tail identity when a new launch starts", () => {
    const game = {
      prefix: "/prefix",
      gameDir: "/game",
      generation: 1,
      locations: [],
    };
    const focused = withFocusedTab(
      {
        parentPid: 1,
        tab: "launcher",
        focusNonce: 1,
        launcherLogPath: "/tmp/yaaglm.log",
        game,
      },
      "game",
      { ...game, generation: 2 }
    );
    expect(focused.tab).toBe("game");
    expect(focused.focusNonce).toBe(2);
    expect(gameTailIdentity(game)).not.toBe(gameTailIdentity(focused.game));
  });
});
