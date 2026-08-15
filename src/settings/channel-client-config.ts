import type { JSXElement } from "solid-js";
import type { ChannelClientConfigUI } from "../channel-client";

type SettingsComponent = (props?: {
  onOpenGlobalSettings?: () => void;
}) => JSXElement;

/** Normalizes both historical function-form and object-form client settings. */
export function resolveChannelClientConfig(config: ChannelClientConfigUI): {
  channelClientGame: SettingsComponent;
  channelClientVideo?: SettingsComponent;
} {
  return typeof config === "function"
    ? { channelClientGame: config }
    : { channelClientGame: config.launch, channelClientVideo: config.video };
}
