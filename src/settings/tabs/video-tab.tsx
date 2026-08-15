import { Box, Divider, Text } from "@hope-ui/solid";
import { JSXElement, createSignal, createEffect, Show } from "solid-js";
import { Locale } from "@locale";
import { SettingSwitch } from "../../components/setting-switch";
import { configEntries, ConfigStore } from "@config";
import { Config } from "@config/config-def";
import { SettingsTabPanel } from "./settings-tab-panel";

export function VideoTab(props: {
  locale: Locale;
  RetinaConfig: () => JSXElement;
  PreferredMaxFpsConfig?: () => JSXElement;
  ChannelClientVideoConfig?: () => JSXElement;
  VsyncDisableConfig?: () => JSXElement;
  MetalFxUpscaleConfig?: (opts?: { disabled?: boolean }) => JSXElement;
  ReShadeConfig?: (opts?: { disabled?: boolean }) => JSXElement;
  config?: Partial<Config>;
  configStore: ConfigStore;
}) {
  const [advancedEnabled, setAdvancedEnabled] = createSignal(
    !!props.config?.advancedEnable
  );

  createEffect(() => {
    const v = advancedEnabled();
    if (props.config && props.config.advancedEnable !== v) {
      props.config.advancedEnable = v;
      void props.configStore.write(configEntries.advancedEnable, v);
    }
  });

  return (
    <SettingsTabPanel>
      <>
        {props.ChannelClientVideoConfig ? (
          <>
            <props.ChannelClientVideoConfig />
            <Divider />
          </>
        ) : null}
        <props.RetinaConfig />
        {props.PreferredMaxFpsConfig ? <props.PreferredMaxFpsConfig /> : null}
        {props.VsyncDisableConfig ? <props.VsyncDisableConfig /> : null}
        <Divider />
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
      </>
    </SettingsTabPanel>
  );
}
