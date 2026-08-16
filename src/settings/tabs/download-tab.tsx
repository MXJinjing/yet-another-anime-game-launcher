import { Divider } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { SettingsTabPanel } from "./settings-tab-panel";

export function DownloadTab(props: {
  DownloadServerConfig: () => JSXElement;
  GithubAcceleratedPrefixConfig: () => JSXElement;
}) {
  return (
    <SettingsTabPanel>
      <>
        <props.DownloadServerConfig />
        <Divider />
        <props.GithubAcceleratedPrefixConfig />
      </>
    </SettingsTabPanel>
  );
}
