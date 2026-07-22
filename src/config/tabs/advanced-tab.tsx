import { Alert, AlertIcon, TabPanel, VStack } from "@hope-ui/solid";
import { JSXElement } from "solid-js";
import { Locale } from "../../locale";

export function AdvancedTab(props: {
  locale: Locale;
  FPSUnlockConfig: () => JSXElement;
  ReShadeConfig: () => JSXElement;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$4"} w="40%" alignItems="start">
        <Alert status="warning" variant="left-accent">
          <AlertIcon mr="$2_5" />
          {props.locale.get("SETTING_ADVANCED_ALERT")}
        </Alert>
        <props.FPSUnlockConfig />
        <props.ReShadeConfig />
      </VStack>
    </TabPanel>
  );
}
