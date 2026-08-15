import { Divider } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { Locale } from "../../locale";
import { SettingsTabPanel } from "./settings-tab-panel";

export function GeneralTab(props: {
  locale: Locale;
  DisableVideoBackgroundConfig: () => JSXElement;
  LeftCmdConfig: () => JSXElement;
  AutoUpdateConfig: () => JSXElement;
  DownloadServerConfig: () => JSXElement;
  GithubAcceleratedPrefixConfig: () => JSXElement;
  LocaleConfig: () => JSXElement;
  ThemeColorConfig: () => JSXElement;
  HostsHelperConfig: () => JSXElement;
}) {
  return (
    <SettingsTabPanel>
      <>
        <props.ThemeColorConfig />
        <Divider />
        <props.DisableVideoBackgroundConfig />
        <Divider />
        <props.LocaleConfig />
        <Divider />
        <props.AutoUpdateConfig />
        <Divider />
        <props.LeftCmdConfig />
        <Divider />
        <props.DownloadServerConfig />
        <Divider />
        <props.GithubAcceleratedPrefixConfig />
        <Divider />
        <props.HostsHelperConfig />
      </>
    </SettingsTabPanel>
  );
}
