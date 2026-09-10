import { Show, JSXElement } from "solid-js";
import { Tab } from "@hope-ui/solid";
import { Locale } from "../locale";
import { GameTab } from "./tabs/game-tab";
import { LaunchTab } from "./tabs/launch-tab";
import { VideoTab } from "./tabs/video-tab";
import { GameWineTab } from "./tabs/game-wine-tab";
import { GameLoadedSettings, SettingsUIProps } from "./settings-types";
import type { Wine } from "../wine";
import { SettingsController } from "./settings-controller";

export type GameSettingsOptions = {
  locale: Locale;
  settings: GameLoadedSettings;
  wineTag?: () => string;
  wineOptions?: { tag: string; displayName: string }[];
  onWineTagChange?: (
    tag: string,
    options: { migrate: boolean }
  ) => void | Promise<void>;
  wineEnabled?: () => boolean;
  /** Name of the global Wine that the "automatic" choice resolves to. */
  autoWineLabel?: string;
  /** False when this client has no Wine user-data migration mapping. */
  wineDataSupported?: boolean;
  onWineEnabledChange?: (
    enabled: boolean,
    options: { migrate: boolean; overwrite?: boolean }
  ) => void | Promise<void>;
  onOpenWineCmd?: () => void | Promise<void>;
  onOpenWineCfg?: () => void | Promise<void>;
  winePrefix?: () => string;
  wineInstalled?: () => boolean;
  wineActionDisabled?: () => boolean;
  onResetWineEnv?: () => Promise<void>;
  gameWinePrefixExists?: () => boolean;
  onRemoveGameWinePrefix?: () => Promise<void>;
  modalTitle?: () => string;
};

export class GameSettings extends SettingsController<GameLoadedSettings> {
  private readonly options: GameSettingsOptions;
  private readonly wineDirty = { current: false };

  constructor(options: GameSettingsOptions) {
    super(options.locale, options.settings, options.modalTitle);
    this.options = options;
    this.leaveGuard = async () => {
      if (!this.wineDirty.current) return true;
      const result = await Neutralino.os.showMessageBox(
        "Wine",
        this.locale.get("SETTING_GAME_WINE_UNSAVED"),
        "YES_NO",
        "WARNING"
      );
      const leave = result == "YES";
      if (leave) this.wineDirty.current = false;
      return leave;
    };
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
          EnableMetalFxUpscale={settings.enableMetalFxUpscale}
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
            wineEnabled={this.options.wineEnabled}
            autoWineLabel={this.options.autoWineLabel}
            wineDataSupported={this.options.wineDataSupported}
            onWineEnabledChange={this.options.onWineEnabledChange}
            onOpenWineCmd={this.options.onOpenWineCmd}
            onOpenWineCfg={this.options.onOpenWineCfg}
            winePrefix={this.options.winePrefix}
            wineInstalled={this.options.wineInstalled}
            wineActionDisabled={this.options.wineActionDisabled}
            onResetWineEnv={this.options.onResetWineEnv}
            gameWinePrefixExists={this.options.gameWinePrefixExists}
            onRemoveGameWinePrefix={this.options.onRemoveGameWinePrefix}
            onDirtyChange={dirty => {
              this.wineDirty.current = dirty;
            }}
          />
        </Show>
      </>
    );
  }
}
