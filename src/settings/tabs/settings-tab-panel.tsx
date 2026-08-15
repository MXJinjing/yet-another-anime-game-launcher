import { TabPanel, VStack } from "@hope-ui/solid";
import type { JSXElement } from "solid-js";

export function SettingsTabPanel(props: { children: JSXElement }) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$6"} w="100%" alignItems="stretch">
        {props.children}
      </VStack>
    </TabPanel>
  );
}
