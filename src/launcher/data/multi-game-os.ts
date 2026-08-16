import { createClient as createHk4eOsClient } from "../../clients/hk4eos";
import { createClient as createHsrOsClient } from "../../clients/hkrpgos";
import { createClient as createZzzOsClient } from "../../clients/napos";
import { createClient as createBh3GlbClient } from "../../clients/bh3glb";
import { GAME_BANNER_URLS, GAME_ICON_URLS } from "./game-assets";
import type { MultiGameGameSpec } from "./multi-game-spec";

export const MULTI_GAME_OS_GAME_SPECS: MultiGameGameSpec[] = [
  {
    id: "hk4e",
    namespace: "hphk4e",
    title: atob("R2Vuc2hpbiBJbXBhY3Q="),
    fallbackIcon: GAME_ICON_URLS["hk4e"],
    serverLabel: "SERVER_LABEL_GLOBAL",
    createClient: createHk4eOsClient,
  },
  {
    id: "hsr",
    namespace: "hphsr",
    title: atob("SG9ua2FpOiBTdGFyIFJhaWw="),
    fallbackIcon: GAME_ICON_URLS["hsr"],
    serverLabel: "SERVER_LABEL_GLOBAL",
    createClient: createHsrOsClient,
  },
  {
    id: "zzz",
    namespace: "hpzzz",
    title: atob("WmVubGVzcyBab25lIFplcm8="),
    fallbackIcon: GAME_ICON_URLS["zzz"],
    iconImage: GAME_ICON_URLS["zzz"],
    serverLabel: "SERVER_LABEL_GLOBAL",
    createClient: createZzzOsClient,
  },
  {
    id: "bh3",
    namespace: "hpbh3",
    title: atob("SG9ua2FpIEltcGFjdCAzcmQ="),
    fallbackIcon: GAME_ICON_URLS["bh3"],
    iconImage: GAME_ICON_URLS["bh3"],
    bannerImage: GAME_BANNER_URLS["bh3"],
    serverLabel: "SERVER_LABEL_GLOBAL",
    createClient: createBh3GlbClient,
  },
];

export const DEFAULT_MULTI_GAME_OS_GAME_SPECS = MULTI_GAME_OS_GAME_SPECS;
