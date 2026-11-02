import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@settings", () => ({ createGameSettings: vi.fn() }));
vi.mock("@runtime/storage", () => ({
  createStorage: vi.fn((namespace: string) => ({ namespace })),
  getKeyOrDefault: vi.fn(),
}));
vi.mock("@wine", () => ({ getWineDistributions: vi.fn() }));
vi.mock("@logging/logger", () => ({ log: vi.fn() }));
vi.mock("@src/boot-progress", () => ({ reportBootProgress: vi.fn() }));
vi.mock("@src/clients/mhy/hyp-connect", () => ({
  getLatestGameDisplays: vi.fn(),
}));
vi.mock("@src/launcher/controller/hyp-launcher", () => ({
  createHypLauncher: vi.fn(),
}));
vi.mock("@src/launcher/data/multi-game-os", () => ({
  MULTI_GAME_OS_GAME_SPECS: [],
}));
vi.mock("@platform/neutralino", () => ({ fileOrDirExists: vi.fn() }));
vi.mock("@runtime", () => ({ rmrf_dangerously: vi.fn() }));
vi.mock("@wine/multi-game", () => ({
  AUTO_WINE_TAG: "__auto__",
  SHARED_WINE_TAG: "__shared__",
  createMultiGameWineProxy: (ref: { current: unknown }) => ref.current,
  getMultiGameGameWineTag: vi.fn(),
  getMultiGameGameWineEnabled: vi.fn(),
  getMultiGameWineOptions: vi.fn(),
  getMultiGamePrefix: (_p: string, id: string) => `/prefixes/${id}`,
  isMultiGamePrefixReady: vi.fn(),
  prepareMultiGameGameWine: vi.fn(),
  ensureMultiGameGameWine: vi.fn(),
  setMultiGameGameWineEnabled: vi.fn(),
  setMultiGameGameWineTag: vi.fn(),
}));
import { createGameSettings } from "@settings";
import { getKeyOrDefault } from "@runtime/storage";
import { getWineDistributions } from "@wine";
import { getLatestGameDisplays } from "@src/clients/mhy/hyp-connect";
import { createHypLauncher } from "@src/launcher/controller/hyp-launcher";
import { fileOrDirExists } from "@platform/neutralino";
import { rmrf_dangerously } from "@runtime";
import {
  getMultiGameGameWineTag,
  getMultiGameGameWineEnabled,
  getMultiGameWineOptions,
  isMultiGamePrefixReady,
  prepareMultiGameGameWine,
  ensureMultiGameGameWine,
  setMultiGameGameWineEnabled,
} from "@wine/multi-game";
import { createMultiGameLauncher } from "@src/launcher/orchestration/multi-game";
import { BootPerformance } from "@src/boot-performance";
import type { MultiGameGameSpec } from "@src/launcher/data/multi-game-spec";

const wine = {
  prefix: "/prefix",
  killAll: vi.fn(),
  waitForWineServerExit: vi.fn(async () => true),
  openCmdWindow: vi.fn(),
  exec2: vi.fn(),
};
const client = {
  installDir: () => "/game",
  gameVersion: () => "1.0.0",
  changeInstallDir: vi.fn(),
  createConfig: vi.fn(),
};
function spec(id: string): MultiGameGameSpec {
  return {
    id,
    clientId: id,
    namespace: `ns-${id}`,
    title: id,
    fallbackIcon: "fallback",
    iconImage: "fallback.png",
    serverLabel: "SERVER_OS" as never,
    createClient: vi.fn(async () => client as never),
  };
}
function options(specs: MultiGameGameSpec[]) {
  return {
    wine: wine as never,
    wineDistroId: "global",
    wineInstalled: () => true,
    initializeWine: vi.fn() as never,
    downloadWineDistro: vi.fn() as never,
    enableWineDistro: vi.fn() as never,
    uninstallWineDistro: vi.fn() as never,
    locale: { get: (key: string) => key } as never,
    aria2: {} as never,
    onCheckUpdate: vi.fn(),
    onResetWineEnv: vi.fn(),
    region: "OS" as const,
    specs,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getKeyOrDefault).mockResolvedValue("");
  vi.mocked(getWineDistributions).mockReset().mockResolvedValue([]);
  vi.mocked(getLatestGameDisplays).mockReset().mockResolvedValue(new Map());
  vi.mocked(getMultiGameGameWineTag).mockResolvedValue("__shared__");
  vi.mocked(getMultiGameGameWineEnabled).mockResolvedValue(false);
  vi.mocked(getMultiGameWineOptions).mockResolvedValue([]);
  vi.mocked(fileOrDirExists).mockResolvedValue(true);
  vi.mocked(isMultiGamePrefixReady).mockResolvedValue(true);
  vi.mocked(createGameSettings).mockResolvedValue({
    UI: () => null,
    config: {},
  } as never);
  vi.mocked(createHypLauncher).mockResolvedValue({ ready: true } as never);
  vi.mocked(prepareMultiGameGameWine).mockImplementation(async function* () {
    return wine as never;
  });
});

afterEach(async () => {
  // Prefix discovery runs in the background; finish its microtasks before
  // resetting shared mocks for the next test.
  await new Promise<void>(resolve => setImmediate(resolve));
});

describe("multi-game launcher orchestration", () => {
  it("initializes the last viewed client first and preserves the library order", async () => {
    vi.mocked(getKeyOrDefault).mockResolvedValue("second");
    const calls: string[] = [];
    const specs = [spec("first"), spec("second"), spec("third")];
    for (const s of specs)
      s.createClient = vi.fn(async () => {
        calls.push(s.id);
        return client as never;
      });
    await createMultiGameLauncher(options(specs));
    expect(calls[0]).toBe("second");
    const launcher = vi.mocked(createHypLauncher).mock.lastCall![0];
    expect(launcher.games.map(g => g.id)).toEqual(["first", "second", "third"]);
    expect(launcher.showLibrary).toBe(true);
    expect(launcher.games[0].storage?.namespace).toBe("ns-first");
  });
  it("uses official display assets for the correct region and business", async () => {
    vi.mocked(getLatestGameDisplays).mockResolvedValue(
      new Map([
        [
          "game-biz",
          {
            icon: { url: "icon.png" },
            thumbnail: { url: "banner.png" },
            logo: { url: "logo.png" },
          },
        ],
      ]) as never
    );
    await createMultiGameLauncher(
      options([
        { ...spec("first"), displayRegion: "CN", displayBiz: "game-biz" },
      ])
    );
    expect(getLatestGameDisplays).toHaveBeenCalledWith("CN");
    expect(
      vi.mocked(createHypLauncher).mock.lastCall![0].games[0]
    ).toMatchObject({
      iconImage: "icon.png",
      bannerImage: "banner.png",
      logoImage: "logo.png",
    });
  });
  it("continues with fallback assets when the catalog and Wine list are offline", async () => {
    vi.mocked(getLatestGameDisplays).mockRejectedValueOnce(
      new Error("offline")
    );
    vi.mocked(getWineDistributions).mockRejectedValueOnce(new Error("offline"));
    await createMultiGameLauncher(options([spec("first")]));
    expect(
      vi.mocked(createHypLauncher).mock.lastCall![0].games[0].iconImage
    ).toBe("fallback.png");
    expect(vi.mocked(createGameSettings).mock.lastCall![0].autoWineLabel).toBe(
      "global"
    );
  });
  it("does not compose a partially initialized library after a client fails", async () => {
    const failed = spec("failed");
    vi.mocked(failed.createClient).mockRejectedValueOnce(
      new Error("client unavailable")
    );
    await expect(createMultiGameLauncher(options([failed]))).rejects.toThrow(
      "client unavailable"
    );
    expect(createHypLauncher).not.toHaveBeenCalled();
  });
  it("can initialize an empty library", async () => {
    await createMultiGameLauncher(options([]));
    expect(vi.mocked(createHypLauncher).mock.lastCall![0].games).toEqual([]);
  });
  it("queues Wine changes and clears pending state after the task finishes", async () => {
    await createMultiGameLauncher(options([spec("first")]));
    const settings = vi.mocked(createGameSettings).mock.lastCall![0];
    const launcher = vi.mocked(createHypLauncher).mock.lastCall![0];
    expect(() =>
      settings.onWineEnabledChange!(true, { migrate: false })
    ).toThrow("queue is unavailable");
    const queued: { fn: () => AsyncGenerator<unknown> }[] = [];
    launcher.gameWineTaskDispatcher!.current = request => {
      queued.push(request);
    };
    settings.onWineEnabledChange!(true, { migrate: false });
    expect(settings.wineSavePending!()).toBe(true);
    for await (const _command of queued[0].fn()) {
      /* consume task */
    }
    expect(setMultiGameGameWineEnabled).toHaveBeenCalledWith("first", true);
    expect(settings.wineSavePending!()).toBe(false);
    expect(settings.wineEnabled!()).toBe(true);
    settings.onWineEnabledChange!(false, { migrate: false });
    for await (const _command of queued[1].fn()) {
      /* consume task */
    }
    expect(setMultiGameGameWineEnabled).toHaveBeenCalledWith("first", false);
    expect(settings.wineEnabled!()).toBe(false);
  });
  it("rejects removal while a per-game environment is enabled", async () => {
    await createMultiGameLauncher(options([spec("first")]));
    const settings = vi.mocked(createGameSettings).mock.lastCall![0];
    vi.mocked(getMultiGameGameWineEnabled).mockResolvedValueOnce(true);
    await expect(settings.onRemoveGameWinePrefix!()).rejects.toThrow(
      "Cannot remove a Wine prefix"
    );
    expect(rmrf_dangerously).not.toHaveBeenCalled();
    vi.mocked(getMultiGameGameWineEnabled).mockResolvedValueOnce(false);
    await settings.onRemoveGameWinePrefix!();
    expect(rmrf_dangerously).toHaveBeenCalledWith("/prefixes/first");
    expect(settings.gameWinePrefixExists!()).toBe(false);
  });

  it("initializes the same clients with boot profiling enabled", async () => {
    let clock = 0;
    const bootPerformance = new BootPerformance(true, () => ++clock);
    vi.mocked(getWineDistributions).mockResolvedValue([
      {
        id: "global",
        displayName: "Selected Wine",
        remoteUrl: "",
        attributes: {},
      },
    ]);
    await createMultiGameLauncher({
      ...options([spec("first")]),
      bootPerformance,
    });
    const settings = vi.mocked(createGameSettings).mock.lastCall![0];
    await settings.configForChannelClient({} as never, {});
    expect(client.createConfig).toHaveBeenCalledWith({}, {});
    expect(settings.autoWineLabel).toBe("Selected Wine");
    expect(bootPerformance.report().entries.map(entry => entry.name)).toEqual(
      expect.arrayContaining([
        "multi-game-displays:OS",
        "game-client:first",
        "game-settings:first",
        "game-channel-config:first",
      ])
    );
  });

  it("shares concurrent requests for the selected per-game runtime", async () => {
    const custom = {
      ...wine,
      prefix: "/prefixes/first",
      exec2: vi.fn(),
      openCmdWindow: vi.fn(),
    };
    vi.mocked(getMultiGameGameWineTag).mockResolvedValue("custom");
    vi.mocked(ensureMultiGameGameWine).mockImplementation(async function* () {
      return custom as never;
    });
    await createMultiGameLauncher(options([spec("first")]));
    const settings = vi.mocked(createGameSettings).mock.lastCall![0];
    await Promise.all([settings.onOpenWineCmd!(), settings.onOpenWineCfg!()]);
    expect(ensureMultiGameGameWine).toHaveBeenCalledOnce();
    expect(custom.openCmdWindow).toHaveBeenCalledWith({
      gameDir: "/prefixes/first",
    });
    expect(custom.exec2).toHaveBeenCalledWith("winecfg", [], {}, "/dev/null");
    await settings.onOpenWineCfg!();
    expect(ensureMultiGameGameWine).toHaveBeenCalledOnce();
  });

  it("clears pending state when the task dispatcher rejects a request", async () => {
    await createMultiGameLauncher(options([spec("first")]));
    const settings = vi.mocked(createGameSettings).mock.lastCall![0];
    const launcher = vi.mocked(createHypLauncher).mock.lastCall![0];
    launcher.gameWineTaskDispatcher!.current = () => {
      throw new Error("queue closed");
    };
    expect(() =>
      settings.onWineTagChange!("custom", { migrate: true })
    ).toThrow("queue closed");
    expect(settings.wineSavePending!()).toBe(false);
  });

  it("waits for prefix discovery before exposing its ready state", async () => {
    vi.mocked(fileOrDirExists).mockResolvedValue(false);
    await createMultiGameLauncher(options([spec("first")]));
    await new Promise<void>(resolve => setImmediate(resolve));
    const settings = vi.mocked(createGameSettings).mock.lastCall![0];
    expect(settings.wineInstalled!()).toBe(false);
    expect(settings.gameWinePrefixExists!()).toBe(false);
    expect(isMultiGamePrefixReady).not.toHaveBeenCalled();
  });
});
