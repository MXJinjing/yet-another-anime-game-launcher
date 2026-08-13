import AponiaIcon from "../assets/Aponia.cr.webp";
import NahidaIcon from "../assets/Nahida.cr.png";
import { GAME_ICON_URLS } from "./game-assets";

export type SingleGameChannelMeta = {
  id: string;
  title: string;
  serverLabel: string;
  fallbackIcon: string;
};

export const SINGLE_GAME_CHANNEL_META: Record<string, SingleGameChannelMeta> = {
  hk4ecn: {
    id: "hk4ecn",
    title: "Genshin Impact CN",
    serverLabel: "国服",
    fallbackIcon: GAME_ICON_URLS["genshin"],
  },
  hk4eos: {
    id: "hk4eos",
    title: "Genshin Impact",
    serverLabel: "国际服",
    fallbackIcon: GAME_ICON_URLS["genshin"],
  },
  hk4euniversal: {
    id: "hk4euniversal",
    title: "Genshin Impact",
    serverLabel: "Uni",
    fallbackIcon: GAME_ICON_URLS["genshin"],
  },
  hkrpgcn: {
    id: "hkrpgcn",
    title: "Honkai: Star Rail CN",
    serverLabel: "国服",
    fallbackIcon: GAME_ICON_URLS["hsr"],
  },
  hkrpgos: {
    id: "hkrpgos",
    title: "Honkai: Star Rail",
    serverLabel: "国际服",
    fallbackIcon: GAME_ICON_URLS["hsr"],
  },
  napcn: {
    id: "napcn",
    title: "Zenless Zone Zero CN",
    serverLabel: "国服",
    fallbackIcon: GAME_ICON_URLS["zzz"],
  },
  napos: {
    id: "napos",
    title: "Zenless Zone Zero",
    serverLabel: "国际服",
    fallbackIcon: GAME_ICON_URLS["zzz"],
  },
  bh3glb: {
    id: "bh3glb",
    title: "Honkai Impact 3rd",
    serverLabel: "国际服",
    fallbackIcon: AponiaIcon,
  },
  cbjq: {
    id: "cbjq",
    title: "Snowbreak: Containment Zone",
    serverLabel: "国际服",
    fallbackIcon: NahidaIcon,
  },
  cbjqcn: {
    id: "cbjqcn",
    title: "Snowbreak: Containment Zone CN",
    serverLabel: "国服",
    fallbackIcon: NahidaIcon,
  },
};
