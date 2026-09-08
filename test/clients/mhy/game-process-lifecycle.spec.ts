import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/neutralino", () => ({
  removeFile: vi.fn(async () => undefined),
  resolve: (path: string) => `/launcher/${path.replace(/^\.\//, "")}`,
  writeBinary: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("@runtime/macos-filesystem", () => ({
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
import type { TaskProgressCommand } from "@tasks/task-program";
import type { Wine } from "@wine";
import { launchGameProgram as launchHk4e } from "@src/clients/mhy/hk4e/program-launch-game";
import { launchGameProgram as launchHkrpg } from "@src/clients/mhy/hkrpg/program-launch-game";
import { launchGameProgram as launchNap } from "@src/clients/mhy/nap/program-launch-game";
import {
  applyMhypBaseReplacement,
  isRuntimeReplacementFileMissingError,
  revertMhypBaseReplacement,
} from "@src/clients/mhy/patch";
import {
  blockPrivilegedHosts,
  legacyBlockHosts,
} from "@src/system/privileged-hosts";
import { patchRevertProgram } from "@src/clients/mhy/patch";

const config = {
  blockNet: false,
  blockNetDuration: 15,
  blockNetHostsText: "",
  hk4eEnableHDR: false,
  resolutionCustom: false,
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

function server(id: string, executable: string): Server {
  return {
    id,
    executable,
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

function createWine({
  alreadyRunning = false,
  startState = "started",
  exitState = "exited",
}: {
  alreadyRunning?: boolean;
  startState?: "started" | "timed-out" | "unknown";
  exitState?: "exited" | "crashed" | "unknown";
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
    setNVExtension: vi.fn(async () => undefined),
    exec: vi.fn(async () => ({ exitCode: 0, stdOut: "", stdErr: "" })),
    exec2: vi.fn(async () => ({ exitCode: 0, stdOut: "", stdErr: "" })),
    waitUntilServerOff: vi.fn(async () => undefined),
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

describe("game launch process-monitor integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves hk4e to restore after the target exits despite Wine services", async () => {
    const { wine, raw, monitor } = createWine();
    const commands = await collect(
      launchHk4e({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server: server("hk4e_cn", "TargetGame.exe"),
      })
    );

    expect(monitor.isRunning).toHaveBeenCalledOnce();
    expect(monitor.waitForStart).toHaveBeenCalledOnce();
    expect(monitor.waitForExit).toHaveBeenCalledOnce();
    expect(raw.waitForWineServerExit).toHaveBeenCalledWith({
      timeoutMs: 5_000,
    });
    expect(lifecycleStates(commands)).toEqual([
      "GAME_STARTING",
      "GAME_RUNNING",
      "REVERT_PATCHING",
    ]);
  });

  it("preserves hk4e's Steam launch branch", async () => {
    const { wine, raw } = createWine();
    await collect(
      launchHk4e({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config: { ...config, steamPatch: true },
        server: server("hk4e_global", "TargetGame.exe"),
      })
    );

    expect(raw.exec2).toHaveBeenCalledWith(
      "C:\\windows\\system32\\steam.exe",
      ["Z:\\game\\TargetGame.exe"],
      expect.objectContaining({ WINEDLLOVERRIDES: "" }),
      expect.stringContaining("game_")
    );
  });

  it("uses indefinite prefix waiting when hkrpg enumeration becomes unknown", async () => {
    const { wine, raw } = createWine({ exitState: "unknown" });
    const commands = await collect(
      launchHkrpg({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server: server("hkrpg_cn", "TargetGame.exe"),
      })
    );

    expect(raw.waitForWineServerExit).toHaveBeenCalledWith({ timeoutMs: 0 });
    expect(lifecycleStates(commands)).toEqual([
      "PATCHING",
      "GAME_STARTING",
      "GAME_RUNNING",
      "REVERT_PATCHING",
    ]);
  });

  it.each([
    ["hkrpg", launchHkrpg, 15],
    ["nap", launchNap, 15],
  ] as const)(
    "applies and restores runtime replacements for %s",
    async (_name, launch, duration) => {
      vi.mocked(applyMhypBaseReplacement).mockResolvedValueOnce(true);
      const { wine } = createWine();
      await collect(
        launch({
          gameDir: "/game",
          gameExecutable: "TargetGame.exe",
          wine,
          config: { ...config, blockNet: true, blockNetDuration: duration },
          server: server(
            _name == "nap" ? "nap_cn" : "hkrpg_cn",
            "TargetGame.exe"
          ),
        })
      );

      expect(applyMhypBaseReplacement).toHaveBeenCalledWith(
        "/game",
        expect.objectContaining({ blockNetDuration: duration })
      );
      expect(revertMhypBaseReplacement).toHaveBeenCalledWith("/game");
      expect(blockPrivilegedHosts).toHaveBeenCalledWith(
        expect.any(Array),
        duration,
        expect.any(Function)
      );
      expect(legacyBlockHosts).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["hkrpg", launchHkrpg, 37],
    ["nap", launchNap, 42],
  ] as const)(
    "passes the configured hosts duration to the legacy fallback for %s",
    async (_name, launch, duration) => {
      vi.mocked(blockPrivilegedHosts).mockImplementationOnce(
        async (_hosts, _ttl, fallback) => {
          await fallback();
        }
      );

      await collect(
        launch({
          gameDir: "/game",
          gameExecutable: "TargetGame.exe",
          wine: createWine().wine,
          config: { ...config, blockNet: true, blockNetDuration: duration },
          server: server(
            _name == "nap" ? "nap_cn" : "hkrpg_cn",
            "TargetGame.exe"
          ),
        })
      );

      expect(legacyBlockHosts).toHaveBeenCalledWith(
        expect.any(Array),
        duration
      );
    }
  );

  it.each([
    ["hkrpg", launchHkrpg],
    ["nap", launchNap],
  ] as const)(
    "cleans regular patches when runtime replacement validation fails for %s",
    async (_name, launch) => {
      const replacementError = new Error("missing replacement");
      vi.mocked(applyMhypBaseReplacement).mockRejectedValueOnce(
        replacementError
      );
      vi.mocked(isRuntimeReplacementFileMissingError).mockReturnValueOnce(true);

      await expect(
        collect(
          launch({
            gameDir: "/game",
            gameExecutable: "TargetGame.exe",
            wine: createWine().wine,
            config,
            server: server(
              _name == "nap" ? "nap_cn" : "hkrpg_cn",
              "TargetGame.exe"
            ),
          })
        )
      ).rejects.toBe(replacementError);
      expect(patchRevertProgram).toHaveBeenCalled();
      expect(revertMhypBaseReplacement).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["hkrpg", launchHkrpg],
    ["nap", launchNap],
  ] as const)(
    "restores runtime replacements after crash and startup timeout for %s",
    async (_name, launch) => {
      for (const state of ["crashed", "timed-out"] as const) {
        vi.clearAllMocks();
        vi.mocked(applyMhypBaseReplacement).mockResolvedValueOnce(true);
        const { wine } = createWine(
          state == "timed-out"
            ? { startState: "timed-out" }
            : { exitState: "crashed" }
        );

        await collect(
          launch({
            gameDir: "/game",
            gameExecutable: "TargetGame.exe",
            wine,
            config,
            server: server(
              _name == "nap" ? "nap_cn" : "hkrpg_cn",
              "TargetGame.exe"
            ),
          })
        );

        expect(revertMhypBaseReplacement).toHaveBeenCalledWith("/game");
      }
    }
  );

  it.each([
    ["hkrpg", launchHkrpg],
    ["nap", launchNap],
  ] as const)(
    "does not restore when runtime replacement is not applied for %s",
    async (_name, launch) => {
      const { wine } = createWine();
      await collect(
        launch({
          gameDir: "/game",
          gameExecutable: "TargetGame.exe",
          wine,
          config,
          server: server(
            _name == "nap" ? "nap_cn" : "hkrpg_cn",
            "TargetGame.exe"
          ),
        })
      );

      expect(applyMhypBaseReplacement).toHaveBeenCalledWith("/game", config);
      expect(revertMhypBaseReplacement).not.toHaveBeenCalled();
    }
  );

  it("emits the crash event before restoring a short-lived hk4e session", async () => {
    const { wine } = createWine({ exitState: "crashed" });
    const commands = await collect(
      launchHk4e({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server: server("hk4e_cn", "TargetGame.exe"),
      })
    );

    expect(lifecycleStates(commands)).toEqual([
      "GAME_STARTING",
      "GAME_RUNNING",
      "GAME_CRASHED",
      "REVERT_PATCHING",
    ]);
  });

  it("rejects a duplicate hk4e launch before changing Wine or game files", async () => {
    const { wine, raw } = createWine({ alreadyRunning: true });

    await expect(
      collect(
        launchHk4e({
          gameDir: "/game",
          gameExecutable: "TargetGame.exe",
          wine,
          config,
          server: server("hk4e_cn", "TargetGame.exe"),
        })
      )
    ).rejects.toThrow("already running");
    expect(raw.setProps).not.toHaveBeenCalled();
    expect(raw.exec2).not.toHaveBeenCalled();
  });

  it("kills the prefix before restoring after an hk4e startup timeout", async () => {
    const { wine, raw, monitor } = createWine({ startState: "timed-out" });
    const commands = await collect(
      launchHk4e({
        gameDir: "/game",
        gameExecutable: "TargetGame.exe",
        wine,
        config,
        server: server("hk4e_cn", "TargetGame.exe"),
      })
    );

    expect(raw.killAll).toHaveBeenCalledOnce();
    expect(monitor.waitForExit).not.toHaveBeenCalled();
    expect(lifecycleStates(commands)).toEqual([
      "GAME_STARTING",
      "REVERT_PATCHING",
    ]);
  });
});
