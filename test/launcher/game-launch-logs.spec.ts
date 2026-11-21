import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGameLaunchProgram } from "@src/launcher/controller/hyp-controller";
import { getKeyOrDefault } from "@runtime/storage";

vi.mock("@runtime/storage", () => ({
  getKeyOrDefault: vi.fn(),
}));

vi.mock("@wine/multi-game", () => ({
  ensureMultiGameGameWine: vi.fn(),
}));

const getDebugMode = vi.mocked(getKeyOrDefault);

function game() {
  return {
    config: { advancedEnable: true },
    wineRef: { current: { prefix: "/prefix" } },
    client: {
      installState: () => "INSTALLED" as const,
      installDir: () => "/game",
      gameLogLocations: [{ root: "game-install" as const, path: "Player.log" }],
      launch: vi.fn(async function* () {
        yield ["setProgress", 1] as ["setProgress", number];
      }),
    },
  };
}

describe("game launch debug logs", () => {
  beforeEach(() => {
    getDebugMode.mockReset();
  });

  it("opens the independent log window when debug mode is enabled", async () => {
    getDebugMode.mockResolvedValue("true");
    const onDebugLogs = vi.fn(async () => undefined);
    const current = game();
    const program = createGameLaunchProgram({
      game: current as never,
      baseWine: { prefix: "/base" } as never,
      onDebugLogs,
    });
    await program.next();
    expect(onDebugLogs).toHaveBeenCalledWith({
      prefix: "/prefix",
      gameDir: "/game",
      locations: [{ root: "game-install", path: "Player.log" }],
    });
    expect(current.client.launch).toHaveBeenCalledOnce();
  });

  it("still launches when the log window cannot be opened", async () => {
    getDebugMode.mockResolvedValue("true");
    const current = game();
    const program = createGameLaunchProgram({
      game: current as never,
      baseWine: { prefix: "/base" } as never,
      onDebugLogs: async () => {
        throw new Error("window failed");
      },
    });
    await program.next();
    expect(current.client.launch).toHaveBeenCalledOnce();
  });

  it("does not open logs when debug mode is off", async () => {
    getDebugMode.mockResolvedValue("false");
    const onDebugLogs = vi.fn();
    const current = game();
    const program = createGameLaunchProgram({
      game: current as never,
      baseWine: { prefix: "/base" } as never,
      onDebugLogs,
    });
    await program.next();
    expect(onDebugLogs).not.toHaveBeenCalled();
  });
});
