import { Aria2 } from "@aria2";
import { CommonUpdateProgram } from "@common-update-ui";
import { createConfiguration } from "@config";
import { Locale } from "@locale";
import { Wine, WineDistribution } from "@wine";
import { ChannelClient } from "../channel-client";
import { Config } from "../config/config-def";
import { createHoyoplayLauncher, HoyoplayGame } from "./hoyoplay-launcher";
import { SINGLE_GAME_CHANNEL_META } from "./single-game-specs";

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
  onResetWineEnv,
}: {
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  initializeWine: (distro: WineDistribution) => CommonUpdateProgram;
  enableWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
  uninstallWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
  locale: Locale;
  aria2: Aria2;
  channel: string;
  channelClient: ChannelClient;
  onCheckUpdate: () => void;
  onGameRunningChange?: (running: boolean) => void;
  onResetWineEnv: () => Promise<void>;
}) {
  const meta = SINGLE_GAME_CHANNEL_META[channel];
  if (!meta) {
    throw new Error(`Unknown single-game channel: ${channel}`);
  }
  const actionDisabledRef = { current: () => false };
  const { UI: ConfigurationUI, config } = await createConfiguration({
    wine,
    wineInstalled,
    locale,
    gameInstallDir: channelClient.installDir,
    onGameInstallDirChange: channelClient.changeInstallDir,
    configForChannelClient: channelClient.createConfig,
    onCheckUpdate,
    actionDisabled: () => actionDisabledRef.current(),
    scope: "game",
    onResetWineEnv,
  });
  const game: HoyoplayGame = {
    id: meta.id,
    title: meta.title,
    serverLabel: meta.serverLabel,
    fallbackIcon: meta.fallbackIcon,
    client: channelClient,
    config: config as Config,
    ConfigurationUI,
  };
  return createHoyoplayLauncher({
    games: [game],
    showLibrary: false,
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
