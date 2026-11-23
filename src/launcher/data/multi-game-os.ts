import {
  HK4E_OS_LIBRARY_TITLE,
  HK4E_OS_USER_DATA_PATH,
  HKRPG_OS_LIBRARY_TITLE,
  HKRPG_OS_USER_DATA_PATH,
  NAP_OS_LIBRARY_TITLE,
  NAP_OS_USER_DATA_PATH,
  BH3_OS_LIBRARY_TITLE,
} from "../../clients/secret";
import { createClient as createHk4eOsClient } from "../../clients/hk4eos";
import { createClient as createHsrOsClient } from "../../clients/hkrpgos";
import { createClient as createZzzOsClient } from "../../clients/napos";
import { createClient as createBh3GlbClient } from "../../clients/bh3glb";
import { GAME_BANNER_URLS, GAME_ICON_URLS } from "./game-assets";
import { getWineUserData } from "../../clients/game-data-paths";
import type { MultiGameGameSpec } from "./multi-game-spec";

export const MULTI_GAME_OS_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "hk4e",
    clientId: "hk4eos",
    namespace: "hphk4e",
    title: HK4E_OS_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS["hk4e"],
    serverLabel: "SERVER_LABEL_GLOBAL",
    wineUserData: getWineUserData(HK4E_OS_USER_DATA_PATH),
    createClient: createHk4eOsClient,
  },
  {
    id: "hsr",
    clientId: "hkrpgos",
    namespace: "hphsr",
    title: HKRPG_OS_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS["hsr"],
    serverLabel: "SERVER_LABEL_GLOBAL",
    wineUserData: getWineUserData(HKRPG_OS_USER_DATA_PATH),
    createClient: createHsrOsClient,
  },
  {
    id: "zzz",
    clientId: "napos",
    namespace: "hpzzz",
    title: NAP_OS_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS["zzz"],
    iconImage: GAME_ICON_URLS["zzz"],
    serverLabel: "SERVER_LABEL_GLOBAL",
    wineUserData: getWineUserData(NAP_OS_USER_DATA_PATH),
    createClient: createZzzOsClient,
  },
  {
    id: "bh3",
    clientId: "bh3glb",
    namespace: "hpbh3",
    title: BH3_OS_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS["bh3"],
    iconImage: GAME_ICON_URLS["bh3"],
    bannerImage: GAME_BANNER_URLS["bh3"],
    serverLabel: "SERVER_LABEL_GLOBAL",
    createClient: createBh3GlbClient,
  },
];

export const DEFAULT_MULTI_GAME_OS_GAME_SPECS = MULTI_GAME_OS_GAME_SPECS;
