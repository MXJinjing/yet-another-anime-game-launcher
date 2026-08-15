import { JSXElement } from "solid-js";
import type { TaskProgram } from "@tasks/task-program";
import { Config } from "./config";
import { Locale } from "./locale";

export type ChannelClientInstallState = "INSTALLED" | "NOT_INSTALLED";
export type ChannelClientConfigUI =
  | ((props?: { onOpenGlobalSettings?: () => void }) => JSXElement)
  | {
      launch: (props?: { onOpenGlobalSettings?: () => void }) => JSXElement;
      video?: (props?: { onOpenGlobalSettings?: () => void }) => JSXElement;
    };

export type ChannelClientBackground = {
  id?: string;
  background?: string;
  background_video?: string;
  background_theme?: string;
  type?: string;
};

export interface ChannelClient {
  installState: () => ChannelClientInstallState;
  installDir: () => string;
  gameVersion?: () => string;
  /** Latest normal-release version targeted by install/update tasks. */
  latestVersion?: () => string;

  showPredownloadPrompt: () => boolean;
  updateRequired: () => boolean;
  predownloadVersion: () => string;

  uiContent: {
    background?: string;
    background_video?: string;
    background_theme?: string;
    /** All fetched backgrounds for the multi-background switcher. */
    backgrounds?: ChannelClientBackground[];
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

  update(): TaskProgram;
  install(path: string): TaskProgram;
  predownload(): TaskProgram;
  launch(config: Config): TaskProgram;
  checkIntegrity(): TaskProgram;
  init(config: Config): TaskProgram;
  changeInstallDir?(path: string): Promise<void>;
  createConfig(
    locale: Locale,
    config: Partial<Config>
  ): Promise<ChannelClientConfigUI>;
}
