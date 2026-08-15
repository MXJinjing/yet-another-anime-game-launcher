import { Divider, VStack } from "@hope-ui/solid";
import { JSXElement, Show } from "solid-js";
import { Locale } from "../../locale";
import { SettingsTabPanel } from "./settings-tab-panel";

export function GameTab(props: {
  locale: Locale;
  gameProxyEnabled: () => boolean;
  GameInstallDirConfig: () => JSXElement;
  ProxyEnabledConfig: () => JSXElement;
  ProxyHostConfig: () => JSXElement;
  MetalHUDConfig: () => JSXElement;
}) {
  return (
    <SettingsTabPanel>
      <>
        <props.GameInstallDirConfig />
        <Divider />
        <VStack spacing={0} w="100%" alignItems="stretch">
          <props.ProxyEnabledConfig />
          <Show when={props.gameProxyEnabled()}>
            <props.ProxyHostConfig />
          </Show>
        </VStack>
        <Divider />
        <props.MetalHUDConfig />
      </>
    </SettingsTabPanel>
  );
}
