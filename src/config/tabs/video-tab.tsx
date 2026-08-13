import { TabPanel, VStack, HStack, Box, Text } from "@hope-ui/solid";
import { JSXElement, createSignal, createEffect, Show } from "solid-js";
import { setKey } from "@utils";
import { Locale } from "@locale";
import { SettingSwitch } from "../../components/setting-switch";
import { Config } from "../config-def";

const CONFIG_KEY = "config_advanced_enable";

export function VideoTab(props: {
  locale: Locale;
  RetinaConfig: () => JSXElement;
  PreferredMaxFpsConfig?: () => JSXElement;
  MetalHUDConfig?: () => JSXElement;
  ChannelClientVideoConfig?: () => JSXElement;
  VsyncDisableConfig?: () => JSXElement;
  MetalFxUpscaleConfig?: (opts?: { disabled?: boolean }) => JSXElement;
  ReShadeConfig?: (opts?: { disabled?: boolean }) => JSXElement;
  config?: Partial<Config>;
}) {
  const [advancedEnabled, setAdvancedEnabled] = createSignal(
    !!props.config?.advancedEnable
  );

  createEffect(() => {
    const v = advancedEnabled();
    if (props.config && props.config.advancedEnable !== v) {
      props.config.advancedEnable = v;
      setKey(CONFIG_KEY, v ? "true" : "false");
    }
  });

  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <HStack spacing="$6" alignItems="start" w="100%">
        <VStack spacing={"$6"} w="48%" alignItems="start">
          {props.ChannelClientVideoConfig ? (
            <props.ChannelClientVideoConfig />
          ) : null}
          <props.RetinaConfig />
          {props.PreferredMaxFpsConfig ? <props.PreferredMaxFpsConfig /> : null}
          {props.MetalHUDConfig ? <props.MetalHUDConfig /> : null}
        </VStack>

        <Box w="1px" h="100%" bg="$neutral5" />

        <VStack spacing={"$6"} w="48%" alignItems="start">
          {props.VsyncDisableConfig ? <props.VsyncDisableConfig /> : null}
          <Box>
            <SettingSwitch
              id="advancedEnable"
              label={props.locale.get("SETTING_ADVANCED")}
              checked={advancedEnabled()}
              onChange={setAdvancedEnabled}
            />
            <Text color="$danger9" fontSize={12} mt="$1" userSelect="none">
              * {props.locale.get("SETTING_ADVANCED_ALERT")}
            </Text>
          </Box>

          {props.MetalFxUpscaleConfig
            ? props.MetalFxUpscaleConfig({ disabled: !advancedEnabled() })
            : null}
          {props.ReShadeConfig
            ? props.ReShadeConfig({ disabled: !advancedEnabled() })
            : null}
        </VStack>
      </HStack>
    </TabPanel>
  );
}
