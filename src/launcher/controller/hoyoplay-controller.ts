import type { Aria2 } from "../../integrations/aria2";
import type { TaskProgram } from "@tasks/task-program";
import type { Locale } from "../../locale";
import {
  getKeyOrDefault,
  setKey,
  withStorageNamespace,
} from "@runtime/storage";
import { ensureMultiGameGameWine } from "@wine/multi-game";
import { createUnityLogTail } from "../../logging/game-log-tail";
import {
  appendRuntimeLog,
  type RuntimeLogLevel,
} from "../../logging/runtime-log";
import type { HoyoplayGame } from "./launcher-types";

/** Wrap a game operation with its per-game Wine and storage namespace. */
export function gameProgram(
  aria2: Aria2,
  baseWine: import("../../wine").Wine,
  game: HoyoplayGame,
  program: () => TaskProgram
): () => TaskProgram {
  if (!game.namespace || !game.wineRef || !game.wineTag) return program;
  const wineRef = game.wineRef;
  const wineTag = game.wineTag;
  const namespace = game.namespace;
  return async function* () {
    wineRef.current = yield* ensureMultiGameGameWine({
      aria2,
      baseWine,
      gameId: game.id,
      wineTag: wineTag(),
      downloadKey: namespace,
    });
    const iterator = await withStorageNamespace(namespace, async () =>
      program()
    );
    while (true) {
      const result = await withStorageNamespace(namespace, async () =>
        iterator.next()
      );
      if (result.done) return;
      yield result.value;
    }
  };
}

export async function clearGameInstallationState(game: HoyoplayGame) {
  const clear = async () => {
    await setKey("game_install_dir", null);
    await game.client.changeInstallDir?.("");
  };
  if (game.namespace) await withStorageNamespace(game.namespace, clear);
  else await clear();
}

export function inferUnityLogLevel(line: string): RuntimeLogLevel {
  if (/\b(error|failed|exception|fatal|corrupt|crash)\b/i.test(line)) {
    return "ERROR";
  }
  if (
    /\b(warn|missing|out of bound|serialization|different layout)\b/i.test(line)
  ) {
    return "WARNING";
  }
  return "INFO";
}

/** Compose launch and optional Unity-log tailing outside the view layer. */
export function createGameLaunchProgram({
  game,
  baseWine,
  openLogs,
  getStopLogTail,
  setStopLogTail,
}: {
  game: HoyoplayGame;
  baseWine: import("../../wine").Wine;
  openLogs: () => void;
  getStopLogTail: () => (() => void) | undefined;
  setStopLogTail: (stop: (() => void) | undefined) => void;
}): TaskProgram {
  return (async function* () {
    const config = game.config.advancedEnable
      ? game.config
      : { ...game.config, reshade: false, metalFxEnable: false };
    if (
      (await getKeyOrDefault("config_debug_mode", "false")) === "true" &&
      game.client.installState() === "INSTALLED"
    ) {
      getStopLogTail()?.();
      const prefix = game.wineRef
        ? game.wineRef.current.prefix
        : baseWine.prefix;
      appendRuntimeLog(
        `Debug mode: watching Unity log under ${prefix}`,
        "INFO"
      );
      openLogs();
      setStopLogTail(
        createUnityLogTail({
          prefix,
          onLine: line =>
            appendRuntimeLog(`[Unity] ${line}`, inferUnityLogLevel(line)),
        })
      );
    }
    try {
      yield* game.client.launch(config);
    } finally {
      getStopLogTail()?.();
      setStopLogTail(undefined);
    }
  })();
}

export function gameDownloadTaskMetadata(
  game: HoyoplayGame,
  locale: Locale,
  mode: "release" | "current" | "predownload"
) {
  const rawVersion =
    mode === "predownload"
      ? game.client.predownloadVersion()
      : mode === "current"
      ? game.client.gameVersion?.() ?? ""
      : game.client.latestVersion?.() ?? game.client.gameVersion?.() ?? "";
  const version = rawVersion && rawVersion !== "0.0.0" ? rawVersion : "";
  const baseTitle = [game.title, version].filter(Boolean).join(" ");
  return {
    title:
      mode === "predownload"
        ? `${baseTitle} ${locale.get("DOWNLOAD_TASK_PREDOWNLOAD_SUFFIX")}`
        : baseTitle,
    key: game.namespace,
  };
}
