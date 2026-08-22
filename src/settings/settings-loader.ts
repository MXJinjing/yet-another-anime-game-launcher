import { Locale } from "../locale";
import { Wine, WineDistribution } from "../wine";
import { ChannelClientConfigUI } from "../channel-client";
import { configEntries, Config, ConfigStore, createConfigStore } from "@config";
import { createMetalHUDConfig } from "./controls/game/metal-hud";
import { createGameInstallDirConfig } from "./controls/game/game-install-dir";
import { createProxyEnabledConfig } from "./controls/game/proxy-enabled";
import { createProxyHostConfig } from "./controls/game/proxy-host";
import { createRetinaConfig } from "./controls/video/retina";
import createVSyncDisable from "./controls/video/vsync";
import createPreferredMaxFps from "./controls/video/preferred-max-fps";
import createMetalFxUpscale from "./controls/video/metal-fx-upscale";
import createReShade from "./controls/video/reshade";
import { createLeftCmdConfig } from "./controls/general/left-cmd";
import { createAutoUpdateConfig } from "./controls/general/auto-update";
import createLocaleConfig from "./controls/general/ui-locale";
import createThemeColorConfig from "./controls/general/theme-color";
import { createDisableVideoBackgroundConfig } from "./controls/general/disable-video-background";
import { createDownloadServerConfig } from "./controls/download/download-server";
import { createGithubAcceleratedPrefixConfig } from "./controls/download/github-accelerated-prefix";
import { createWineDistroConfig } from "./controls/wine/wine-distribution";
import { createDebugModeConfig } from "./controls/launch/debug-mode";
import createCustomEnvironmentVariables from "./controls/launch/custom-environment-variables";
import { GlobalSettings } from "./global-settings";
import { GameSettings } from "./game-settings";
import { resolveChannelClientConfig } from "./channel-client-config";
import {
  GameLoadedSettings,
  GlobalLoadedSettings,
  SettingsUI,
} from "./settings-types";

export type GlobalSettingsOptions = {
  locale: Locale;
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  actionDisabled?: () => boolean;
  configStore?: ConfigStore;
  onEnableWineDistro?: (
    distro: WineDistribution,
    onDone: (distro: WineDistribution) => void
  ) => void;
  onUninstallWineDistro?: (
    distro: WineDistribution,
    onDone: (distro: WineDistribution) => void
  ) => void;
  onWineDistroInitialized?: (
    onDone: (distro: WineDistribution) => void
  ) => void;
  onResetWineEnv?: () => Promise<void>;
  modalTitle?: () => string;
};

export type GameSettingsOptions = {
  locale: Locale;
  gameInstallDir: () => string;
  onGameInstallDirChange?: (path: string) => Promise<void>;
  configForChannelClient: (
    locale: Locale,
    config: Partial<Config>
  ) => Promise<ChannelClientConfigUI>;
  configStore?: ConfigStore;
  wineTag?: () => string;
  wineOptions?: { tag: string; displayName: string }[];
  onWineTagChange?: (tag: string) => void;
  modalTitle?: () => string;
};

export type GlobalSettingsHandle = {
  UI: SettingsUI;
  config: Config;
  disableVideoBackground: () => boolean;
};

export type GameSettingsHandle = {
  UI: SettingsUI;
  config: Config;
  disableVideoBackground: () => boolean;
};

/** @deprecated Use GlobalSettingsHandle or GameSettingsHandle. */
export type SettingsHandle = GlobalSettingsHandle | GameSettingsHandle;

async function loadGlobalSettings(
  options: GlobalSettingsOptions
): Promise<GlobalLoadedSettings> {
  const config: Partial<Config> = {};
  const configStore = options.configStore ?? createConfigStore();
  const actionDisabled = options.actionDisabled ?? (() => false);
  const [wineDistro, wineDistroController] = await createWineDistroConfig({
    locale: options.locale,
    config,
    wineInstalled: options.wineInstalled,
    wineDistroId: options.wineDistroId,
    wineActionDisabled: actionDisabled,
    onEnableWineDistro: options.onEnableWineDistro ?? (() => undefined),
    onUninstallWineDistro: options.onUninstallWineDistro ?? (() => undefined),
  });
  const [leftCmd] = await createLeftCmdConfig({
    locale: options.locale,
    config,
    store: configStore,
  });
  const [autoUpdate] = await createAutoUpdateConfig({
    locale: options.locale,
    config,
    store: configStore,
  });
  const [locale] = await createLocaleConfig({
    locale: options.locale,
    config,
    store: configStore,
  });
  const [downloadServer] = await createDownloadServerConfig({
    locale: options.locale,
    config,
    store: configStore,
  });
  const [githubAcceleratedPrefix] = await createGithubAcceleratedPrefixConfig({
    locale: options.locale,
    config,
    store: configStore,
  });
  const [themeColor] = await createThemeColorConfig({
    locale: options.locale,
    config,
    store: configStore,
  });
  const [disableVideoBackground, isVideoBackgroundDisabled] =
    await createDisableVideoBackgroundConfig({
      locale: options.locale,
      config,
      store: configStore,
    });

  return {
    config,
    configStore,
    wineDistro,
    wineDistroController,
    leftCmd,
    autoUpdate,
    locale,
    downloadServer,
    githubAcceleratedPrefix,
    themeColor,
    disableVideoBackground,
    isVideoBackgroundDisabled,
  };
}

async function loadGameSettings(
  options: GameSettingsOptions
): Promise<GameLoadedSettings> {
  const { locale, configForChannelClient, gameInstallDir } = options;
  const config: Partial<Config> = {};
  const configStore = options.configStore ?? createConfigStore();
  const [metalHUD] = await createMetalHUDConfig({
    locale,
    config,
    store: configStore,
  });
  const [gameInstallDirConfig] = await createGameInstallDirConfig({
    locale,
    config,
    gameInstallDir,
    onGameInstallDirChange: options.onGameInstallDirChange,
    store: configStore,
  });
  const [retina] = await createRetinaConfig({
    locale,
    config,
    store: configStore,
  });

  config.advancedEnable =
    (await configStore.read(configEntries.advancedEnable)) ?? false;

  const [vsync] = await createVSyncDisable({
    locale,
    config,
    store: configStore,
  });
  const [preferredMaxFps] = await createPreferredMaxFps({
    locale,
    config,
    store: configStore,
  });
  const [metalFxUpscale] = await createMetalFxUpscale({
    locale,
    config,
    store: configStore,
  });
  const [reShade] = await createReShade({ locale, config, store: configStore });
  const [proxyEnabled, gameProxyEnabled] = await createProxyEnabledConfig({
    locale,
    config,
    store: configStore,
  });
  const [proxyHost] = await createProxyHostConfig({
    locale,
    config,
    store: configStore,
  });
  const [debugMode] = await createDebugModeConfig({
    locale,
    store: configStore,
  });
  const [customEnvironmentVariables] = await createCustomEnvironmentVariables({
    locale,
    config,
  });

  const { channelClientGame, channelClientVideo } = resolveChannelClientConfig(
    await configForChannelClient(locale, config)
  );

  return {
    config,
    configStore,
    metalHUD,
    gameInstallDir: gameInstallDirConfig,
    retina,
    vsync,
    preferredMaxFps,
    metalFxUpscale,
    reShade,
    proxyEnabled,
    proxyHost,
    debugMode,
    customEnvironmentVariables,
    gameProxyEnabled,
    channelClientGame,
    channelClientVideo,
  };
}

export async function createGlobalSettings(
  options: GlobalSettingsOptions
): Promise<GlobalSettingsHandle> {
  const settings = await loadGlobalSettings(options);
  const controller = new GlobalSettings({
    locale: options.locale,
    settings,
    wine: options.wine,
    wineInstalled: options.wineInstalled,
    actionDisabled: options.actionDisabled ?? (() => false),
    onResetWineEnv: options.onResetWineEnv ?? (async () => undefined),
    modalTitle: options.modalTitle,
  });
  options.onWineDistroInitialized?.(
    settings.wineDistroController?.markEnabled ?? (() => undefined)
  );
  return {
    UI: controller.UI,
    config: controller.config,
    disableVideoBackground: controller.disableVideoBackground,
  };
}

export async function createGameSettings(
  options: GameSettingsOptions
): Promise<GameSettingsHandle> {
  const settings = await loadGameSettings(options);
  const controller = new GameSettings({
    locale: options.locale,
    settings,
    wineTag: options.wineTag,
    wineOptions: options.wineOptions,
    onWineTagChange: options.onWineTagChange,
    modalTitle: options.modalTitle,
  });
  return {
    UI: controller.UI,
    config: controller.config,
    // Game settings do not own this global preference. Keep the historical
    // handle shape for callers until application composition is updated.
    disableVideoBackground: () => false,
  };
}
