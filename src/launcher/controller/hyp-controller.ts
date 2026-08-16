import type { Aria2 } from "../../integrations/aria2";
import type { TaskProgram } from "@tasks/task-program";
import type { Locale } from "../../locale";
import {
  getKeyOrDefault,
  setKey,
  withStorageNamespace,
} from "@runtime/storage";
import { ensureMultiGameGameWine } from "@wine/multi-game";
import { openGameLogFile } from "../../logging/game-log-tail";
import type { HypGame } from "./launcher-types";

/** Wrap a game operation with its per-game Wine and storage namespace. */
export function gameProgram(
  aria2: Aria2,
  baseWine: import("../../wine").Wine,
  game: HypGame,
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

export async function clearGameInstallationState(game: HypGame) {
  const clear = async () => {
    await setKey("game_install_dir", null);
    await game.client.changeInstallDir?.("");
  };
  if (game.namespace) await withStorageNamespace(game.namespace, clear);
  else await clear();
}

/** Compose launch and optional game-log opening outside the view layer. */
export function createGameLaunchProgram({
  game,
  baseWine,
  getStopGameLogOpen,
  setStopGameLogOpen,
}: {
  game: HypGame;
  baseWine: import("../../wine").Wine;
  getStopGameLogOpen: () => (() => void) | undefined;
  setStopGameLogOpen: (stop: (() => void) | undefined) => void;
}): TaskProgram {
  return (async function* () {
    const config = game.config.advancedEnable
      ? game.config
      : { ...game.config, reshade: false, metalFxEnable: false };
    if (
      (await getKeyOrDefault("config_debug_mode", "false")) === "true" &&
      game.client.installState() === "INSTALLED"
    ) {
      getStopGameLogOpen()?.();
      const prefix = game.wineRef
        ? game.wineRef.current.prefix
        : baseWine.prefix;
      setStopGameLogOpen(
        openGameLogFile({
          prefix,
          gameDir: game.client.installDir(),
          locations: game.client.gameLogLocations,
        })
      );
    }
    try {
      yield* game.client.launch(config);
    } finally {
      getStopGameLogOpen()?.();
      setStopGameLogOpen(undefined);
    }
  })();
}

export function gameDownloadTaskMetadata(
  game: HypGame,
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
