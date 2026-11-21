import type { Aria2 } from "../../integrations/aria2";
import type { TaskProgram } from "@tasks/task-program";
import type { Locale } from "../../locale";
import { getKeyOrDefault } from "@runtime/storage";
import { ensureMultiGameGameWine } from "@wine/multi-game";
import type { GameLogLocation } from "../../channel-client";
import type { HypGame } from "./launcher-types";

/** Wrap a game operation with its per-game Wine selection. */
export function gameProgram(
  aria2: Aria2,
  baseWine: import("../../wine").Wine,
  game: HypGame,
  program: () => TaskProgram
): () => TaskProgram {
  if (!game.namespace || !game.wineRef || !game.wineTag) return program;
  const wineRef = game.wineRef;
  const wineTag = game.wineTag;
  return async function* () {
    wineRef.current = yield* ensureMultiGameGameWine({
      aria2,
      baseWine,
      gameId: game.id,
      prefixId: game.clientId,
      wineTag: wineTag(),
      downloadKey: game.namespace,
    });
    const iterator = program();
    while (true) {
      const result = await iterator.next();
      if (result.done) return;
      yield result.value;
    }
  };
}

export async function clearGameInstallationState(game: HypGame) {
  await game.storage?.setKey("game_install_dir", null);
  await game.client.changeInstallDir?.("");
}

export interface GameDebugLogTarget {
  prefix: string;
  gameDir: string;
  locations: readonly GameLogLocation[];
}

/** Compose launch and optional game-log opening outside the view layer. */
export function createGameLaunchProgram({
  game,
  baseWine,
  onDebugLogs,
}: {
  game: HypGame;
  baseWine: import("../../wine").Wine;
  onDebugLogs?: (target: GameDebugLogTarget) => void | Promise<void>;
}): TaskProgram {
  return (async function* () {
    const config = game.config.advancedEnable
      ? game.config
      : { ...game.config, reshade: false, metalFxEnable: false };
    if (
      (await getKeyOrDefault("config_debug_mode", "false")) === "true" &&
      game.client.installState() === "INSTALLED"
    ) {
      try {
        await onDebugLogs?.({
          prefix: game.wineRef ? game.wineRef.current.prefix : baseWine.prefix,
          gameDir: game.client.installDir(),
          locations: game.client.gameLogLocations ?? [],
        });
      } catch {
        // A log window failure must not block the game itself.
      }
    }
    yield* game.client.launch(config);
  })();
}

export type GameTaskAction =
  | "install"
  | "update"
  | "continue"
  | "predownload"
  | "integrity"
  | "environment";

const GAME_TASK_ACTION_KEYS = {
  install: "DOWNLOAD_TASK_ACTION_INSTALL",
  update: "DOWNLOAD_TASK_ACTION_UPDATE",
  continue: "DOWNLOAD_TASK_ACTION_CONTINUE",
  predownload: "DOWNLOAD_TASK_ACTION_PREDOWNLOAD",
  integrity: "DOWNLOAD_TASK_ACTION_INTEGRITY",
  environment: "DOWNLOAD_TASK_ACTION_ENVIRONMENT",
} as const;

export function gameRegionCode(
  game: { id?: string; clientId?: string; serverLabel?: string },
  locale: Locale
) {
  for (const value of [game.clientId, game.id]) {
    const id = value?.toLowerCase() ?? "";
    if (!id) continue;
    if (id.endsWith("cn")) return "CN";
    if (id.includes("universal")) return "UNI";
    if (id.endsWith("os") || id.includes("glb")) return "OS";
  }
  if (game.serverLabel === locale.get("SERVER_LABEL_CN")) return "CN";
  if (game.serverLabel === locale.get("SERVER_LABEL_UNI")) return "UNI";
  if (game.serverLabel === locale.get("SERVER_LABEL_GLOBAL")) return "OS";
  return "";
}

export function formatGameTaskTitle(
  game: { title: string; id?: string; clientId?: string; serverLabel?: string },
  locale: Locale,
  action?: GameTaskAction,
  version?: string
) {
  const region = gameRegionCode(game, locale);
  const name = region
    ? game.title.replace(new RegExp(`\\s+${region}$`, "i"), "").trim()
    : game.title.trim();
  const knownVersion = version && version !== "0.0.0" ? version : "";
  const actionText = action ? locale.get(GAME_TASK_ACTION_KEYS[action]) : "";
  return [name, region, actionText, knownVersion].filter(Boolean).join(" ");
}

export function formatGameProgressTitle(
  locale: Locale,
  action: GameTaskAction,
  version?: string
) {
  const actionText = locale.get(GAME_TASK_ACTION_KEYS[action]);
  const knownVersion = version && version !== "0.0.0" ? version : "";
  return knownVersion
    ? locale.format("DOWNLOAD_TASK_IN_PROGRESS_VERSION", [
        actionText,
        knownVersion,
      ])
    : locale.format("DOWNLOAD_TASK_IN_PROGRESS", [actionText]);
}

export function gameDownloadTaskMetadata(
  game: HypGame,
  locale: Locale,
  mode:
    | "release"
    | "current"
    | "install"
    | "update"
    | "continue"
    | "predownload"
    | "integrity"
    | "environment"
) {
  const action: GameTaskAction | undefined =
    mode === "release" || mode === "install"
      ? "install"
      : mode === "update"
      ? "update"
      : mode === "continue"
      ? "continue"
      : mode === "predownload"
      ? "predownload"
      : mode === "integrity"
      ? "integrity"
      : mode === "environment"
      ? "environment"
      : undefined;
  const rawVersion =
    mode === "predownload"
      ? game.client.predownloadVersion()
      : mode === "current" || mode === "integrity" || mode === "environment"
      ? game.client.gameVersion?.() ?? game.client.latestVersion?.() ?? ""
      : game.client.latestVersion?.() ?? game.client.gameVersion?.() ?? "";
  return {
    title: formatGameTaskTitle(game, locale, action, rawVersion),
    ...(action
      ? { progressTitle: formatGameProgressTitle(locale, action, rawVersion) }
      : {}),
    key: game.namespace,
  };
}
