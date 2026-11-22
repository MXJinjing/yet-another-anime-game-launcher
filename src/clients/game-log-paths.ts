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
  { root: "wine-user", path: "AppData/LocalLow/miHoYo/原神/output_log.txt" },
  DRIVER_ERROR_LOG,
];

const HK4E_OS_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/Genshin Impact/output_log.txt",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/HoYoverse/Genshin Impact/Player.log",
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
    path: "AppData/LocalLow/miHoYo/崩坏：星穹铁道/Player.log",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/Honkai Star Rail/Player.log",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/Cognosphere/Star Rail/Player.log",
  },
  DRIVER_ERROR_LOG,
];

export const NAP_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/绝区零/Player.log",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/ZenlessZoneZero/Player.log",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/ZenlessZoneZero/output_log.txt",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/HoYoverse/ZenlessZoneZero/Player.log",
  },
  DRIVER_ERROR_LOG,
];

export const BH3_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/崩坏3/output_log.txt",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/Honkai Impact 3rd/output_log.txt",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/Honkai Impact 3rd/Crashes",
    recursive: true,
    extensions: [".log", ".txt"],
  },
  DRIVER_ERROR_LOG,
];

/** Snowbreak uses Unreal logs in the installed game directory. */
export const CBJQ_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  {
    root: "game-install",
    path: "Game/Binaries/Win64/logs",
    recursive: true,
    extensions: [".log"],
  },
  {
    root: "game-install",
    path: "Game/Plugins/XGSDKSeasun/Source/Libs/seasun/win64/cef_temp/cef.log",
  },
  {
    root: "wine-user",
    path: "AppData/Local/Game/Saved/Logs/Game.log",
  },
  DRIVER_ERROR_LOG,
];
