import { JSXElement } from "solid-js";
import type { TaskProgram } from "@tasks/task-program";
import { Config } from "./config";
import { Locale } from "./locale";
import type {
  HoyoConnectGameBanner,
  HoyoConnectGamePost,
  HoyoConnectLauncherIcon,
  HoyoConnectSocialMedia,
} from "./clients/mhy/launcher-info";

export type ChannelClientInstallState = "INSTALLED" | "NOT_INSTALLED";

/**
 * A game-owned log location used by launch debug mode. Paths are relative to
 * the selected root so each client can describe its own logging layout.
 */
export type GameLogLocation = {
  root: "wine-user" | "wine-prefix" | "game-install";
  path: string;
  /** Walk this directory and tail matching text logs below it. */
  recursive?: boolean;
  /** Optional file extensions for recursive locations, e.g. [".log"]. */
  extensions?: readonly string[];
};
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
  /** Game-specific error/runtime log files used by debug mode. */
  gameLogLocations?: readonly GameLogLocation[];
  /** Latest normal-release version targeted by install/update tasks. */
  latestVersion?: () => string;

  showPredownloadPrompt: () => boolean;
  updateRequired: () => boolean;
  predownloadVersion: () => string;

  /** True when all launcher-managed runtime components (e.g. DXMT) are ready. */
  runtimeReady: () => boolean;
  /** Re-reads persisted runtime state and refreshes `runtimeReady`. */
  refreshRuntimeReady: () => Promise<void>;
  /** Installs any missing launcher-managed runtime components (e.g. DXMT). */
  continueInstall: () => TaskProgram;

  uiContent: {
    background?: string;
    background_video?: string;
    background_theme?: string;
    /** All fetched backgrounds for the multi-background switcher. */
    backgrounds?: ChannelClientBackground[];
    /** Clickable launcher image buttons parsed from hyp-connect icon fields. */
    launcherIconButtons?: HoyoConnectLauncherIcon[];
    /** Launcher home carousel banners fetched from hyp-connect. */
    banners?: HoyoConnectGameBanner[];
    /** Launcher home posts (announcements, activities, and info). */
    posts?: HoyoConnectGamePost[];
    /** Launcher home social-media entries and their links/QR codes. */
    social_media_list?: HoyoConnectSocialMedia[];
    /** Whether deferred launcher announcements and social media have loaded. */
    launcherContentLoaded?: boolean;
    url: string;
    iconImage?: string;
    launchButtonLocation?: "left" | "right";
    logo?: string;
    /** Fallback channel name for offline or API-unavailable scenarios */
    channelName?: string;
    /** CSS gradient string for offline background fallback */
    fallbackBackground?: string;
  };
  /** Hydrates non-critical launcher announcements and social media content. */
  hydrateUiContent?: () => Promise<void>;

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
