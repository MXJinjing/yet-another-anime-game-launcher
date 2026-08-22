import type { JSXElement, Accessor } from "solid-js";
import type { Config, ConfigStore } from "@config";

export type SettingsComponent = (props?: {
  onOpenGlobalSettings?: () => void;
}) => JSXElement;
export type AdvancedSettingsComponent = (opts?: {
  disabled?: boolean;
}) => JSXElement;

export type SettingsUIProps = {
  opened: boolean;
  onClose: (action: "check-integrity" | "close") => void;
  onOpenLogs: () => void;
  actionDisabled: () => boolean;
  onOpenAbout?: () => void;
  onOpenLicense?: () => void;
  onOpenGlobalSettings?: () => void;
  contentOnly?: boolean;
};

export type SettingsUI = (props: SettingsUIProps) => JSXElement;

export type BaseLoadedSettings = {
  config: Partial<Config>;
  configStore: ConfigStore;
  isVideoBackgroundDisabled?: Accessor<boolean>;
};

export type GlobalLoadedSettings = BaseLoadedSettings & {
  leftCmd: SettingsComponent;
  autoUpdate: SettingsComponent;
  locale: SettingsComponent;
  downloadServer: SettingsComponent;
  githubAcceleratedPrefix: SettingsComponent;
  themeColor: SettingsComponent;
  disableVideoBackground: SettingsComponent;
  isVideoBackgroundDisabled: Accessor<boolean>;
  wineDistro?: SettingsComponent;
  wineDistroController?: {
    markEnabled: (distro: import("@wine").WineDistribution) => void;
  };
};

export type GameLoadedSettings = BaseLoadedSettings & {
  metalHUD: SettingsComponent;
  gameInstallDir: SettingsComponent;
  retina: SettingsComponent;
  vsync: SettingsComponent;
  preferredMaxFps: SettingsComponent;
  metalFxUpscale: AdvancedSettingsComponent;
  reShade: AdvancedSettingsComponent;
  proxyEnabled: SettingsComponent;
  proxyHost: SettingsComponent;
  debugMode: SettingsComponent;
  customEnvironmentVariables: SettingsComponent;
  gameProxyEnabled: Accessor<boolean>;
  channelClientGame: SettingsComponent;
  channelClientVideo?: SettingsComponent;
};

/** @deprecated Use GlobalLoadedSettings or GameLoadedSettings. */
export type LoadedSettings = GlobalLoadedSettings | GameLoadedSettings;
