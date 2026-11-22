import { describe, expect, it, vi } from "vitest";
import { createLogWindowHost } from "@src/logging/log-window-host";
import { parseLogWindowSession } from "@src/logging/log-window-protocol";

type WindowState = "running" | "zombie" | "missing" | "recycled";

function hostWith(options?: {
  window?: WindowState;
  pid?: number;
  parentPid?: number;
}) {
  let stored: string | undefined;
  let windowState: WindowState = options?.window ?? "missing";
  const parentPid = options?.parentPid ?? 11;
  const commandLine = (state: string) =>
    `${state} /Applications/Yaaglm --url=/ --yaagl-window=logs ` +
    `--yaagl-parent-pid=${parentPid}`;
  const exec = vi.fn(async (command: string) => {
    if (!command.startsWith("/bin/ps ")) return { exitCode: 0, stdOut: "" };
    switch (windowState) {
      case "running":
        return { exitCode: 0, stdOut: commandLine("S+") };
      // A closed window stays a zombie until the launcher exits.
      case "zombie":
        return { exitCode: 0, stdOut: commandLine("Z+") };
      case "recycled":
        return { exitCode: 0, stdOut: "S /usr/bin/unrelated" };
      default:
        return { exitCode: 1, stdOut: "" };
    }
  });
  const createWindow = vi.fn(async () => ({ pid: options?.pid ?? 77 }));
  const host = createLogWindowHost({
    parentPid,
    launcherLogPath: "/tmp/yaaglm.log",
    readSession: async () => stored,
    writeSession: async text => {
      stored = text;
    },
    createWindow,
    exec,
  });
  return {
    host,
    exec,
    createWindow,
    stored: () => stored,
    setWindowState: (state: WindowState) => {
      windowState = state;
    },
  };
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
    const { host, createWindow, stored } = hostWith({ window: "running" });
    await host.open("launcher");
    await host.open("launcher");
    expect(createWindow).toHaveBeenCalledOnce();
    expect(parseLogWindowSession(stored() ?? "")?.focusNonce).toBe(2);
  });

  it("reopens the window after it was closed", async () => {
    const context = hostWith();
    await context.host.open("launcher");
    // Closing the window kills the process, but Neutralino never reaps it, so
    // it lingers as a zombie for the rest of the launcher session.
    context.setWindowState("zombie");
    await context.host.open("launcher");
    expect(context.createWindow).toHaveBeenCalledTimes(2);
    expect(parseLogWindowSession(context.stored() ?? "")?.windowPid).toBe(77);
  });

  it("does not reuse a pid that now belongs to another process", async () => {
    const context = hostWith();
    await context.host.open("launcher");
    context.setWindowState("recycled");
    await context.host.open("launcher");
    expect(context.createWindow).toHaveBeenCalledTimes(2);
  });

  it("opens the game tab for a debug launch and replaces the generation", async () => {
    const { host, stored } = hostWith({ window: "running" });
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
    const { host, exec, stored } = hostWith({ window: "running" });
    await host.open("launcher");
    exec.mockClear();
    await host.close();
    expect(exec).toHaveBeenCalledWith("/bin/kill -KILL 77");
    expect(parseLogWindowSession(stored() ?? "")?.windowPid).toBeUndefined();
  });

  it("does not kill a window that has already exited", async () => {
    const { host, exec } = hostWith({ window: "zombie" });
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
