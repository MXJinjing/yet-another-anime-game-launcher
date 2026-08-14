import { Divider, TabPanel, VStack } from "@hope-ui/solid";
import { JSXElement, Show } from "solid-js";
import { Locale } from "../../locale";

export function GameTab(props: {
  locale: Locale;
  gameProxyEnabled: () => boolean;
  GameInstallDirConfig: () => JSXElement;
  ProxyEnabledConfig: () => JSXElement;
  ProxyHostConfig: () => JSXElement;
  MetalHUDConfig: () => JSXElement;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$6"} w="100%" alignItems="start">
        <props.GameInstallDirConfig />
        <Divider />
        <VStack spacing={0} w="100%" alignItems="start">
          <props.ProxyEnabledConfig />
          <Show when={props.gameProxyEnabled()}>
            <props.ProxyHostConfig />
          </Show>
        </VStack>
        <Divider />
        <props.MetalHUDConfig />
      </VStack>
    </TabPanel>
  );
}
