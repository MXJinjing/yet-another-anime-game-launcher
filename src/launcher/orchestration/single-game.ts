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
}) {
  const meta = SINGLE_GAME_CHANNEL_META[channel];
  if (!meta) {
    throw new Error(`Unknown single-game channel: ${channel}`);
  }
  const actionDisabledRef = { current: () => false };
  reportBootProgress("BOOT_INITIALIZING_GAME_CLIENT", 80);
  const { UI: ConfigurationUI, config } = await createGameSettings({
    locale,
    gameInstallDir: channelClient.installDir,
    onGameInstallDirChange: channelClient.changeInstallDir,
    configForChannelClient: channelClient.createConfig,
  });
  const game: HypGame = {
    id: meta.id,
    title: meta.title,
    serverLabel: locale.get(meta.serverLabel),
    fallbackIcon: meta.fallbackIcon,
    client: channelClient,
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
