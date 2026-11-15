import { Divider } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import type { Locale } from "@locale";
import { SophonSettingsPanel } from "../controls/sophon-settings-panel";
import { SettingsTabPanel } from "./settings-tab-panel";

export function DownloadTab(props: {
  locale: Locale;
  DownloadServerConfig: () => JSXElement;
  GithubAcceleratedPrefixConfig: () => JSXElement;
}) {
  return (
    <SettingsTabPanel>
      <>
        <props.DownloadServerConfig />
        <Divider />
        <props.GithubAcceleratedPrefixConfig />
        <Divider />
        <SophonSettingsPanel locale={props.locale} />
      </>
    </SettingsTabPanel>
  );
}
