import { Divider, TabPanel, VStack } from "@hope-ui/solid";
import { JSXElement } from "solid-js";

export function LaunchTab(props: {
  ChannelClientConfig: () => JSXElement;
  DebugModeConfig: () => JSXElement;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$6"} w="100%" alignItems="start">
        <props.DebugModeConfig />
        <Divider />
        <props.ChannelClientConfig />
      </VStack>
    </TabPanel>
  );
}
