import { Divider } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { SettingsTabPanel } from "./settings-tab-panel";

export function GeneralTab(props: {
  DisableVideoBackgroundConfig: () => JSXElement;
  AutoUpdateConfig: () => JSXElement;
  LocaleConfig: () => JSXElement;
  ThemeColorConfig: () => JSXElement;
  HostsHelperConfig: () => JSXElement;
  LauncherDataConfig: () => JSXElement;
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
        <props.LauncherDataConfig />
        <Divider />
        <props.AutoUpdateConfig />
        <Divider />
        <props.HostsHelperConfig />
      </>
    </SettingsTabPanel>
  );
}
