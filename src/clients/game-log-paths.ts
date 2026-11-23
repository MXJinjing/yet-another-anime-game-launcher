import {
  HK4E_CN_OUTPUT_LOG,
  HK4E_OS_OUTPUT_LOG,
  HK4E_OS_PLAYER_LOG,
  HKRPG_CN_PLAYER_LOG,
  HKRPG_OS_LEGACY_PLAYER_LOG,
  HKRPG_OS_PLAYER_LOG,
  NAP_CN_PLAYER_LOG,
  NAP_OS_LEGACY_PLAYER_LOG,
  NAP_OS_OUTPUT_LOG,
  NAP_OS_PLAYER_LOG,
  BH3_CN_OUTPUT_LOG,
  BH3_OS_OUTPUT_LOG,
  BH3_OS_CRASH_DIR,
  CBJQ_WEBVIEW_LOG,
} from "./secret";
import type { GameLogLocation } from "../channel-client";

/**
 * Game-owned log locations used by launch debug mode.
 *
 * `wine-user` is resolved for every user directory in the Wine prefix. This
 * keeps the records independent of the Wine username and covers both the
 * Chinese and global product folder names where the game has used different
 * names over time.
 */

const DRIVER_ERROR_LOG: GameLogLocation = {
  root: "game-install",
  path: "driverError.log",
};

const HK4E_CN_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  { root: "wine-user", path: HK4E_CN_OUTPUT_LOG },
  DRIVER_ERROR_LOG,
];

const HK4E_OS_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "wine-user",
    path: HK4E_OS_OUTPUT_LOG,
  },
  {
    root: "wine-user",
    path: HK4E_OS_PLAYER_LOG,
  },
  DRIVER_ERROR_LOG,
];

export function getHK4EGameLogLocations(
  releaseType: "os" | "cn" | "bb"
): readonly GameLogLocation[] {
  return releaseType === "os"
    ? HK4E_OS_GAME_LOG_LOCATIONS
    : HK4E_CN_GAME_LOG_LOCATIONS;
}

export const HKRPG_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "wine-user",
    path: HKRPG_CN_PLAYER_LOG,
  },
  {
    root: "wine-user",
    path: HKRPG_OS_LEGACY_PLAYER_LOG,
  },
  {
    root: "wine-user",
    path: HKRPG_OS_PLAYER_LOG,
  },
  DRIVER_ERROR_LOG,
];

export const NAP_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "wine-user",
    path: NAP_CN_PLAYER_LOG,
  },
  {
    root: "wine-user",
    path: NAP_OS_LEGACY_PLAYER_LOG,
  },
  {
    root: "wine-user",
    path: NAP_OS_OUTPUT_LOG,
  },
  {
    root: "wine-user",
    path: NAP_OS_PLAYER_LOG,
  },
  DRIVER_ERROR_LOG,
];

export const BH3_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "wine-user",
    path: BH3_CN_OUTPUT_LOG,
  },
  {
    root: "wine-user",
    path: BH3_OS_OUTPUT_LOG,
  },
  {
    root: "wine-user",
    path: BH3_OS_CRASH_DIR,
    recursive: true,
    extensions: [".log", ".txt"],
  },
  DRIVER_ERROR_LOG,
];

/** The CBJQ channel uses Unreal logs in the installed game directory. */
export const CBJQ_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "game-install",
    path: "Game/Binaries/Win64/logs",
    recursive: true,
    extensions: [".log"],
  },
  {
    root: "game-install",
    path: CBJQ_WEBVIEW_LOG,
  },
  {
    root: "wine-user",
    path: "AppData/Local/Game/Saved/Logs/Game.log",
  },
  DRIVER_ERROR_LOG,
];
