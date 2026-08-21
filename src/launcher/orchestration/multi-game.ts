import { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { createGameSettings } from "@settings";
import { Locale } from "@locale";
import { withStorageNamespace } from "@runtime/storage";
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
}) {
  const baseWine = wine;
  const actionDisabledRef = { current: () => false };
  const games: HypGame[] = [];

  let gameDisplays = new Map<string, HoyoConnectGameDisplay["display"]>();
  try {
    gameDisplays = await getLatestGameDisplays(region);
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

  for (const [index, spec] of specs.entries()) {
    reportBootProgress(
      "BOOT_INITIALIZING_GAME_CLIENT",
      66 + Math.round((index / Math.max(1, specs.length)) * 30),
      `（${index + 1}/${specs.length}）`
    );
    const wineRef: MultiGameWineRef = { current: baseWine };
    const gameWine = createMultiGameWineProxy(wineRef);
    const client = await withStorageNamespace(spec.namespace, async () =>
      spec.createClient({ wine: gameWine, aria2, locale })
    );
    const initialWineTag = await getMultiGameGameWineTag(spec.id);
    const [wineTag, setWineTag] = createSignal(initialWineTag);
    const wineOptions = await getMultiGameWineOptions(initialWineTag);
    const display = gameDisplays.get(gameBizByRegion[spec.id]?.[region]);
    const resolvedSpec = {
      ...spec,
      serverLabel: locale.get(spec.serverLabel),
      iconImage: display?.icon.url ?? spec.iconImage,
      bannerImage: display?.thumbnail.url ?? spec.bannerImage,
      logoImage: display?.logo.url ?? spec.logoImage,
    };
    const { UI: ConfigurationUI, config } = await withStorageNamespace(
      spec.namespace,
      async () =>
        createGameSettings({
          locale,
          gameInstallDir: client.installDir,
          onGameInstallDirChange: client.changeInstallDir,
          configForChannelClient: client.createConfig,
          wineTag,
          wineOptions,
          onWineTagChange: tag => {
            setWineTag(tag);
            void setMultiGameGameWineTag(spec.id, tag);
          },
        })
    );

    games.push({
      ...resolvedSpec,
      client,
      config: config as Config,
      ConfigurationUI,
      wineRef,
      wineTag,
      setWineTag,
      wineOptions,
    });
  }

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
