import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/neutralino", () => ({
  readBinary: vi.fn(async () =>
    new TextEncoder().encode(
      "Screenmanager Resolution Width_h182942802    REG_DWORD    0x780\r\n"
    )
  ),
  removeFile: vi.fn(async () => undefined),
  removeFileIfExists: vi.fn(async () => undefined),
  resolve: (path: string) => `/launcher/${path.replace(/^\.\//, "")}`,
  writeBinary: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("@runtime/macos-filesystem", () => ({
  cp: vi.fn(async () => undefined),
  mkdirp: vi.fn(async () => undefined),
}));

vi.mock("@src/system/privileged-hosts", () => ({
  blockPrivilegedHosts: vi.fn(async () => undefined),
  legacyBlockHosts: vi.fn(async () => undefined),
}));

vi.mock("@src/clients/mhy/patch", () => ({
  putLocal: vi.fn(async () => undefined),
  patchProgram: vi.fn(async function* () {
    yield ["setRawStateText", "mock patch"];
  }),
  patchRevertProgram: vi.fn(async function* () {
    yield ["setRawStateText", "mock revert"];
  }),
  applyMhypBaseReplacement: vi.fn(async () => false),
  isRuntimeReplacementFileMissingError: vi.fn(() => false),
  revertMhypBaseReplacement: vi.fn(async () => undefined),
}));

import type { Config } from "@config";
import type { Server } from "@constants";
import { removeFile } from "@platform/neutralino";
import type { TaskProgressCommand } from "@tasks/task-program";
import type { Wine } from "@wine";
import { cp } from "@runtime/macos-filesystem";
import { patchProgram, patchRevertProgram } from "@src/clients/mhy/patch";
import { launchGameProgram } from "@src/clients/mhy/nap/program-launch-game";

const config = {
  blockNet: false,
  resolutionCustom: true,
  resolutionWidth: 1920,
  resolutionHeight: 1080,
  steamPatch: false,
  metalHud: false,
  timeoutFix: false,
  preferredMaxFps: 60,
  vsyncDisable: false,
  metalFxEnable: false,
  metalFxFactor: 1,
  proxyEnabled: false,
  proxyHost: "",
} as unknown as Config;

function server(id: "nap_cn" | "nap_global"): Server {
  return {
    id,
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
  };
}

type WineExecArgs = [
  program: string,
  args: string[],
  env?: Record<string, string>,
  logFile?: string
];

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
    wineRoot: "/wine",
    attributes: {} as Wine["attributes"],
    createGameProcessMonitor: vi.fn(() => monitor),
    setProps: vi.fn(async () => undefined),
    setNVExtension: vi.fn(async () => undefined),
    clearNVExtension: vi.fn(async () => undefined),
    exec: vi.fn(async (..._args: WineExecArgs) => ({
      exitCode: 0,
      stdOut: "",
      stdErr: "",
    })),
    exec2: vi.fn(async (..._args: WineExecArgs) => ({
      exitCode: 0,
      stdOut: "",
      stdErr: "",
    })),
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

describe("nap game process lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores after the target exits without waiting indefinitely for Wine services", async () => {
    const { wine, raw, monitor } = createWine();
    const commands = await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server: server("nap_cn"),
      })
    );

    expect(monitor.isRunning).toHaveBeenCalledOnce();
    expect(monitor.waitForStart).toHaveBeenCalledWith({
      timeoutMs: 180_000,
    });
    expect(monitor.waitForExit).toHaveBeenCalledOnce();
    expect(raw.waitForWineServerExit).toHaveBeenCalledWith({
      timeoutMs: 5_000,
    });
    expect(commands).toContainEqual(["setUndeterminedProgress"]);
    expect(commands.some(command => command[0] == "setRawStateText")).toBe(
      false
    );
    expect(lifecycleStates(commands)).toEqual([
      "GAME_STARTING",
      "GAME_RUNNING",
      "REVERT_PATCHING",
    ]);

    const resolutionQuery = raw.exec.mock.calls.findIndex(
      call =>
        call[0] === "reg" &&
        call[1][0] === "query" &&
        call[3]?.includes("resolution") === true
    );
    expect(resolutionQuery).toBeGreaterThan(-1);
    expect(raw.waitForWineServerExit.mock.invocationCallOrder[0]).toBeLessThan(
      raw.exec.mock.invocationCallOrder[resolutionQuery]
    );
    const configCleanup = vi
      .mocked(removeFile)
      .mock.calls.findIndex(([path]) => path.endsWith("config.bat"));
    expect(configCleanup).toBeGreaterThan(-1);
    expect(raw.exec.mock.invocationCallOrder[resolutionQuery]).toBeLessThan(
      vi.mocked(removeFile).mock.invocationCallOrder[configCleanup]
    );
    expect(
      vi.mocked(removeFile).mock.invocationCallOrder[configCleanup]
    ).toBeLessThan(vi.mocked(patchRevertProgram).mock.invocationCallOrder[0]);
  });

  it("preserves the normal launch command and environment", async () => {
    const { wine, raw } = createWine();
    await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config: { ...config, resolutionCustom: false },
        server: server("nap_global"),
      })
    );

    expect(raw.exec2).toHaveBeenCalledWith(
      "cmd",
      ["/c", "Z:\\launcher\\config.bat "],
      expect.objectContaining({
        MTL_HUD_ENABLED: "",
        WINEDLLOVERRIDES: "",
        WINE_ENABLE_TIMEOUT_FIX: "0",
        WINEESYNC: "1",
      }),
      expect.stringContaining("game_")
    );
  });

  it("keeps ZZZ on the plain DXMT path and cleans NVIDIA leftovers when MetalFX is off", async () => {
    const { wine, raw } = createWine();
    raw.attributes.renderBackend = "dxmt";
    await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config: {
          ...config,
          resolutionCustom: false,
          useD3D12: false,
          napMetalFxEnable: false,
        },
        server: server("nap_cn"),
      })
    );
    expect(raw.setNVExtension).not.toHaveBeenCalled();
    expect(raw.clearNVExtension).toHaveBeenCalledOnce();
    expect(cp).not.toHaveBeenCalled();
    expect(raw.exec2).toHaveBeenCalledWith(
      "cmd",
      expect.any(Array),
      expect.not.objectContaining({
        DXMT_ENABLE_NVEXT: expect.anything(),
        DXMT_METALFX_SPATIAL_SWAPCHAIN: expect.anything(),
      }),
      expect.stringContaining("game_")
    );
    const dxmtConfig = raw.exec2.mock.calls.find(
      call => call[2] && call[2].DXMT_CONFIG
    )?.[2]?.DXMT_CONFIG;
    expect(dxmtConfig).not.toContain("customVendorId");
    expect(dxmtConfig).not.toContain("metalSpatialUpscaleFactor");
  });

  it("enables the NVIDIA DLSS-to-MetalFX bridge when MetalFX is on", async () => {
    const { wine, raw } = createWine();
    raw.attributes.renderBackend = "dxmt";
    await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config: {
          ...config,
          resolutionCustom: false,
          useD3D12: false,
          napMetalFxEnable: true,
          metalFxFactor: 2,
        },
        server: server("nap_cn"),
      })
    );
    expect(raw.setNVExtension).toHaveBeenCalledOnce();
    expect(raw.clearNVExtension).not.toHaveBeenCalled();
    expect(cp).toHaveBeenCalledWith(
      "./dxmt/nvngx.dll",
      "/wine/lib/wine/x86_64-windows/nvngx.dll"
    );
    expect(cp).toHaveBeenCalledWith(
      "./dxmt/nvngx.dll",
      "/prefix/drive_c/windows/system32/nvngx.dll"
    );
    expect(raw.exec2).toHaveBeenCalledWith(
      "cmd",
      expect.any(Array),
      expect.objectContaining({
        DXMT_ENABLE_NVEXT: "1",
        DXMT_METALFX_SPATIAL_SWAPCHAIN: "1",
      }),
      expect.stringContaining("game_")
    );
    const dxmtConfig = raw.exec2.mock.calls.find(
      call => call[2] && call[2].DXMT_CONFIG
    )?.[2]?.DXMT_CONFIG;
    expect(dxmtConfig).toContain(
      "d3d11.metalSpatialUpscaleFactor=2;dxgi.customVendorId=10de;dxgi.customDeviceId=2684"
    );
  });

  it("preserves the Steam patch launch branch", async () => {
    const { wine, raw } = createWine();
    await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config: {
          ...config,
          resolutionCustom: false,
          steamPatch: true,
          useD3D12: true,
        },
        server: server("nap_cn"),
      })
    );

    expect(raw.exec2).toHaveBeenCalledWith(
      "C:\\windows\\system32\\steam.exe",
      ["Z:\\game\\TargetGame.exe", "-use-d3d12"],
      expect.objectContaining({ WINEDLLOVERRIDES: "" }),
      expect.stringContaining("game_")
    );
  });

  it("waits indefinitely for the prefix when process enumeration becomes unknown", async () => {
    const { wine, raw } = createWine({ exitState: "unknown" });
    await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config: { ...config, resolutionCustom: false },
        server: server("nap_global"),
      })
    );

    expect(raw.waitForWineServerExit).toHaveBeenCalledWith({ timeoutMs: 0 });
  });

  it("rejects a duplicate launch before patching or changing Wine", async () => {
    const { wine, raw } = createWine({ alreadyRunning: true });

    await expect(
      collect(
        launchGameProgram({
          gameDir: "/game",
          gameExecutable: "TargetGame.exe",
          wine,
          config,
          server: server("nap_cn"),
        })
      )
    ).rejects.toThrow("already running");
    expect(raw.setProps).not.toHaveBeenCalled();
    expect(raw.exec2).not.toHaveBeenCalled();
    expect(patchProgram).not.toHaveBeenCalled();
  });

  it("kills the prefix before restoring after the startup timeout", async () => {
    const { wine, raw, monitor } = createWine({ startState: "timed-out" });
    const commands = await collect(
      launchGameProgram({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server: server("nap_cn"),
      })
    );

    expect(raw.killAll).toHaveBeenCalledOnce();
    expect(monitor.waitForExit).not.toHaveBeenCalled();
    expect(raw.killAll.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(patchRevertProgram).mock.invocationCallOrder[0]
    );
    expect(lifecycleStates(commands)).toEqual([
      "GAME_STARTING",
      "REVERT_PATCHING",
    ]);
  });
});
