import type { Aria2 } from "@aria2";
import type { Locale, LocaleTextKey } from "@locale";
import type { ChannelClient } from "../../channel-client";
import type { Wine } from "../../wine";

export type MultiGameGameSpec = {
  id: string;
  namespace: string;
  title: string;
  fallbackIcon: string;
  iconImage?: string;
  bannerImage?: string;
  logoImage?: string;
  serverLabel: LocaleTextKey;
  createClient: (options: {
    wine: Wine;
    aria2: Aria2;
    locale: Locale;
  }) => Promise<ChannelClient>;
};
