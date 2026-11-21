import { describe, expect, it, vi } from "vitest";
import { createLogWindowHost } from "@src/logging/log-window-host";
import { parseLogWindowSession } from "@src/logging/log-window-protocol";

function hostWith(options?: {
  alive?: boolean;
  pid?: number;
  parentPid?: number;
}) {
  let stored: string | undefined;
  const exec = vi.fn(async (command: string) => ({
    exitCode: command.includes(" -0 ") && options?.alive === false ? 1 : 0,
  }));
  const createWindow = vi.fn(async () => ({ pid: options?.pid ?? 77 }));
  const host = createLogWindowHost({
    parentPid: options?.parentPid ?? 11,
    launcherLogPath: "/tmp/yaaglm.log",
    readSession: async () => stored,
    writeSession: async text => {
      stored = text;
    },
    createWindow,
    exec,
  });
  return { host, exec, createWindow, stored: () => stored };
}

describe("log window host", () => {
  it("creates one window and records its pid", async () => {
    const { host, createWindow, stored } = hostWith();
    await host.open("launcher");
    expect(createWindow).toHaveBeenCalledOnce();
    expect(createWindow).toHaveBeenCalledWith(
      "--yaagl-window=logs --yaagl-parent-pid=11"
    );
    expect(parseLogWindowSession(stored() ?? "")).toMatchObject({
      windowPid: 77,
      tab: "launcher",
      launcherLogPath: "/tmp/yaaglm.log",
    });
  });

  it("focuses an existing window instead of creating another", async () => {
    const { host, createWindow, stored } = hostWith({ alive: true });
    await host.open("launcher");
    await host.open("launcher");
    expect(createWindow).toHaveBeenCalledOnce();
    expect(parseLogWindowSession(stored() ?? "")?.focusNonce).toBe(2);
  });

  it("opens the game tab for a debug launch and replaces the generation", async () => {
    const { host, stored } = hostWith({ alive: true });
    await host.publishGame({
      prefix: "/prefix",
      gameDir: "/game",
      locations: [{ root: "game-install", path: "Player.log" }],
    });
    await host.publishGame({
      prefix: "/prefix",
      gameDir: "/game",
      locations: [],
    });
    const session = parseLogWindowSession(stored() ?? "");
    expect(session?.tab).toBe("game");
    expect(session?.game?.generation).toBe(2);
  });

  it("kills the recorded window when the launcher exits", async () => {
    const { host, exec, stored } = hostWith({ alive: true });
    await host.open("launcher");
    exec.mockClear();
    await host.close();
    expect(exec).toHaveBeenCalledWith("/bin/kill -KILL 77");
    expect(parseLogWindowSession(stored() ?? "")?.windowPid).toBeUndefined();
  });

  it("does not kill a window that has already exited", async () => {
    const { host, exec } = hostWith({ alive: false });
    await host.open("launcher");
    exec.mockClear();
    await host.close();
    expect(exec).not.toHaveBeenCalledWith("/bin/kill -KILL 77");
  });

  it("refuses to create a window without a launcher pid", async () => {
    const { host, createWindow } = hostWith({ parentPid: 0 });
    await expect(host.open("launcher")).rejects.toThrow(/process id/);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("does not keep a bogus process id", async () => {
    const { host, stored } = hostWith({ pid: 0 });
    await expect(host.open("launcher")).rejects.toThrow(/process id/);
    expect(parseLogWindowSession(stored() ?? "")?.windowPid).toBeUndefined();
  });
});
