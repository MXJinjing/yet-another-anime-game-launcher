import { TabList, Tabs } from "@hope-ui/solid";
import { createSignal, JSXElement } from "solid-js";
import { AppModal } from "../components/app-modal";
import { Locale } from "../locale";
import { Config } from "@config";
import {
  BaseLoadedSettings,
  SettingsUI,
  SettingsUIProps,
} from "./settings-types";

export abstract class SettingsController<T extends BaseLoadedSettings> {
  protected constructor(
    protected readonly locale: Locale,
    protected readonly settings: T,
    private readonly modalTitle?: () => string
  ) {}

  get config(): Config {
    return this.settings.config as Config;
  }

  get disableVideoBackground() {
    return this.settings.isVideoBackgroundDisabled ?? (() => false);
  }

  /** Optional guard invoked before leaving a tab or closing the modal. */
  protected leaveGuard?: () => Promise<boolean>;

  protected abstract renderTabs(props: SettingsUIProps): JSXElement;

  protected abstract renderTabList(props: SettingsUIProps): JSXElement;

  readonly UI: SettingsUI = props => {
    const [tabIndex, setTabIndex] = createSignal(props.initialTab ?? 0);
    const guard = async (next: () => void) => {
      if (this.leaveGuard && !(await this.leaveGuard())) return;
      next();
    };
    const content = (
      <Tabs
        index={tabIndex()}
        onChange={(index: number) => {
          if (index === tabIndex()) return;
          void guard(() => setTabIndex(index));
        }}
        orientation="vertical"
        h="100%"
        variant="pills"
      >
        <div class="hyp-settings-nav">
          <TabList minW={120}>{this.renderTabList(props)}</TabList>
          {this.renderAuxiliaryLinks(props)}
        </div>
        {this.renderTabs(props)}
      </Tabs>
    );

    if (props.contentOnly) return content;

    return (
      <AppModal
        opened={props.opened}
        onClose={() => void guard(() => props.onClose("close"))}
        title={this.modalTitle?.() ?? this.locale.get("SETTING")}
        maxWidth={800}
        height={600}
        bodyClass="app-modal-body-settings"
      >
        {content}
      </AppModal>
    );
  };

  protected renderAuxiliaryLinks(_props: SettingsUIProps): JSXElement {
    return <></>;
  }
}
