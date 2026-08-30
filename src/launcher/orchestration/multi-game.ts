import { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { createGameSettings } from "@settings";
import { Locale } from "@locale";
import { createStorage, getKeyOrDefault } from "@runtime/storage";
import { Wine, WineDistribution } from "@wine";
import { createSignal } from "solid-js";
import { reportBootProgress } from "../../boot-progress";
import { Config } from "../../config/config-def";
import {
  getLatestGameDisplays,
  HoyoPlayRegion,
} from "../../clients/mhy/hyp-connect";
import type { HoyoConnectGameDisplay } from "../../clients/mhy/launcher-info";
import { log } from "@logging/logger";
import { createHypLauncher } from "../controller/hyp-launcher";
import { MULTI_GAME_OS_GAME_SPECS } from "../data/multi-game-os";
import type { HypGame } from "../controller/launcher-types";
import {
  createMultiGameWineProxy,
  getMultiGameGameWineTag,
  getMultiGameWineOptions,
  setMultiGameGameWineTag,
  MultiGameWineRef,
} from "@wine/multi-game";

import type { MultiGameGameSpec } from "../data/multi-game-spec";
import type { BootPerformance } from "../../boot-performance";
export async function createMultiGameLauncher({
  wine,
  wineDistroId,
  wineInstalled,
  initializeWine,
  enableWineDistro,
  uninstallWineDistro,
  locale,
  aria2,
  onCheckUpdate,
  onGameRunningChange,
  gameCloseHandler,
  onResetWineEnv,
  region,
  specs = MULTI_GAME_OS_GAME_SPECS,
  bootPerformance,
}: {
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  initializeWine: (distro: WineDistribution) => TaskProgram;
  enableWineDistro: (distro: WineDistribution) => TaskProgram;
  uninstallWineDistro: (distro: WineDistribution) => TaskProgram;
  locale: Locale;
  aria2: Aria2;
  onCheckUpdate: () => void;
  onGameRunningChange?: (running: boolean) => void;
  gameCloseHandler?: { current?: () => Promise<void> };
  onResetWineEnv: () => Promise<void>;
  region: HoyoPlayRegion;
  specs?: MultiGameGameSpec[];
  bootPerformance?: BootPerformance;
}) {
  const baseWine = wine;
  const actionDisabledRef = { current: () => false };
  const games: HypGame[] = [];

  let gameDisplays = new Map<string, HoyoConnectGameDisplay["display"]>();
  try {
    gameDisplays = await (bootPerformance?.measure("multi-game-displays", () =>
      getLatestGameDisplays(region)
    ) ?? getLatestGameDisplays(region));
  } catch {
    // The per-game clients still have their existing fallback assets.
    log("[hyp-connect] Failed to fetch HoYoPlay game display assets");
  }

  const gameBizByRegion: Record<string, Record<HoyoPlayRegion, string>> = {
    hk4e: { CN: "hk4e_cn", OS: "hk4e_global" },
    hsr: { CN: "hkrpg_cn", OS: "hkrpg_global" },
    zzz: { CN: "nap_cn", OS: "nap_global" },
    bh3: { CN: "bh3_cn", OS: "bh3_global" },
  };

  // Initialize the channel the user last viewed first. This keeps its
  // background and install state on the critical startup path while the
  // remaining channels can be hydrated afterward by the client layer.
  const lastView = await getKeyOrDefault("hyp_last_view", "");
  const prioritizedSpecs = [...specs].sort((a, b) => {
    if (a.id === lastView) return -1;
    if (b.id === lastView) return 1;
    return 0;
  });

  const gamesById = new Map<string, HypGame>();
  let completed = 0;
  let nextIndex = 0;
  let failure: unknown;

  async function initializeGame(spec: MultiGameGameSpec) {
    const storage = createStorage(spec.namespace);
    const index = completed;
    reportBootProgress(
      "BOOT_INITIALIZING_GAME_CLIENT",
      66 + Math.round((index / Math.max(1, specs.length)) * 30),
      `（${index + 1}/${specs.length}）`
    );
    const wineRef: MultiGameWineRef = { current: baseWine };
    const gameWine = createMultiGameWineProxy(wineRef);
    const client = await (bootPerformance?.measure(
      `game-client:${spec.id}`,
      () =>
        spec.createClient({
          wine: gameWine,
          aria2,
          locale,
          storage,
          bootPerformance,
        })
    ) ??
      spec.createClient({
        wine: gameWine,
        aria2,
        locale,
        storage,
        bootPerformance,
      }));
    const initialWineTag = await (bootPerformance?.measure(
      `game-wine-config:${spec.id}`,
      () => getMultiGameGameWineTag(spec.id)
    ) ?? getMultiGameGameWineTag(spec.id));
    const [wineTag, setWineTag] = createSignal(initialWineTag);
    const wineOptions = await (bootPerformance?.measure(
      `game-wine-options:${spec.id}`,
      () => getMultiGameWineOptions(initialWineTag)
    ) ?? getMultiGameWineOptions(initialWineTag));
    const display = gameDisplays.get(gameBizByRegion[spec.id]?.[region]);
    const resolvedSpec = {
      ...spec,
      serverLabel: locale.get(spec.serverLabel),
      iconImage: display?.icon.url ?? spec.iconImage,
      bannerImage: display?.thumbnail.url ?? spec.bannerImage,
      logoImage: display?.logo.url ?? spec.logoImage,
    };
    const createSettings = () =>
      createGameSettings({
        locale,
        storage,
        gameInstallDir: client.installDir,
        onGameInstallDirChange: client.changeInstallDir,
        configForChannelClient: (locale, config) =>
          bootPerformance?.measure(`game-channel-config:${spec.id}`, () =>
            client.createConfig(locale, config)
          ) ?? client.createConfig(locale, config),
        wineTag,
        wineOptions,
        onWineTagChange: tag => {
          setWineTag(tag);
          void setMultiGameGameWineTag(spec.id, tag);
        },
      });
    const { UI: ConfigurationUI, config } = await (bootPerformance?.measure(
      `game-settings:${spec.id}`,
      createSettings
    ) ?? createSettings());

    gamesById.set(spec.id, {
      ...resolvedSpec,
      storage,
      client,
      config: config as Config,
      ConfigurationUI,
      wineRef,
      wineTag,
      setWineTag,
      wineOptions,
    });
    completed++;
  }

  async function worker() {
    while (failure === undefined) {
      const spec = prioritizedSpecs[nextIndex++];
      if (!spec) return;
      try {
        await initializeGame(spec);
      } catch (error) {
        const detail =
          error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
            : String(error);
        await log(
          `[multi-game] Initialization failed for ${spec.id}: ${detail}`
        );
        failure = error;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(4, prioritizedSpecs.length) }, () => worker())
  );
  if (failure !== undefined) throw failure;
  // Keep the library order stable; only the initialization order is changed.
  games.push(
    ...specs
      .map(spec => gamesById.get(spec.id))
      .filter((game): game is HypGame => !!game)
  );

  reportBootProgress("BOOT_INITIALIZING_GAME_CLIENT", 96);
  return createHypLauncher({
    games,
    showLibrary: true,
    wine,
    wineDistroId,
    wineInstalled,
    locale,
    aria2,
    onCheckUpdate,
    onGameRunningChange,
    gameCloseHandler,
    onResetWineEnv,
    initializeWine,
    enableWineDistro,
    uninstallWineDistro,
    actionDisabledRef,
  });
}

export type { MultiGameGameSpec } from "../data/multi-game-spec";
