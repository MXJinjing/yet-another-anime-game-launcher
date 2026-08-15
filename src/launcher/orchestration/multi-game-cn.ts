import { createClient as createGenshinCnClient } from "../../clients/hk4ecn";
import { createClient as createHsrCnClient } from "../../clients/hkrpgcn";
import { createClient as createZzzCnClient } from "../../clients/napcn";
import { GAME_BANNER_URLS_CN, GAME_ICON_URLS_CN } from "../data/game-assets";
import type { MultiGameGameSpec } from "./multi-game";

export const MULTI_GAME_CN_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "genshin",
    namespace: "hpcngenshin",
    title: "Genshin Impact CN",
    fallbackIcon: GAME_ICON_URLS_CN["genshin"],
    bannerImage: GAME_BANNER_URLS_CN["genshin"],
    serverLabel: "国服",
    createClient: createGenshinCnClient,
  },
  {
    id: "hsr",
    namespace: "hpcnhsr",
    title: "Honkai: Star Rail CN",
    fallbackIcon: GAME_ICON_URLS_CN["hsr"],
    bannerImage: GAME_BANNER_URLS_CN["hsr"],
    serverLabel: "国服",
    createClient: createHsrCnClient,
  },
  {
    id: "zzz",
    namespace: "hpcnzzz",
    title: "Zenless Zone Zero CN",
    fallbackIcon: GAME_ICON_URLS_CN["zzz"],
    iconImage: GAME_ICON_URLS_CN["zzz"],
    bannerImage: GAME_BANNER_URLS_CN["zzz"],
    serverLabel: "国服",
    createClient: createZzzCnClient,
  },
];
