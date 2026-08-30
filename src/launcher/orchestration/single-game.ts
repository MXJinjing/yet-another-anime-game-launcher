import { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { createGameSettings } from "@settings";
import { Locale } from "@locale";
import { Wine, WineDistribution } from "@wine";
import { ChannelClient } from "../../channel-client";
import { Config } from "../../config/config-def";
import { createHypLauncher } from "../controller/hyp-launcher";
import type { HypGame } from "../controller/launcher-types";
import { SINGLE_GAME_CHANNEL_META } from "../data/single-game-specs";
import { reportBootProgress } from "../../boot-progress";
import type { BootPerformance } from "../../boot-performance";
import { globalStorage } from "@runtime/storage";

export async function createLauncher({
  wine,
  wineDistroId,
  wineInstalled,
  initializeWine,
  enableWineDistro,
  uninstallWineDistro,
  locale,
  aria2,
  channel,
  channelClient,
  onCheckUpdate,
  onGameRunningChange,
  gameCloseHandler,
  onResetWineEnv,
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
  channel: string;
  channelClient: ChannelClient;
  onCheckUpdate: () => void;
  onGameRunningChange?: (running: boolean) => void;
  gameCloseHandler?: { current?: () => Promise<void> };
  onResetWineEnv: () => Promise<void>;
  bootPerformance?: BootPerformance;
}) {
  const meta = SINGLE_GAME_CHANNEL_META[channel];
  if (!meta) {
    throw new Error(`Unknown single-game channel: ${channel}`);
  }
  const actionDisabledRef = { current: () => false };
  reportBootProgress("BOOT_INITIALIZING_GAME_CLIENT", 80);
  const { UI: ConfigurationUI, config } = await (bootPerformance?.measure(
    "single-game-settings",
    () => createGameSettings({
      locale,
      storage: globalStorage,
      gameInstallDir: channelClient.installDir,
      onGameInstallDirChange: channelClient.changeInstallDir,
      configForChannelClient: (locale, config) =>
        bootPerformance?.measure("single-game-channel-config", () =>
          channelClient.createConfig(locale, config)
        ) ?? channelClient.createConfig(locale, config),
    })
  ) ?? createGameSettings({
    locale,
    storage: globalStorage,
    gameInstallDir: channelClient.installDir,
    onGameInstallDirChange: channelClient.changeInstallDir,
    configForChannelClient: (locale, config) =>
      channelClient.createConfig(locale, config),
  }));
  const game: HypGame = {
    id: meta.id,
    title: meta.title,
    serverLabel: locale.get(meta.serverLabel),
    fallbackIcon: meta.fallbackIcon,
    client: channelClient,
    storage: globalStorage,
    config: config as Config,
    ConfigurationUI,
  };
  return createHypLauncher({
    games: [game],
    showLibrary: false,
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
