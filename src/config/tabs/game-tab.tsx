import {
  Button,
  Divider,
  FormControl,
  FormLabel,
  HStack,
  TabPanel,
  Text,
  VStack,
} from "@hope-ui/solid";
import { JSXElement, Show } from "solid-js";
import { Locale } from "../../locale";

export function GameTab(props: {
  locale: Locale;
  displayGameVersion: () => string;
  gameInstalled: () => boolean;
  gameUpdateCheckDisabled: () => boolean;
  gameProxyEnabled: () => boolean;
  onCheckGameUpdate: () => void;
  GameInstallDirConfig: () => JSXElement;
  ProxyEnabledConfig: () => JSXElement;
  ProxyHostConfig: () => JSXElement;
  ChannelClientConfig: () => JSXElement;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$4"} w="100%" alignItems="start">
        <FormControl>
          <FormLabel>{props.locale.get("GAME_VERSION")}</FormLabel>
          <HStack spacing={"$2"} alignItems="center">
            <Text userSelect={"none"}>{props.displayGameVersion()}</Text>
            <Show when={props.gameInstalled()}>
              <Button
                variant="ghost"
                size="sm"
                disabled={props.gameUpdateCheckDisabled()}
                onClick={props.onCheckGameUpdate}
              >
                {props.locale.get("SETTING_CHECK_GAME_UPDATE")}
              </Button>
            </Show>
          </HStack>
        </FormControl>
        <Divider />
        <props.GameInstallDirConfig />
        <Divider />
        <props.ProxyEnabledConfig />
        <Show when={props.gameProxyEnabled()}>
          <props.ProxyHostConfig />
        </Show>
        <Divider />
        <props.ChannelClientConfig />
      </VStack>
    </TabPanel>
  );
}
