import {
  HK4E_CN_LIBRARY_TITLE,
  HK4E_CN_USER_DATA_PATH,
  HKRPG_CN_LIBRARY_TITLE,
  HKRPG_CN_USER_DATA_PATH,
  NAP_CN_LIBRARY_TITLE,
  NAP_CN_USER_DATA_PATH,
} from "../../clients/secret";
import { createClient as createHk4eCnClient } from "../../clients/hk4ecn";
import { createClient as createHsrCnClient } from "../../clients/hkrpgcn";
import { createClient as createZzzCnClient } from "../../clients/napcn";
import { GAME_BANNER_URLS_CN, GAME_ICON_URLS_CN } from "./game-assets";
import { getWineUserData } from "../../clients/game-data-paths";
import type { MultiGameGameSpec } from "./multi-game-spec";

export const MULTI_GAME_CN_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "hk4e",
    clientId: "hk4ecn",
    namespace: "hpcnhk4e",
    title: HK4E_CN_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS_CN["hk4e"],
    bannerImage: GAME_BANNER_URLS_CN["hk4e"],
    serverLabel: "SERVER_LABEL_CN",
    wineUserData: getWineUserData(HK4E_CN_USER_DATA_PATH),
    createClient: createHk4eCnClient,
  },
  {
    id: "hsr",
    clientId: "hkrpgcn",
    namespace: "hpcnhsr",
    title: HKRPG_CN_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS_CN["hsr"],
    bannerImage: GAME_BANNER_URLS_CN["hsr"],
    serverLabel: "SERVER_LABEL_CN",
    wineUserData: getWineUserData(HKRPG_CN_USER_DATA_PATH),
    createClient: createHsrCnClient,
  },
  {
    id: "zzz",
    clientId: "napcn",
    namespace: "hpcnzzz",
    title: NAP_CN_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS_CN["zzz"],
    iconImage: GAME_ICON_URLS_CN["zzz"],
    bannerImage: GAME_BANNER_URLS_CN["zzz"],
    serverLabel: "SERVER_LABEL_CN",
    wineUserData: getWineUserData(NAP_CN_USER_DATA_PATH),
    createClient: createZzzCnClient,
  },
];
