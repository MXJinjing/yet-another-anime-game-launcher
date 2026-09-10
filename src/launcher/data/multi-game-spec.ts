import type { Aria2 } from "@aria2";
import type { Locale, LocaleTextKey } from "@locale";
import type { ChannelClient } from "../../channel-client";
import type { Wine } from "../../wine";
import type { BootPerformance } from "../../boot-performance";
import type { Storage } from "../../runtime/storage";
import type { HoyoPlayRegion } from "../../clients/mhy/hyp-connect";
import type { WineUserDataDescriptor } from "../../wine/user-data";

export type MultiGameGameSpec = {
  id: string;
  /** Channel client code name, e.g. `napcn`; used for per-game Wine paths. */
  clientId: string;
  namespace: string;
  title: string;
  fallbackIcon: string;
  iconImage?: string;
  bannerImage?: string;
  logoImage?: string;
  /** Optional official catalog lookup for a client in a combined channel. */
  displayRegion?: HoyoPlayRegion;
  displayBiz?: string;
  serverLabel: LocaleTextKey;
  /** Per-game data moved when the game uses its own Wine prefix. */
  wineUserData?: WineUserDataDescriptor;
  createClient: (options: {
    wine: Wine;
    aria2: Aria2;
    locale: Locale;
    storage: Storage;
    bootPerformance?: BootPerformance;
  }) => Promise<ChannelClient>;
};
