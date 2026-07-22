import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  TabPanel,
  Text,
  VStack,
} from "@hope-ui/solid";
import { JSXElement, Show } from "solid-js";
import { Locale } from "../../locale";
import { exec2 } from "../../utils";

export function WineTab(props: {
  locale: Locale;
  wineInstalled: () => boolean;
  winePrefix: string;
  WineDistroConfig: () => JSXElement;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$4"} w="100%" alignItems="stretch">
        <FormControl>
          <FormLabel>{props.locale.get("SETTING_WINE_STATUS")}</FormLabel>
          <Text userSelect={"none"}>
            {props.wineInstalled()
              ? props.locale.get("SETTING_WINE_STATUS_INSTALLED")
              : props.locale.get("SETTING_WINE_STATUS_NOT_INSTALLED")}
          </Text>
        </FormControl>
        <FormControl>
          <FormLabel>{props.locale.get("SETTING_WINE_PREFIX_PATH")}</FormLabel>
          <HStack spacing={"$2"} alignItems="center" w="100%">
            <Input disabled readOnly value={props.winePrefix} flex={1} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                exec2(["open", props.winePrefix], {}, false, "/dev/null")
              }
            >
              {props.locale.get("SETTING_OPEN")}
            </Button>
          </HStack>
        </FormControl>
        <Show when={props.wineInstalled()}>
          <props.WineDistroConfig />
        </Show>
      </VStack>
    </TabPanel>
  );
}
