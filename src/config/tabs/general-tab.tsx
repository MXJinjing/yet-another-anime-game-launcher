import {
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  Heading,
  TabPanel,
  Text,
  VStack,
} from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { CURRENT_YAAGL_VERSION } from "../../constants";
import { Locale } from "../../locale";
import { exec2, resolve } from "../../utils";
import { Wine } from "../../wine";

export function GeneralTab(props: {
  locale: Locale;
  wine: Wine;
  wineInstalled: () => boolean;
  gameInstallDir: () => string;
  onCheckIntegrity: () => void;
  onCheckUpdate: () => void;
  onOpenLogs: () => void;
  MetalHUDConfig: () => JSXElement;
  LeftCmdConfig: () => JSXElement;
  DownloadServerConfig: () => JSXElement;
  LocaleConfig: () => JSXElement;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <Box
        h="100%"
        display="grid"
        style={{ "grid-template-columns": "65% 35%" }}
      >
        <Box alignSelf="stretch" overflowY="scroll" pr={20}>
          <VStack spacing={"$4"}>
            <props.MetalHUDConfig />
            <props.LeftCmdConfig />
            <Divider />
            <props.DownloadServerConfig />
            <Divider />
            <props.LocaleConfig />
            <FormControl>
              <FormLabel>{props.locale.get("SETTING_YAAGL_VERSION")}</FormLabel>
              <Text userSelect={"none"}>{CURRENT_YAAGL_VERSION}</Text>
            </FormControl>
          </VStack>
        </Box>
        <VStack spacing={"$1"} alignItems="start" alignSelf="start" pl={20}>
          <Heading level="1" ml={12} mb={"$4"}>
            {props.locale.get("SETTING_QUICK_ACTIONS")}
          </Heading>
          <Button variant="ghost" size="sm" onClick={props.onCheckIntegrity}>
            {props.locale.get("SETTING_CHECK_INTEGRITY")}
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onOpenLogs}>
            {props.locale.get("LOG_VIEWER_OPEN_ACTION")}
          </Button>
          <Divider />
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.wineInstalled()}
            onClick={() =>
              props.wine.openCmdWindow({
                gameDir: props.gameInstallDir(),
              })
            }
          >
            {props.locale.get("SETTING_OPEN_CMD")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.gameInstallDir()}
            onClick={() =>
              exec2(["open", props.gameInstallDir()], {}, false, "/dev/null")
            }
          >
            {props.locale.get("SETTING_OPEN_GAME_INSTALL_DIR")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () =>
              await exec2(["open", resolve("./")], {}, false, "/dev/null")
            }
          >
            {props.locale.get("SETTING_OPEN_YAAGL_DIR")}
          </Button>
          <Divider />
          <Button variant="ghost" size="sm" onClick={props.onCheckUpdate}>
            {props.locale.get("SETTING_CHECK_UPDATE")}
          </Button>
        </VStack>
      </Box>
    </TabPanel>
  );
}
