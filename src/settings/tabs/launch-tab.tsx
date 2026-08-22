import { Divider } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { SettingsTabPanel } from "./settings-tab-panel";

export function LaunchTab(props: {
  ChannelClientConfig: (props?: {
    onOpenGlobalSettings?: () => void;
  }) => JSXElement;
  onOpenGlobalSettings?: () => void;
  DebugModeConfig: () => JSXElement;
  CustomEnvironmentVariablesConfig: () => JSXElement;
}) {
  return (
    <SettingsTabPanel>
      <>
        <props.DebugModeConfig />
        <Divider />
        <props.ChannelClientConfig
          onOpenGlobalSettings={props.onOpenGlobalSettings}
        />
        <Divider />
        <props.CustomEnvironmentVariablesConfig />
      </>
    </SettingsTabPanel>
  );
}
