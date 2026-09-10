import AponiaIcon from "../../assets/Aponia.cr.webp";
import NahidaIcon from "../../assets/Nahida.cr.png";
import { createClient as createBh3Client } from "../../clients/bh3glb";
import { createClient as createCbjqCnClient } from "../../clients/cbjqcn";
import { createClient as createCbjqClient } from "../../clients/cbjq";
import { createClient as createHk4eCnClient } from "../../clients/hk4ecn";
import { createClient as createHk4eOsClient } from "../../clients/hk4eos";
import { createClient as createHsrCnClient } from "../../clients/hkrpgcn";
import { createClient as createHsrOsClient } from "../../clients/hkrpgos";
import { createClient as createZzzCnClient } from "../../clients/napcn";
import { createClient as createZzzOsClient } from "../../clients/napos";
import { GAME_ICON_URLS, GAME_ICON_URLS_CN } from "./game-assets";
import type { MultiGameGameSpec } from "./multi-game-spec";

export const MULTI_GAME_ALL_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "all-hk4e-cn",
    clientId: "hk4ecn",
    namespace: "all-hk4e-cn",
    title: atob("R2Vuc2hpbiBJbXBhY3QgQ04="),
    fallbackIcon: GAME_ICON_URLS_CN.hk4e,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "hk4e_cn",
    wineUserData: {
      registryKeys: ["Software\\miHoYo\\原神", "Software\\miHoYoSDK"],
      prefixDirs: ["drive_c/users/*/AppData/LocalLow/miHoYo/原神"],
    },
    createClient: createHk4eCnClient,
  },
  {
    id: "all-hk4e-os",
    clientId: "hk4eos",
    namespace: "all-hk4e-os",
    title: atob("R2Vuc2hpbiBJbXBhY3Q="),
    fallbackIcon: GAME_ICON_URLS.hk4e,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "hk4e_global",
    wineUserData: {
      registryKeys: ["Software\\miHoYo\\Genshin Impact", "Software\\miHoYoSDK"],
      prefixDirs: ["drive_c/users/*/AppData/LocalLow/miHoYo/Genshin Impact"],
    },
    createClient: createHk4eOsClient,
  },
  {
    id: "all-hsr-cn",
    clientId: "hkrpgcn",
    namespace: "all-hsr-cn",
    title: atob("SG9ua2FpOiBTdGFyIFJhaWwgQ04="),
    fallbackIcon: GAME_ICON_URLS_CN.hsr,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "hkrpg_cn",
    wineUserData: {
      registryKeys: ["Software\\miHoYo\\崩坏：星穹铁道", "Software\\miHoYoSDK"],
      prefixDirs: ["drive_c/users/*/AppData/LocalLow/miHoYo/崩坏：星穹铁道"],
    },
    createClient: createHsrCnClient,
  },
  {
    id: "all-hsr-os",
    clientId: "hkrpgos",
    namespace: "all-hsr-os",
    title: atob("SG9ua2FpOiBTdGFyIFJhaWw="),
    fallbackIcon: GAME_ICON_URLS.hsr,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "hkrpg_global",
    wineUserData: {
      registryKeys: ["Software\\Cognosphere\\Star Rail", "Software\\miHoYoSDK"],
      prefixDirs: ["drive_c/users/*/AppData/LocalLow/Cognosphere/Star Rail"],
    },
    createClient: createHsrOsClient,
  },
  {
    id: "all-zzz-cn",
    clientId: "napcn",
    namespace: "all-zzz-cn",
    title: atob("WmVubGVzcyBab25lIFplcm8gQ04="),
    fallbackIcon: GAME_ICON_URLS_CN.zzz,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "nap_cn",
    wineUserData: {
      registryKeys: ["Software\\miHoYo\\绝区零", "Software\\miHoYoSDK"],
      prefixDirs: ["drive_c/users/*/AppData/LocalLow/miHoYo/绝区零"],
    },
    createClient: createZzzCnClient,
  },
  {
    id: "all-zzz-os",
    clientId: "napos",
    namespace: "all-zzz-os",
    title: atob("WmVubGVzcyBab25lIFplcm8="),
    fallbackIcon: GAME_ICON_URLS.zzz,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "nap_global",
    wineUserData: {
      registryKeys: [
        "Software\\miHoYo\\ZenlessZoneZero",
        "Software\\miHoYoSDK",
      ],
      prefixDirs: ["drive_c/users/*/AppData/LocalLow/miHoYo/ZenlessZoneZero"],
    },
    createClient: createZzzOsClient,
  },
  {
    id: "all-bh3-os",
    clientId: "bh3glb",
    namespace: "all-bh3-os",
    title: atob("SG9ua2FpIEltcGFjdCAzcmQ="),
    fallbackIcon: AponiaIcon,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "bh3_global",
    createClient: createBh3Client,
  },
  {
    id: "all-cbjq-os",
    clientId: "cbjq",
    namespace: "all-cbjq-os",
    title: atob("U25vd2JyZWFrOiBDb250YWlubWVudCBab25l"),
    fallbackIcon: NahidaIcon,
    serverLabel: "SERVER_LABEL_GLOBAL",
    createClient: createCbjqClient,
  },
  {
    id: "all-cbjq-cn",
    clientId: "cbjqcn",
    namespace: "all-cbjq-cn",
    title: atob("U25vd2JyZWFrOiBDb250YWlubWVudCBab25lIENO"),
    fallbackIcon: NahidaIcon,
    serverLabel: "SERVER_LABEL_CN",
    createClient: createCbjqCnClient,
  },
];
