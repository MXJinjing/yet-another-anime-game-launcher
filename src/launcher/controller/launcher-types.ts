import type { Accessor, JSXElement } from "solid-js";
import type { Aria2 } from "../../integrations/aria2";
import type { TaskProgram } from "@tasks/task-program";
import type { Locale } from "../../locale";
import type { ChannelClient } from "../../channel-client";
import type { Config } from "../../config/config-def";
import type { Wine, WineDistribution } from "../../wine";
import type { MultiGameWineRef } from "@wine/multi-game";

export type HoyoplayGameWineOption = {
  tag: string;
  displayName: string;
  url: string;
};

export type HoyoplayGame = {
  id: string;
  namespace?: string;
  title: string;
  fallbackIcon: string;
  iconImage?: string;
  bannerImage?: string;
  logoImage?: string;
  serverLabel: string;
  client: ChannelClient;
  config: Config;
  ConfigurationUI: (props: {
    opened: boolean;
    onClose: (action: "check-integrity" | "close") => void;
    onOpenLogs: () => void;
    actionDisabled: () => boolean;
    onOpenGlobalSettings?: () => void;
  }) => JSXElement;
  wineRef?: MultiGameWineRef;
  wineTag?: Accessor<string>;
  setWineTag?: (value: string) => void;
  wineOptions?: HoyoplayGameWineOption[];
};

export type HoyoplayLauncherOptions = {
  games: HoyoplayGame[];
  showLibrary: boolean;
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  locale: Locale;
  aria2: Aria2;
  onCheckUpdate: () => void;
  onGameRunningChange?: (running: boolean) => void;
  onResetWineEnv: () => Promise<void>;
  initializeWine: (distro: WineDistribution) => TaskProgram;
  enableWineDistro: (distro: WineDistribution) => TaskProgram;
  uninstallWineDistro: (distro: WineDistribution) => TaskProgram;
  actionDisabledRef?: { current: () => boolean };
};
