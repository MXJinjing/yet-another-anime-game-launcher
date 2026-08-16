import { createClient as createHk4eCnClient } from "../../clients/hk4ecn";
import { createClient as createHsrCnClient } from "../../clients/hkrpgcn";
import { createClient as createZzzCnClient } from "../../clients/napcn";
import { GAME_BANNER_URLS_CN, GAME_ICON_URLS_CN } from "./game-assets";
import type { MultiGameGameSpec } from "./multi-game-spec";

export const MULTI_GAME_CN_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "hk4e",
    namespace: "hpcnhk4e",
    title: atob("R2Vuc2hpbiBJbXBhY3QgQ04="),
    fallbackIcon: GAME_ICON_URLS_CN["hk4e"],
    bannerImage: GAME_BANNER_URLS_CN["hk4e"],
    serverLabel: "SERVER_LABEL_CN",
    createClient: createHk4eCnClient,
  },
  {
    id: "hsr",
    namespace: "hpcnhsr",
    title: atob("SG9ua2FpOiBTdGFyIFJhaWwgQ04="),
    fallbackIcon: GAME_ICON_URLS_CN["hsr"],
    bannerImage: GAME_BANNER_URLS_CN["hsr"],
    serverLabel: "SERVER_LABEL_CN",
    createClient: createHsrCnClient,
  },
  {
    id: "zzz",
    namespace: "hpcnzzz",
    title: atob("WmVubGVzcyBab25lIFplcm8gQ04="),
    fallbackIcon: GAME_ICON_URLS_CN["zzz"],
    iconImage: GAME_ICON_URLS_CN["zzz"],
    bannerImage: GAME_BANNER_URLS_CN["zzz"],
    serverLabel: "SERVER_LABEL_CN",
    createClient: createZzzCnClient,
  },
];
