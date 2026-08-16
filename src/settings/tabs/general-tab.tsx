import { Divider } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { SettingsTabPanel } from "./settings-tab-panel";

export function GeneralTab(props: {
  DisableVideoBackgroundConfig: () => JSXElement;
  LeftCmdConfig: () => JSXElement;
  AutoUpdateConfig: () => JSXElement;
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
        <props.HostsHelperConfig />
      </>
    </SettingsTabPanel>
  );
}
