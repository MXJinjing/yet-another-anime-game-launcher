import type { GameLogLocation } from "../channel-client";

/**
 * Game-owned log locations used by launch debug mode.
 *
 * `wine-user` is resolved for every user directory in the Wine prefix. This
 * keeps the records independent of the Wine username and covers both the
 * Chinese and global product folder names where the game has used different
 * names over time.
 */

const UNITY_LOG_FALLBACK: GameLogLocation = {
  root: "wine-user",
  path: "AppData/LocalLow",
  recursive: true,
  extensions: ["output_log.txt", "Player.log"],
};

export const HK4E_GAME_LOG_LOCATIONS: readonly GameLogLocation[] = [
  { root: "wine-user", path: "AppData/LocalLow/miHoYo/原神/output_log.txt" },
  {
    root: "wine-user",
    path: "AppData/LocalLow/miHoYo/Genshin Impact/output_log.txt",
  },
  {
    root: "wine-user",
    path: "AppData/LocalLow/HoYoverse/Genshin Impact/Player.log",
  },
  UNITY_LOG_FALLBACK,
];

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
  UNITY_LOG_FALLBACK,
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
  UNITY_LOG_FALLBACK,
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
  UNITY_LOG_FALLBACK,
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
];
