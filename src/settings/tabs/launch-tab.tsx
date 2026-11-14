import { Button, Divider, VStack } from "@hope-ui/solid";
import { JSXElement, Show } from "solid-js";
import type { Locale } from "@locale";
import { SettingsTabPanel } from "./settings-tab-panel";

export function LaunchTab(props: {
  locale: Locale;
  onApplyRecommendedSettings?: () => void;
  recommendedSettingsDisabled?: () => boolean;
  recommendedSettingsUsesSharedWine?: () => boolean;
  ChannelClientConfig: (props?: {
    onOpenGlobalSettings?: () => void;
  }) => JSXElement;
  onOpenGlobalSettings?: () => void;
  DebugModeConfig: () => JSXElement;
  CustomEnvironmentVariablesConfig: () => JSXElement;
}) {
  return (
    <SettingsTabPanel>
      <>
        <Show when={props.onApplyRecommendedSettings}>
          <VStack alignItems="start" spacing="$1">
            <Button
              size="sm"
              disabled={props.recommendedSettingsDisabled?.()}
              onClick={() => props.onApplyRecommendedSettings?.()}
            >
              {props.locale.get("SETTING_APPLY_RECOMMENDED_SETTINGS")}
            </Button>
            <Show when={props.recommendedSettingsUsesSharedWine?.()}>
              <span class="hyp-settings-muted">
                {props.locale.get("SETTING_RECOMMENDED_SETTINGS_SHARED_WINE")}
              </span>
            </Show>
          </VStack>
          <Divider />
        </Show>
        <props.DebugModeConfig />
        <Divider />
        <props.ChannelClientConfig
          onOpenGlobalSettings={props.onOpenGlobalSettings}
        />
        <Divider />
        <props.CustomEnvironmentVariablesConfig />
      </>
    </SettingsTabPanel>
  );
}
