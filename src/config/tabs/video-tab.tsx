import { TabPanel, VStack } from "@hope-ui/solid";
import { JSXElement } from "solid-js";

export function VideoTab(props: {
  RetinaConfig: () => JSXElement;
  ChannelClientVideoConfig?: () => JSXElement;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$4"} w="40%" alignItems="start">
        {props.ChannelClientVideoConfig ? (
          <props.ChannelClientVideoConfig />
        ) : null}
        <props.RetinaConfig />
      </VStack>
    </TabPanel>
  );
}
