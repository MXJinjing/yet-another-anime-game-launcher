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
    namespace: "all-hk4e-cn",
    title: atob("R2Vuc2hpbiBJbXBhY3QgQ04="),
    fallbackIcon: GAME_ICON_URLS_CN.hk4e,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "hk4e_cn",
    createClient: createHk4eCnClient,
  },
  {
    id: "all-hk4e-os",
    namespace: "all-hk4e-os",
    title: atob("R2Vuc2hpbiBJbXBhY3Q="),
    fallbackIcon: GAME_ICON_URLS.hk4e,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "hk4e_global",
    createClient: createHk4eOsClient,
  },
  {
    id: "all-hsr-cn",
    namespace: "all-hsr-cn",
    title: atob("SG9ua2FpOiBTdGFyIFJhaWwgQ04="),
    fallbackIcon: GAME_ICON_URLS_CN.hsr,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "hkrpg_cn",
    createClient: createHsrCnClient,
  },
  {
    id: "all-hsr-os",
    namespace: "all-hsr-os",
    title: atob("SG9ua2FpOiBTdGFyIFJhaWw="),
    fallbackIcon: GAME_ICON_URLS.hsr,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "hkrpg_global",
    createClient: createHsrOsClient,
  },
  {
    id: "all-zzz-cn",
    namespace: "all-zzz-cn",
    title: atob("WmVubGVzcyBab25lIFplcm8gQ04="),
    fallbackIcon: GAME_ICON_URLS_CN.zzz,
    serverLabel: "SERVER_LABEL_CN",
    displayRegion: "CN",
    displayBiz: "nap_cn",
    createClient: createZzzCnClient,
  },
  {
    id: "all-zzz-os",
    namespace: "all-zzz-os",
    title: atob("WmVubGVzcyBab25lIFplcm8="),
    fallbackIcon: GAME_ICON_URLS.zzz,
    serverLabel: "SERVER_LABEL_GLOBAL",
    displayRegion: "OS",
    displayBiz: "nap_global",
    createClient: createZzzOsClient,
  },
  {
    id: "all-bh3-os",
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
    namespace: "all-cbjq-os",
    title: atob("U25vd2JyZWFrOiBDb250YWlubWVudCBab25l"),
    fallbackIcon: NahidaIcon,
    serverLabel: "SERVER_LABEL_GLOBAL",
    createClient: createCbjqClient,
  },
  {
    id: "all-cbjq-cn",
    namespace: "all-cbjq-cn",
    title: atob("U25vd2JyZWFrOiBDb250YWlubWVudCBab25lIENO"),
    fallbackIcon: NahidaIcon,
    serverLabel: "SERVER_LABEL_CN",
    createClient: createCbjqCnClient,
  },
];
