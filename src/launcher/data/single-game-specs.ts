import AponiaIcon from "../../assets/Aponia.cr.webp";
import NahidaIcon from "../../assets/Nahida.cr.png";
import { GAME_ICON_URLS, GAME_ICON_URLS_CN } from "./game-assets";
import type { LocaleTextKey } from "@locale";

export type SingleGameChannelMeta = {
  id: string;
  title: string;
  serverLabel: LocaleTextKey;
  fallbackIcon: string;
};

export const SINGLE_GAME_CHANNEL_META: Record<string, SingleGameChannelMeta> = {
  hk4ecn: {
    id: "hk4ecn",
    title: atob("R2Vuc2hpbiBJbXBhY3QgQ04="),
    serverLabel: "SERVER_LABEL_CN",
    fallbackIcon: GAME_ICON_URLS_CN["hk4e"],
  },
  hk4eos: {
    id: "hk4eos",
    title: atob("R2Vuc2hpbiBJbXBhY3Q="),
    serverLabel: "SERVER_LABEL_GLOBAL",
    fallbackIcon: GAME_ICON_URLS["hk4e"],
  },
  hk4euniversal: {
    id: "hk4euniversal",
    title: atob("R2Vuc2hpbiBJbXBhY3Q="),
    serverLabel: "SERVER_LABEL_UNI",
    fallbackIcon: GAME_ICON_URLS["hk4e"],
  },
  hkrpgcn: {
    id: "hkrpgcn",
    title: atob("SG9ua2FpOiBTdGFyIFJhaWwgQ04="),
    serverLabel: "SERVER_LABEL_CN",
    fallbackIcon: GAME_ICON_URLS["hsr"],
  },
  hkrpgos: {
    id: "hkrpgos",
    title: atob("SG9ua2FpOiBTdGFyIFJhaWw="),
    serverLabel: "SERVER_LABEL_GLOBAL",
    fallbackIcon: GAME_ICON_URLS["hsr"],
  },
  napcn: {
    id: "napcn",
    title: atob("WmVubGVzcyBab25lIFplcm8gQ04="),
    serverLabel: "SERVER_LABEL_CN",
    fallbackIcon: GAME_ICON_URLS["zzz"],
  },
  napos: {
    id: "napos",
    title: atob("WmVubGVzcyBab25lIFplcm8="),
    serverLabel: "SERVER_LABEL_GLOBAL",
    fallbackIcon: GAME_ICON_URLS["zzz"],
  },
  bh3glb: {
    id: "bh3glb",
    title: atob("SG9ua2FpIEltcGFjdCAzcmQ="),
    serverLabel: "SERVER_LABEL_GLOBAL",
    fallbackIcon: AponiaIcon,
  },
  cbjq: {
    id: "cbjq",
    title: atob("U25vd2JyZWFrOiBDb250YWlubWVudCBab25l"),
    serverLabel: "SERVER_LABEL_GLOBAL",
    fallbackIcon: NahidaIcon,
  },
  cbjqcn: {
    id: "cbjqcn",
    title: atob("U25vd2JyZWFrOiBDb250YWlubWVudCBab25lIENO"),
    serverLabel: "SERVER_LABEL_CN",
    fallbackIcon: NahidaIcon,
  },
};
