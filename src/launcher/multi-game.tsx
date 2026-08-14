import { Aria2 } from "@aria2";
import { CommonUpdateProgram } from "@common-update-ui";
import { createConfiguration } from "@config";
import { Locale } from "@locale";
import { withStorageNamespace } from "@utils";
import { Wine, WineDistribution } from "@wine";
import { createSignal } from "solid-js";
import { reportBootProgress } from "../boot-progress";
import { ChannelClient } from "../channel-client";
import { Config } from "../config/config-def";
import { createClient as createGenshinOsClient } from "../clients/hk4eos";
import { createClient as createHsrOsClient } from "../clients/hkrpgos";
import { createClient as createZzzOsClient } from "../clients/napos";
import { GAME_ICON_URLS } from "./game-assets";
import { createHoyoplayLauncher, HoyoplayGame } from "./hoyoplay-launcher";
import {
  createMultiGameWineProxy,
  getMultiGameGameWineTag,
  getMultiGameWineOptions,
  setMultiGameGameWineTag,
  MultiGameWineRef,
} from "./multi-game-wine";

export type MultiGameGameSpec = {
  id: string;
  namespace: string;
  title: string;
  fallbackIcon: string;
  iconImage?: string;
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
  specs = DEFAULT_MULTI_GAME_OS_GAME_SPECS,
}: {
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  initializeWine: (distro: WineDistribution) => CommonUpdateProgram;
  enableWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
  uninstallWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
  locale: Locale;
  aria2: Aria2;
  onCheckUpdate: () => void;
  onGameRunningChange?: (running: boolean) => void;
  onResetWineEnv: () => Promise<void>;
  specs?: MultiGameGameSpec[];
}) {
  const baseWine = wine;
  const actionDisabledRef = { current: () => false };
  const games: HoyoplayGame[] = [];

  for (const [index, spec] of specs.entries()) {
    reportBootProgress(
      "正在初始化游戏客户端",
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
    const { UI: ConfigurationUI, config } = await withStorageNamespace(
      spec.namespace,
      async () =>
        createConfiguration({
          wine: gameWine,
          locale,
          gameInstallDir: client.installDir,
          onGameInstallDirChange: client.changeInstallDir,
          configForChannelClient: client.createConfig,
          onCheckUpdate,
          actionDisabled: () => actionDisabledRef.current(),
          scope: "game",
          wineTag,
          wineOptions,
          onWineTagChange: tag => {
            setWineTag(tag);
            void setMultiGameGameWineTag(spec.id, tag);
          },
          wineInstalled,
          onResetWineEnv,
        })
    );

    games.push({
      ...spec,
      client,
      config: config as Config,
      ConfigurationUI,
      wineRef,
      wineTag,
      setWineTag,
      wineOptions,
    });
  }

  reportBootProgress("正在初始化游戏客户端", 96);
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
