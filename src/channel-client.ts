import { JSXElement } from "solid-js";
import { CommonUpdateProgram } from "./common-update-ui";
import { Config } from "./config";
import { Locale } from "./locale";

export type ChannelClientInstallState = "INSTALLED" | "NOT_INSTALLED";
export type ChannelClientConfigUI =
  | (() => JSXElement)
  | {
      game: () => JSXElement;
      video?: () => JSXElement;
    };

export interface ChannelClient {
  installState: () => ChannelClientInstallState;
  installDir: () => string;
  gameVersion?: () => string;

  showPredownloadPrompt: () => boolean;
  updateRequired: () => boolean;
  predownloadVersion: () => string;

  uiContent: {
    background?: string;
    background_video?: string;
    background_theme?: string;
    url: string;
    iconImage?: string;
    launchButtonLocation?: "left" | "right";
    logo?: string;
    /** Fallback channel name for offline or API-unavailable scenarios */
    channelName?: string;
    /** CSS gradient string for offline background fallback */
    fallbackBackground?: string;
  };

  dismissPredownload(): void;

  update(): CommonUpdateProgram;
  install(path: string): CommonUpdateProgram;
  predownload(): CommonUpdateProgram;
  launch(config: Config): CommonUpdateProgram;
  checkIntegrity(): CommonUpdateProgram;
  init(config: Config): CommonUpdateProgram;
  changeInstallDir?(path: string): Promise<void>;
  createConfig(
    locale: Locale,
    config: Partial<Config>
  ): Promise<ChannelClientConfigUI>;
}
