import {
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  Tab,
  TabList,
  Tabs,
} from "@hope-ui/solid";
import { Locale } from "../locale";
import { Wine, WineDistribution } from "../wine";
import { Config } from "./config-def";
import { createMetalHUDConfig } from "./metal-hud";
import { createGameInstallDirConfig } from "./game-install-dir";
import { createRetinaConfig } from "./retina";
import { createLeftCmdConfig } from "./left-cmd";
import { createWineDistroConfig } from "./wine-distribution";
import createLocaleConfig from "./ui-locale";
import createFPSUnlock from "./fps-unlock";
import createReShade from "./reshade";
import createVSyncDisable from "./vsync";
import createPreferredMaxFps from "./preferred-max-fps";
import createMetalFxUpscale from "./metal-fx-upscale";
import { getKey } from "@utils";
import { createProxyEnabledConfig } from "@config/proxy-enabled";
import { createProxyHostConfig } from "@config/proxy-host";
import { ChannelClientConfigUI } from "../channel-client";
import { createDownloadServerConfig } from "./download-server";
import createThemeColorConfig from "./theme-color";
// Advanced tab moved into VideoTab
import { GameTab } from "./tabs/game-tab";
import { GeneralTab } from "./tabs/general-tab";
import { LicensesTab } from "./tabs/licenses-tab";
import { VideoTab } from "./tabs/video-tab";
import { WineTab } from "./tabs/wine-tab";

export async function createConfiguration({
  wine,
  wineDistroId,
  wineInstalled,
  gameInstalled,
  gameVersion,
  locale,
  gameInstallDir,
  configForChannelClient,
  onCheckUpdate,
  actionDisabled,
  onEnableWineDistro,
  onUninstallWineDistro,
  onWineDistroInitialized,
  onGameInstallDirChange,
  onResetWineEnv,
}: {
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  gameInstalled: () => boolean;
  gameVersion?: () => string;
  locale: Locale;
  gameInstallDir: () => string;
  onGameInstallDirChange?: (path: string) => Promise<void>;
  configForChannelClient: (
    locale: Locale,
    config: Partial<Config>
  ) => Promise<ChannelClientConfigUI>;
  onCheckUpdate: () => void;
  actionDisabled: () => boolean;
  onEnableWineDistro: (
    distro: WineDistribution,
    onDone: (distro: WineDistribution) => void
  ) => void;
  onUninstallWineDistro: (
    distro: WineDistribution,
    onDone: (distro: WineDistribution) => void
  ) => void;
  onWineDistroInitialized?: (
    onDone: (distro: WineDistribution) => void
  ) => void;
  onResetWineEnv: () => Promise<void>;
}) {
  const config: Partial<Config> = {};
  const [WD, wineDistroConfig] = await createWineDistroConfig({
    locale,
    config,
    wineInstalled,
    wineDistroId,
    wineActionDisabled: actionDisabled,
    onEnableWineDistro,
    onUninstallWineDistro,
  });
  onWineDistroInitialized?.(wineDistroConfig.markEnabled);
  const [MH] = await createMetalHUDConfig({ locale, config });
  const [R] = await createRetinaConfig({ locale, config });
  const [LC] = await createLeftCmdConfig({ locale, config });
  const [GID] = await createGameInstallDirConfig({
    locale,
    config,
    gameInstallDir,
    onGameInstallDirChange,
  });

  const [UL] = await createLocaleConfig({ locale, config });

  // load advancedEnable into config (persisted key)
  try {
    const v = (await getKey("config_advanced_enable")) == "true";
    config.advancedEnable = v;
  } catch {
    config.advancedEnable = false;
  }

  const [FO] = await createFPSUnlock({ locale, config });
  const [VS] = await createVSyncDisable({ locale, config });
  const [PMF] = await createPreferredMaxFps({ locale, config });
  const [MFX] = await createMetalFxUpscale({ locale, config });
  const [RS] = await createReShade({ locale, config });

  const [PRE, gameProxyEnabled] = await createProxyEnabledConfig({
    locale,
    config,
  });
  const [PRH] = await createProxyHostConfig({ locale, config });
  const [DS] = await createDownloadServerConfig({ locale, config });
  const [TC] = await createThemeColorConfig({ locale, config });

  const channelClientConfig = await configForChannelClient(locale, config);
  const ChannelClientConfig =
    typeof channelClientConfig === "function"
      ? channelClientConfig
      : channelClientConfig.game;
  const ChannelClientVideoConfig =
    typeof channelClientConfig === "function"
      ? undefined
      : channelClientConfig.video;
  const displayGameVersion = () => {
    const version = gameVersion?.() ?? "0.0.0";
    return version == "0.0.0"
      ? locale.get("SETTING_GAME_VERSION_NOT_INSTALLED")
      : version;
  };

  return {
    UI: function (props: {
      onClose: (action: "check-integrity" | "close") => void;
      onOpenLogs: () => void;
      actionDisabled: () => boolean;
      onCheckGameUpdate: () => void;
    }) {
      return (
        <ModalContent height={570} width={1000} maxWidth={1000}>
          <ModalCloseButton />
          <ModalHeader>{locale.get("SETTING")}</ModalHeader>
          <ModalBody pb={20}>
            <Tabs orientation="vertical" h="100%" variant={"pills"}>
              <TabList minW={120}>
                <Tab>{locale.get("SETTING_GENERAL")}</Tab>
                <Tab>{locale.get("SETTING_GAME")}</Tab>
                <Tab>{locale.get("SETTING_VIDEO")}</Tab>
                <Tab>Wine</Tab>
                <Tab>{locale.get("SETTING_LICENSES")}</Tab>
              </TabList>
              <GeneralTab
                locale={locale}
                wine={wine}
                wineInstalled={wineInstalled}
                gameInstallDir={gameInstallDir}
                onCheckUpdate={onCheckUpdate}
                onOpenLogs={() => {
                  props.onClose("close");
                  props.onOpenLogs();
                }}
                LeftCmdConfig={LC}
                DownloadServerConfig={DS}
                LocaleConfig={UL}
                ThemeColorConfig={TC}
              />
              <GameTab
                locale={locale}
                displayGameVersion={displayGameVersion}
                gameInstalled={gameInstalled}
                actionDisabled={props.actionDisabled}
                gameProxyEnabled={gameProxyEnabled}
                onCheckGameUpdate={props.onCheckGameUpdate}
                onCheckIntegrity={() => props.onClose("check-integrity")}
                GameInstallDirConfig={GID}
                ProxyEnabledConfig={PRE}
                ProxyHostConfig={PRH}
                ChannelClientConfig={ChannelClientConfig}
              />
              <VideoTab
                locale={locale}
                RetinaConfig={R}
                PreferredMaxFpsConfig={PMF}
                MetalHUDConfig={MH}
                ChannelClientVideoConfig={ChannelClientVideoConfig}
                VsyncDisableConfig={VS}
                FPSUnlockConfig={FO}
                MetalFxUpscaleConfig={MFX}
                ReShadeConfig={RS}
                config={config}
              />
              <WineTab
                locale={locale}
                wine={wine}
                wineInstalled={wineInstalled}
                winePrefix={wine.prefix}
                WineDistroConfig={WD}
                onResetWineEnv={onResetWineEnv}
                wineActionDisabled={actionDisabled}
              />
              <LicensesTab locale={locale} />
            </Tabs>
          </ModalBody>
        </ModalContent>
      );
    },
    config: config as Config,
  };
}

export type { Config };