import { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { createGameSettings } from "@settings";
import { Locale } from "@locale";
import { withStorageNamespace } from "@runtime/storage";
import { Wine, WineDistribution } from "@wine";
import { createSignal } from "solid-js";
import { reportBootProgress } from "../../boot-progress";
import { ChannelClient } from "../../channel-client";
import { Config } from "../../config/config-def";
import { createClient as createGenshinOsClient } from "../../clients/hk4eos";
import { createClient as createHsrOsClient } from "../../clients/hkrpgos";
import { createClient as createZzzOsClient } from "../../clients/napos";
import {
  getLatestGameDisplays,
  HoyoPlayRegion,
} from "../../clients/mhy/hyp-connect";
import type { HoyoConnectGameDisplay } from "../../clients/mhy/launcher-info";
import { log } from "@logging/logger";
import { GAME_ICON_URLS } from "../data/game-assets";
import { createHoyoplayLauncher } from "../controller/hoyoplay-launcher";
import type { HoyoplayGame } from "../controller/launcher-types";
import {
  createMultiGameWineProxy,
  getMultiGameGameWineTag,
  getMultiGameWineOptions,
  setMultiGameGameWineTag,
  MultiGameWineRef,
} from "@wine/multi-game";

export type MultiGameGameSpec = {
  id: string;
  namespace: string;
  title: string;
  fallbackIcon: string;
  iconImage?: string;
  bannerImage?: string;
  logoImage?: string;
  serverLabel: string;
  createClient: (options: {
    wine: Wine;
    aria2: Aria2;
    locale: Locale;
  }) => Promise<ChannelClient>;
};

export const DEFAULT_MULTI_GAME_OS_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "genshin",
    namespace: "hpgenshin",
    title: "Genshin Impact",
    fallbackIcon: GAME_ICON_URLS["genshin"],
    serverLabel: "国际服",
    createClient: createGenshinOsClient,
  },
  {
    id: "hsr",
    namespace: "hphsr",
    title: "Honkai: Star Rail",
    fallbackIcon: GAME_ICON_URLS["hsr"],
    serverLabel: "国际服",
    createClient: createHsrOsClient,
  },
  {
    id: "zzz",
    namespace: "hpzzz",
    title: "Zenless Zone Zero",
    fallbackIcon: GAME_ICON_URLS["zzz"],
    iconImage: GAME_ICON_URLS["zzz"],
    serverLabel: "国际服",
    createClient: createZzzOsClient,
  },
];

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
  onResetWineEnv,
  region,
  specs = DEFAULT_MULTI_GAME_OS_GAME_SPECS,
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
  onResetWineEnv: () => Promise<void>;
  region: HoyoPlayRegion;
  specs?: MultiGameGameSpec[];
}) {
  const baseWine = wine;
  const actionDisabledRef = { current: () => false };
  const games: HoyoplayGame[] = [];

  let gameDisplays = new Map<string, HoyoConnectGameDisplay["display"]>();
  try {
    gameDisplays = await getLatestGameDisplays(region);
  } catch {
    // The per-game clients still have their existing fallback assets.
    log("[hyp-connect] Failed to fetch HoYoPlay game display assets");
  }

  const gameBizByRegion: Record<string, Record<HoyoPlayRegion, string>> = {
    genshin: { CN: "hk4e_cn", OS: "hk4e_global" },
    hsr: { CN: "hkrpg_cn", OS: "hkrpg_global" },
    zzz: { CN: "nap_cn", OS: "nap_global" },
  };

  for (const [index, spec] of specs.entries()) {
    reportBootProgress(
      "BOOT_INITIALIZING_GAME_CLIENT",
      66 + Math.round((index / Math.max(1, specs.length)) * 30),
      spec.title
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
    const resolvedSpec: MultiGameGameSpec = {
      ...spec,
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
  return createHoyoplayLauncher({
    games,
    showLibrary: true,
    wine,
    wineDistroId,
    wineInstalled,
    locale,
    aria2,
    onCheckUpdate,
    onGameRunningChange,
    onResetWineEnv,
    initializeWine,
    enableWineDistro,
    uninstallWineDistro,
    actionDisabledRef,
  });
}
