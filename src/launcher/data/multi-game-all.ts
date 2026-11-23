import {
  HK4E_CN_LIBRARY_TITLE,
  HK4E_CN_USER_DATA_PATH,
  HK4E_OS_LIBRARY_TITLE,
  HK4E_OS_USER_DATA_PATH,
  HKRPG_CN_LIBRARY_TITLE,
  HKRPG_CN_USER_DATA_PATH,
  HKRPG_OS_LIBRARY_TITLE,
  HKRPG_OS_USER_DATA_PATH,
  NAP_CN_LIBRARY_TITLE,
  NAP_CN_USER_DATA_PATH,
  NAP_OS_LIBRARY_TITLE,
  NAP_OS_USER_DATA_PATH,
  BH3_OS_LIBRARY_TITLE,
} from "../../clients/secret";
import AponiaIcon from "../../assets/Aponia.cr.webp";
import { createClient as createBh3Client } from "../../clients/bh3glb";
import { createClient as createHk4eCnClient } from "../../clients/hk4ecn";
import { createClient as createHk4eOsClient } from "../../clients/hk4eos";
import { createClient as createHsrCnClient } from "../../clients/hkrpgcn";
import { createClient as createHsrOsClient } from "../../clients/hkrpgos";
import { createClient as createZzzCnClient } from "../../clients/napcn";
import { createClient as createZzzOsClient } from "../../clients/napos";
import { GAME_ICON_URLS, GAME_ICON_URLS_CN } from "./game-assets";
import { getWineUserData } from "../../clients/game-data-paths";
import type { MultiGameGameSpec } from "./multi-game-spec";

export const MULTI_GAME_ALL_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "all-hk4e-cn",
    clientId: "hk4ecn",
    namespace: "all-hk4e-cn",
    title: HK4E_CN_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS_CN.hk4e,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "hk4e_cn",
    wineUserData: getWineUserData(HK4E_CN_USER_DATA_PATH),
    createClient: createHk4eCnClient,
  },
  {
    id: "all-hk4e-os",
    clientId: "hk4eos",
    namespace: "all-hk4e-os",
    title: HK4E_OS_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS.hk4e,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "hk4e_global",
    wineUserData: getWineUserData(HK4E_OS_USER_DATA_PATH),
    createClient: createHk4eOsClient,
  },
  {
    id: "all-hsr-cn",
    clientId: "hkrpgcn",
    namespace: "all-hsr-cn",
    title: HKRPG_CN_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS_CN.hsr,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "hkrpg_cn",
    wineUserData: getWineUserData(HKRPG_CN_USER_DATA_PATH),
    createClient: createHsrCnClient,
  },
  {
    id: "all-hsr-os",
    clientId: "hkrpgos",
    namespace: "all-hsr-os",
    title: HKRPG_OS_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS.hsr,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "hkrpg_global",
    wineUserData: getWineUserData(HKRPG_OS_USER_DATA_PATH),
    createClient: createHsrOsClient,
  },
  {
    id: "all-zzz-cn",
    clientId: "napcn",
    namespace: "all-zzz-cn",
    title: NAP_CN_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS_CN.zzz,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "nap_cn",
    wineUserData: getWineUserData(NAP_CN_USER_DATA_PATH),
    createClient: createZzzCnClient,
  },
  {
    id: "all-zzz-os",
    clientId: "napos",
    namespace: "all-zzz-os",
    title: NAP_OS_LIBRARY_TITLE,
    fallbackIcon: GAME_ICON_URLS.zzz,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "nap_global",
    wineUserData: getWineUserData(NAP_OS_USER_DATA_PATH),
    createClient: createZzzOsClient,
  },
  {
    id: "all-bh3-os",
    clientId: "bh3glb",
    namespace: "all-bh3-os",
    title: BH3_OS_LIBRARY_TITLE,
    fallbackIcon: AponiaIcon,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "bh3_global",
    createClient: createBh3Client,
  },
];
