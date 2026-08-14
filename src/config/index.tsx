import { Tab, TabList, Tabs } from "@hope-ui/solid";
import { JSXElement, Show } from "solid-js";
import { Locale } from "../locale";
import { AppModal } from "../components/app-modal";
import { Wine, WineDistribution } from "../wine";
import { Config } from "./config-def";
import { createMetalHUDConfig } from "./metal-hud";
import { createGameInstallDirConfig } from "./game-install-dir";
import { createRetinaConfig } from "./retina";
import { createLeftCmdConfig } from "./left-cmd";
import { createWineDistroConfig } from "./wine-distribution";
import createLocaleConfig from "./ui-locale";
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
import { createDisableVideoBackgroundConfig } from "./disable-video-background";
import { createDebugModeConfig } from "./debug-mode";
import { HostsHelperControl } from "./hosts-helper";
// Advanced tab moved into VideoTab
import { GameTab } from "./tabs/game-tab";
import { GeneralTab } from "./tabs/general-tab";
import { LaunchTab } from "./tabs/launch-tab";
import { VideoTab } from "./tabs/video-tab";
import { WineTab } from "./tabs/wine-tab";
import { GameWineTab } from "./tabs/game-wine-tab";

/**
 * `scope` selects which tabs the settings modal shows:
 * - "global": General / Wine. Wine environment controls (distro
 *   install/uninstall/reset) are managed here.
 * - "game": Game / Video / Launch, plus Wine only when per-game Wine props are
 *   supplied. Multi-game settings are stored per-game (see src/utils/neu.ts
 *   namespaced storage) and default to the global values when the per-game
 *   override is missing; single-game settings use the existing global keys.
 */
export async function createConfiguration({
  wine,
  wineDistroId,
  wineInstalled,
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
  wineTag,
  wineOptions,
  onWineTagChange,
  modalTitle,
  scope = "global",
}: {
  wine: Wine;
  wineDistroId?: string;
  wineInstalled?: () => boolean;
  locale: Locale;
  gameInstallDir: () => string;
  onGameInstallDirChange?: (path: string) => Promise<void>;
  configForChannelClient: (
    locale: Locale,
    config: Partial<Config>
  ) => Promise<ChannelClientConfigUI>;
  onCheckUpdate: () => void;
  actionDisabled?: () => boolean;
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
  wineTag?: () => string;
  wineOptions?: { tag: string; displayName: string }[];
  onWineTagChange?: (tag: string) => void;
  modalTitle?: () => string;
  scope?: "game" | "global";
}) {
  const config: Partial<Config> = {};
  const wineInstalledSafe = wineInstalled ?? (() => true);
  const actionDisabledSafe = actionDisabled ?? (() => false);
  let WD: () => JSXElement = () => null;
  if (scope == "global") {
    const [wineDistroConfigUI, wineDistroConfig] = await createWineDistroConfig(
      {
        locale,
        config,
        wineInstalled: wineInstalledSafe,
        wineDistroId: wineDistroId ?? "",
        wineActionDisabled: actionDisabledSafe,
        onEnableWineDistro: onEnableWineDistro ?? (() => undefined),
        onUninstallWineDistro: onUninstallWineDistro ?? (() => undefined),
      }
    );
    WD = wineDistroConfigUI;
    onWineDistroInitialized?.(wineDistroConfig.markEnabled);
  }
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
  const [DVB, isVideoBackgroundDisabled] =
    await createDisableVideoBackgroundConfig({ locale, config });
  const [DBC] = await createDebugModeConfig({ locale });

  const channelClientConfig = await configForChannelClient(locale, config);
  const ChannelClientConfig =
    typeof channelClientConfig === "function"
      ? channelClientConfig
      : channelClientConfig.game;
  const ChannelClientVideoConfig =
    typeof channelClientConfig === "function"
      ? undefined
      : channelClientConfig.video;
  const showGameWineTab =
    scope == "game" && Boolean(wineTag && wineOptions && onWineTagChange);

  return {
    UI: function (props: {
      opened: boolean;
      onClose: (action: "check-integrity" | "close") => void;
      onOpenLogs: () => void;
      actionDisabled: () => boolean;
      onOpenAbout?: () => void;
      onOpenLicense?: () => void;
      /** Render only the settings content, for embedding inside a shared modal host. */
      contentOnly?: boolean;
    }) {
      const content = (
        <Tabs orientation="vertical" h="100%" variant={"pills"}>
          <div class="hoyoplay-settings-nav">
            <TabList minW={120}>
              <Show when={scope == "global"}>
                <Tab>{locale.get("SETTING_GENERAL")}</Tab>
              </Show>
              <Show when={scope == "game"}>
                <Tab>{locale.get("SETTING_GAME")}</Tab>
                <Tab>{locale.get("SETTING_VIDEO")}</Tab>
                <Tab>
                  {locale.currentLanguage.startsWith("zh") ? "启动" : "Launch"}
                </Tab>
                <Show when={showGameWineTab}>
                  <Tab>Wine</Tab>
                </Show>
              </Show>
              <Show when={scope == "global"}>
                <Tab>Wine</Tab>
              </Show>
            </TabList>
            <Show
              when={
                scope == "global" &&
                props.onOpenAbout != null &&
                props.onOpenLicense != null
              }
            >
              <div class="hoyoplay-settings-nav-bottom">
                <button
                  class="hoyoplay-settings-nav-button"
                  type="button"
                  onClick={() => props.onOpenAbout?.()}
                >
                  {locale.currentLanguage.startsWith("zh")
                    ? "关于 Yaagl"
                    : "About Yaagl"}
                </button>
                <button
                  class="hoyoplay-settings-nav-button"
                  type="button"
                  onClick={() => props.onOpenLicense?.()}
                >
                  License
                </button>
              </div>
            </Show>
          </div>
          <Show when={scope == "global"}>
            <GeneralTab
              locale={locale}
              DisableVideoBackgroundConfig={DVB}
              LeftCmdConfig={LC}
              DownloadServerConfig={DS}
              LocaleConfig={UL}
              ThemeColorConfig={TC}
              HostsHelperConfig={() => <HostsHelperControl locale={locale} />}
            />
          </Show>
          <Show when={scope == "game"}>
            <GameTab
              locale={locale}
              gameProxyEnabled={gameProxyEnabled}
              GameInstallDirConfig={GID}
              ProxyEnabledConfig={PRE}
              ProxyHostConfig={PRH}
              MetalHUDConfig={MH}
            />
            <VideoTab
              locale={locale}
              RetinaConfig={R}
              PreferredMaxFpsConfig={PMF}
              ChannelClientVideoConfig={ChannelClientVideoConfig}
              VsyncDisableConfig={VS}
              MetalFxUpscaleConfig={MFX}
              ReShadeConfig={RS}
              config={config}
            />
            <LaunchTab
              ChannelClientConfig={ChannelClientConfig}
              DebugModeConfig={DBC}
            />
            <Show when={showGameWineTab}>
              <GameWineTab
                locale={locale}
                wineTag={wineTag}
                wineOptions={wineOptions}
                onWineTagChange={onWineTagChange}
              />
            </Show>
          </Show>
          <Show when={scope == "global"}>
            <WineTab
              locale={locale}
              wine={wine}
              wineInstalled={wineInstalledSafe}
              winePrefix={wine.prefix}
              WineDistroConfig={WD}
              onResetWineEnv={onResetWineEnv ?? (async () => undefined)}
              wineActionDisabled={actionDisabledSafe}
            />
          </Show>
        </Tabs>
      );
      if (props.contentOnly) {
        return content;
      }
      return (
        <AppModal
          opened={props.opened}
          onClose={() => props.onClose("close")}
          title={modalTitle?.() ?? locale.get("SETTING")}
          maxWidth={800}
          height={600}
          bodyClass="app-modal-body-settings"
        >
          {content}
        </AppModal>
      );
    },
    config: config as Config,
    /** Reactive accessor for the global "disable video background" toggle. */
    disableVideoBackground: isVideoBackgroundDisabled,
  };
}

export type { Config };
