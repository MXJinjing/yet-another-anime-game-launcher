import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/neutralino", () => ({
  removeFile: vi.fn(async () => undefined),
  resolve: (path: string) => `/launcher/${path.replace(/^\.\//, "")}`,
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("@runtime/macos-filesystem", () => ({
  mkdirp: vi.fn(async () => undefined),
}));

vi.mock("@src/clients/mhy/patch", () => ({
  patchProgram: vi.fn(async function* () {
    yield ["setRawStateText", "mock patch"];
  }),
  patchRevertProgram: vi.fn(async function* () {
    yield ["setRawStateText", "mock revert"];
  }),
}));

import type { Config } from "@config";
import type { Server } from "@constants";
import type { TaskProgressCommand } from "@tasks/task-program";
import type { Wine } from "@wine";
import { writeFile } from "@platform/neutralino";
import { launchGameProgram } from "@src/clients/mhy/bh3/program-launch-game";

const config = {
  metalHud: false,
  preferredMaxFps: 60,
  vsyncDisable: false,
  metalFxEnable: false,
  metalFxFactor: 1,
  proxyEnabled: false,
  proxyHost: "",
} as unknown as Config;

const server = {
  id: "bh3_cn",
  executable: "TargetGame.exe",
  update_url: "",
  adv_url: "",
  cps: "",
  channel_id: 1,
  subchannel_id: 1,
  removed: [],
  product_name: "test",
  dataDir: "Data",
  THE_REAL_COMPANY_NAME: "test",
  added: [],
  patched: [],
  hosts: "",
} as Server;

function createWine({
  alreadyRunning = false,
  startState = "started",
  exitState = "exited",
}: {
  alreadyRunning?: boolean;
  startState?: "started" | "timed-out" | "unknown";
  exitState?: "exited" | "unknown";
} = {}) {
  const monitor = {
    listProcesses: vi.fn(async () => []),
    isRunning: vi.fn(async () => alreadyRunning),
    waitForStart: vi.fn(async () => startState),
    waitForExit: vi.fn(async () => exitState),
  };
  const wine = {
    prefix: "/prefix",
    attributes: {},
    createGameProcessMonitor: vi.fn(() => monitor),
    setProps: vi.fn(async () => undefined),
    exec2: vi.fn(async () => ({ exitCode: 0, stdOut: "", stdErr: "" })),
    waitForWineServerExit: vi.fn(async () => true),
    killAll: vi.fn(async () => undefined),
    toWinePath: (path: string) => `Z:${path.replaceAll("/", "\\")}`,
  };
  return { wine: wine as unknown as Wine, raw: wine, monitor };
}

async function collect(program: AsyncGenerator<TaskProgressCommand, void>) {
  const commands: TaskProgressCommand[] = [];
  for await (const command of program) commands.push(command);
  return commands;
}

function lifecycleStates(commands: TaskProgressCommand[]) {
  return commands
    .filter(command => command[0] === "setStateText")
    .map(command => command[1]);
}

describe("bh3 game process lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tracks the target executable and restores after a silent prefix wait", async () => {
    const { wine, raw, monitor } = createWine();
    const commands = await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server,
      })
    );

    expect(raw.createGameProcessMonitor).toHaveBeenCalledWith("TargetGame.exe");
    expect(monitor.waitForStart).toHaveBeenCalledOnce();
    expect(monitor.waitForExit).toHaveBeenCalledOnce();
    expect(raw.waitForWineServerExit).toHaveBeenCalledWith({
      timeoutMs: 5_000,
    });
    expect(lifecycleStates(commands)).toEqual([
      "PATCHING",
      "GAME_STARTING",
      "GAME_RUNNING",
      "REVERT_PATCHING",
    ]);
  });

  it("preserves the Jadeite launch script and environment", async () => {
    const { wine, raw } = createWine();
    await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server,
      })
    );

    expect(writeFile).toHaveBeenCalledWith(
      "/launcher/config.bat",
      expect.stringContaining(
        '"Z:\\launcher\\jadeite\\jadeite.exe" "Z:\\game\\TargetGame.exe"'
      )
    );
    expect(raw.exec2).toHaveBeenCalledWith(
      "cmd",
      ["/c", "Z:\\launcher\\config.bat"],
      expect.objectContaining({
        MVK_ALLOW_METAL_FENCES: "1",
        WINEDLLOVERRIDES: "d3d11,dxgi=n,b",
      }),
      expect.stringContaining("game_")
    );
  });

  it("waits indefinitely when process enumeration becomes unknown", async () => {
    const { wine, raw } = createWine({ exitState: "unknown" });
    await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server,
      })
    );

    expect(raw.waitForWineServerExit).toHaveBeenCalledWith({ timeoutMs: 0 });
  });

  it("rejects a duplicate launch before patch preparation", async () => {
    const { wine, raw } = createWine({ alreadyRunning: true });

    await expect(
      collect(
        launchGameProgram({
          gameDir: "/game",
          gameExecutable: "TargetGame.exe",
          wine,
          config,
          server,
        })
      )
    ).rejects.toThrow("already running");
    expect(raw.setProps).not.toHaveBeenCalled();
    expect(raw.exec2).not.toHaveBeenCalled();
  });

  it("kills the prefix before restoring after the 45-second startup timeout", async () => {
    const { wine, raw, monitor } = createWine({ startState: "timed-out" });
    const commands = await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server,
      })
    );

    expect(monitor.waitForStart).toHaveBeenCalledWith();
    expect(raw.killAll).toHaveBeenCalledOnce();
    expect(monitor.waitForExit).not.toHaveBeenCalled();
    expect(lifecycleStates(commands)).toEqual([
      "PATCHING",
      "GAME_STARTING",
      "REVERT_PATCHING",
    ]);
  });
});
