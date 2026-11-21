import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogWindowClient } from "@src/logging/log-window-client";
import { serializeLogWindowSession } from "@src/logging/log-window-protocol";

const session = serializeLogWindowSession({
  parentPid: 11,
  tab: "launcher",
  focusNonce: 1,
  launcherLogPath: "/tmp/yaaglm.log",
});

function startClient(options?: {
  args?: string[];
  parentAlive?: boolean;
  text?: string;
  session?: string;
}) {
  const exec = vi.fn(async () => ({
    exitCode: options?.parentAlive === false ? 1 : 0,
  }));
  const focus = vi.fn(async () => undefined);
  const exit = vi.fn(async () => undefined);
  const onSession = vi.fn();
  const onLauncherLines = vi.fn();
  const onGameReset = vi.fn();
  const startGameTail = vi.fn(() => vi.fn());
  const stop = createLogWindowClient({
    args: options?.args ?? ["--yaagl-window=logs", "--yaagl-parent-pid=11"],
    readSession: async () => options?.session ?? session,
    exec,
    readFile: async () =>
      options?.text ?? "[2026-01-02T03:04:05.000Z] [INFO] ready\n",
    stats: async () => ({ size: (options?.text ?? "ready").length }),
    focus,
    exit,
    onSession,
    onLauncherLines,
    onGameReset,
    startGameTail,
    pollMs: 20,
    parentMissesBeforeExit: 2,
  });
  return {
    stop,
    exec,
    focus,
    exit,
    onSession,
    onLauncherLines,
    onGameReset,
    startGameTail,
  };
}

describe("log window client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds launcher lines without focusing the first session", async () => {
    vi.useFakeTimers();
    const client = startClient();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.onLauncherLines).toHaveBeenCalledOnce();
    expect(client.focus).not.toHaveBeenCalled();
    expect(client.onSession).toHaveBeenCalled();
    client.stop();
  });

  it("focuses when the launcher requests the window again", async () => {
    vi.useFakeTimers();
    let current = session;
    const focus = vi.fn(async () => undefined);
    const stop = createLogWindowClient({
      args: ["--yaagl-parent-pid=11"],
      readSession: async () => current,
      exec: async () => ({ exitCode: 0 }),
      readFile: async () => "[2026-01-02T03:04:05.000Z] [INFO] ready\n",
      stats: async () => ({ size: 1 }),
      focus,
      exit: async () => undefined,
      onSession: () => undefined,
      onLauncherLines: () => undefined,
      onGameReset: () => undefined,
      startGameTail: () => () => undefined,
      pollMs: 20,
    });
    await vi.advanceTimersByTimeAsync(0);
    current = serializeLogWindowSession({
      parentPid: 11,
      tab: "game",
      focusNonce: 2,
      launcherLogPath: "/tmp/yaaglm.log",
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(focus).toHaveBeenCalledOnce();
    stop();
  });

  it("exits after the parent pid stays gone", async () => {
    vi.useFakeTimers();
    const client = startClient({ parentAlive: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(client.exit).toHaveBeenCalledOnce();
    client.stop();
  });

  it("uses the session parent pid when launch arguments omit it", async () => {
    vi.useFakeTimers();
    const client = startClient({
      args: ["--yaagl-window=logs"],
      parentAlive: false,
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(client.exit).toHaveBeenCalledOnce();
    client.stop();
  });

  it("restarts the game tail when the launch generation changes", async () => {
    vi.useFakeTimers();
    let current = serializeLogWindowSession({
      parentPid: 11,
      tab: "game",
      focusNonce: 1,
      launcherLogPath: "/tmp/yaaglm.log",
      game: {
        prefix: "/prefix",
        gameDir: "/game",
        generation: 1,
        locations: [],
      },
    });
    const startGameTail = vi.fn(() => vi.fn());
    const onGameReset = vi.fn();
    const stop = createLogWindowClient({
      args: ["--yaagl-parent-pid=11"],
      readSession: async () => current,
      exec: async () => ({ exitCode: 0 }),
      readFile: async () => "",
      stats: async () => ({ size: 0 }),
      focus: async () => undefined,
      exit: async () => undefined,
      onSession: () => undefined,
      onLauncherLines: () => undefined,
      onGameReset,
      startGameTail,
      pollMs: 20,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(startGameTail).toHaveBeenCalledOnce();
    current = serializeLogWindowSession({
      parentPid: 11,
      tab: "game",
      focusNonce: 1,
      launcherLogPath: "/tmp/yaaglm.log",
      game: {
        prefix: "/prefix",
        gameDir: "/game",
        generation: 2,
        locations: [],
      },
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(startGameTail).toHaveBeenCalledTimes(2);
    expect(onGameReset).toHaveBeenCalledTimes(2);
    stop();
  });
});
