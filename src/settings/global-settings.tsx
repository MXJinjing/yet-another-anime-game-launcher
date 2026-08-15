import { Show, JSXElement } from "solid-js";
import { Tab } from "@hope-ui/solid";
import { Locale } from "../locale";
import { Wine } from "../wine";
import { GeneralTab } from "./tabs/general-tab";
import { WineTab } from "./tabs/wine-tab";
import { HostsHelperControl } from "./controls/general/hosts-helper";
import { GlobalLoadedSettings, SettingsUIProps } from "./settings-types";
import { SettingsController } from "./settings-controller";

export type GlobalSettingsOptions = {
  locale: Locale;
  settings: GlobalLoadedSettings;
  wine: Wine;
  wineInstalled: () => boolean;
  actionDisabled: () => boolean;
  onResetWineEnv: () => Promise<void>;
  modalTitle?: () => string;
};

export class GlobalSettings extends SettingsController<GlobalLoadedSettings> {
  private readonly options: GlobalSettingsOptions;

  constructor(options: GlobalSettingsOptions) {
    super(options.locale, options.settings, options.modalTitle);
    this.options = options;
  }

  protected renderTabList(_props: SettingsUIProps): JSXElement {
    return (
      <>
        <Tab>{this.locale.get("SETTING_GENERAL")}</Tab>
        <Tab>Wine</Tab>
      </>
    );
  }

  protected renderAuxiliaryLinks(props: SettingsUIProps): JSXElement {
    return (
      <Show when={props.onOpenAbout != null && props.onOpenLicense != null}>
        <div class="hoyoplay-settings-nav-bottom">
          <button
            class="hoyoplay-settings-nav-button"
            type="button"
            onClick={() => props.onOpenAbout?.()}
          >
            {this.locale.currentLanguage.startsWith("zh")
              ? "关于 Yaaglm"
              : "About Yaaglm"}
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
    );
  }

  protected renderTabs(_props: SettingsUIProps): JSXElement {
    const settings = this.settings;
    return (
      <>
        <GeneralTab
          locale={this.locale}
          DisableVideoBackgroundConfig={settings.disableVideoBackground}
          LeftCmdConfig={settings.leftCmd}
          AutoUpdateConfig={settings.autoUpdate}
          DownloadServerConfig={settings.downloadServer}
          GithubAcceleratedPrefixConfig={settings.githubAcceleratedPrefix}
          LocaleConfig={settings.locale}
          ThemeColorConfig={settings.themeColor}
          HostsHelperConfig={() => <HostsHelperControl locale={this.locale} />}
        />
        <WineTab
          locale={this.locale}
          wine={this.options.wine}
          wineInstalled={this.options.wineInstalled}
          winePrefix={this.options.wine.prefix}
          WineDistroConfig={settings.wineDistro ?? (() => null)}
          onResetWineEnv={this.options.onResetWineEnv}
          wineActionDisabled={this.options.actionDisabled}
        />
      </>
    );
  }
}
