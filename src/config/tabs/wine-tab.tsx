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
import { JSXElement } from "solid-js";
import { Locale } from "../../locale";
import { exec2 } from "../../utils";
import { Wine } from "../../wine";

export function WineTab(props: {
  locale: Locale;
  wine: Wine;
  wineInstalled: () => boolean;
  winePrefix: string;
  WineDistroConfig: () => JSXElement;
  onResetWineEnv: () => Promise<void>;
  wineActionDisabled: () => boolean;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$4"} w="100%" alignItems="stretch">
        <FormControl>
          <FormLabel>{props.locale.get("SETTING_WINE_STATUS")}</FormLabel>
          <Text userSelect={"none"}>
            {props.wineInstalled()
              ? props.locale.get("SETTING_WINE_ENV_INITIALIZED")
              : props.locale.get("SETTING_WINE_ENV_NOT_INITIALIZED")}
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
          <HStack spacing={"$2"} mt="$2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.wineInstalled()}
              onClick={() =>
                props.wine.openCmdWindow({
                  gameDir: props.winePrefix,
                })
              }
            >
              {props.locale.get("SETTING_OPEN_WINE_CMD")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.wineInstalled()}
              onClick={() =>
                props.wine.exec2("winecfg", [], {}, "/dev/null")
              }
            >
              {props.locale.get("SETTING_OPEN_WINECFG")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              colorScheme="danger"
              disabled={!props.wineInstalled() || props.wineActionDisabled()}
              onClick={() => props.onResetWineEnv()}
            >
              {props.locale.get("SETTING_RESET_WINE_ENV")}
            </Button>
          </HStack>
        </FormControl>
        <props.WineDistroConfig />
      </VStack>
    </TabPanel>
  );
}