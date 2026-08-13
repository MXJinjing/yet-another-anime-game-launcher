import { createClient as createGenshinCnClient } from "../clients/hk4ecn";
import { createClient as createHsrCnClient } from "../clients/hkrpgcn";
import { createClient as createZzzCnClient } from "../clients/napcn";
import { GAME_ICON_URLS } from "./game-assets";
import type { MultiGameGameSpec } from "./multi-game";

export const MULTI_GAME_CN_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "genshin",
    namespace: "hpcngenshin",
    title: "Genshin Impact CN",
    fallbackIcon: GAME_ICON_URLS["genshin"],
    serverLabel: "国服",
    createClient: createGenshinCnClient,
  },
  {
    id: "hsr",
    namespace: "hpcnhsr",
    title: "Honkai: Star Rail CN",
    fallbackIcon: GAME_ICON_URLS["hsr"],
    serverLabel: "国服",
    createClient: createHsrCnClient,
  },
  {
    id: "zzz",
    namespace: "hpcnzzz",
    title: "Zenless Zone Zero CN",
    fallbackIcon: GAME_ICON_URLS["zzz"],
    iconImage: GAME_ICON_URLS["zzz"],
    serverLabel: "国服",
    createClient: createZzzCnClient,
  },
];
