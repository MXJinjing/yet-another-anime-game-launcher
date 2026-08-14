import { Divider, TabPanel, VStack } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { Locale } from "../../locale";

export function GeneralTab(props: {
  locale: Locale;
  DisableVideoBackgroundConfig: () => JSXElement;
  LeftCmdConfig: () => JSXElement;
  DownloadServerConfig: () => JSXElement;
  LocaleConfig: () => JSXElement;
  ThemeColorConfig: () => JSXElement;
  HostsHelperConfig: () => JSXElement;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$6"} w="100%" alignItems="stretch">
        <props.ThemeColorConfig />
        <Divider />
        <props.DisableVideoBackgroundConfig />
        <Divider />
        <props.LocaleConfig />
        <Divider />
        <props.LeftCmdConfig />
        <Divider />
        <props.DownloadServerConfig />
        <Divider />
        <props.HostsHelperConfig />
      </VStack>
    </TabPanel>
  );
}
