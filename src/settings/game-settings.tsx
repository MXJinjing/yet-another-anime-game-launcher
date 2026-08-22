import { Show, JSXElement } from "solid-js";
import { Tab } from "@hope-ui/solid";
import { Locale } from "../locale";
import { GameTab } from "./tabs/game-tab";
import { LaunchTab } from "./tabs/launch-tab";
import { VideoTab } from "./tabs/video-tab";
import { GameWineTab } from "./tabs/game-wine-tab";
import { GameLoadedSettings, SettingsUIProps } from "./settings-types";
import { SettingsController } from "./settings-controller";

export type GameSettingsOptions = {
  locale: Locale;
  settings: GameLoadedSettings;
  wineTag?: () => string;
  wineOptions?: { tag: string; displayName: string }[];
  onWineTagChange?: (tag: string) => void;
  modalTitle?: () => string;
};

export class GameSettings extends SettingsController<GameLoadedSettings> {
  private readonly options: GameSettingsOptions;

  constructor(options: GameSettingsOptions) {
    super(options.locale, options.settings, options.modalTitle);
    this.options = options;
  }

  protected renderAuxiliaryLinks(props: SettingsUIProps): JSXElement {
    return (
      <Show when={props.onOpenGlobalSettings != null}>
        <div class="hyp-settings-nav-bottom">
          <button
            class="hyp-settings-nav-button"
            type="button"
            onClick={() => props.onOpenGlobalSettings?.()}
          >
            {this.locale.get("SETTING_GLOBAL")}
          </button>
        </div>
      </Show>
    );
  }

  private get showGameWineTab() {
    return Boolean(
      this.options.wineTag &&
        this.options.wineOptions &&
        this.options.onWineTagChange
    );
  }

  protected renderTabList(_props: SettingsUIProps): JSXElement {
    return (
      <>
        <Tab>{this.locale.get("SETTING_GAME")}</Tab>
        <Tab>{this.locale.get("SETTING_VIDEO")}</Tab>
        <Tab>
          {this.locale.currentLanguage.startsWith("zh") ? "启动" : "Launch"}
        </Tab>
        <Show when={this.showGameWineTab}>
          <Tab>Wine</Tab>
        </Show>
      </>
    );
  }

  protected renderTabs(props: SettingsUIProps): JSXElement {
    const settings = this.settings;
    return (
      <>
        <GameTab
          locale={this.locale}
          gameProxyEnabled={settings.gameProxyEnabled}
          GameInstallDirConfig={settings.gameInstallDir}
          ProxyEnabledConfig={settings.proxyEnabled}
          ProxyHostConfig={settings.proxyHost}
          MetalHUDConfig={settings.metalHUD}
        />
        <VideoTab
          locale={this.locale}
          RetinaConfig={settings.retina}
          PreferredMaxFpsConfig={settings.preferredMaxFps}
          ChannelClientVideoConfig={settings.channelClientVideo}
          VsyncDisableConfig={settings.vsync}
          MetalFxUpscaleConfig={settings.metalFxUpscale}
          ReShadeConfig={settings.reShade}
          config={settings.config}
          configStore={settings.configStore}
        />
        <LaunchTab
          ChannelClientConfig={settings.channelClientGame}
          onOpenGlobalSettings={props.onOpenGlobalSettings}
          DebugModeConfig={settings.debugMode}
          CustomEnvironmentVariablesConfig={settings.customEnvironmentVariables}
        />
        <Show when={this.showGameWineTab}>
          <GameWineTab
            locale={this.locale}
            wineTag={this.options.wineTag}
            wineOptions={this.options.wineOptions}
            onWineTagChange={this.options.onWineTagChange}
          />
        </Show>
      </>
    );
  }
}
