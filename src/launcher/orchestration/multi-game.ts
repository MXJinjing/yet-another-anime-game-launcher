import { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { createGameSettings } from "@settings";
import { Locale } from "@locale";
import { createStorage, getKeyOrDefault } from "@runtime/storage";
import { getWineDistributions, Wine, WineDistribution } from "@wine";
import { createSignal } from "solid-js";
import { reportBootProgress } from "../../boot-progress";
import { Config } from "../../config/config-def";
import {
  getLatestGameDisplays,
  HoyoPlayRegion,
} from "../../clients/mhy/hyp-connect";
import type { HoyoConnectGameDisplay } from "../../clients/mhy/launcher-info";
import { log } from "@logging/logger";
import { createHypLauncher } from "../controller/hyp-launcher";
import { MULTI_GAME_OS_GAME_SPECS } from "../data/multi-game-os";
import type {
  HypGame,
  HypGameWineTaskRequest,
} from "../controller/launcher-types";
import {
  AUTO_WINE_TAG,
  createMultiGameWineProxy,
  ensureMultiGameGameWine,
  getMultiGameGameWineEnabled,
  getMultiGameGameWineTag,
  getMultiGamePrefix,
  getMultiGameWineOptions,
  isMultiGamePrefixReady,
  prepareMultiGameGameWine,
  setMultiGameGameWineEnabled,
  setMultiGameGameWineTag,
  SHARED_WINE_TAG,
  MultiGameWineRef,
} from "@wine/multi-game";
import { fileOrDirExists } from "@platform/neutralino";
import { rmrf_dangerously } from "@runtime";

import type { MultiGameGameSpec } from "../data/multi-game-spec";
import type { BootPerformance } from "../../boot-performance";
export async function createMultiGameLauncher({
  wine,
  wineDistroId,
  wineInstalled,
  initializeWine,
  downloadWineDistro,
  enableWineDistro,
  uninstallWineDistro,
  locale,
  aria2,
  onCheckUpdate,
  onGameRunningChange,
  gameCloseHandler,
  onResetWineEnv,
  region,
  specs = MULTI_GAME_OS_GAME_SPECS,
  bootPerformance,
}: {
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  initializeWine: (distro: WineDistribution) => TaskProgram;
  downloadWineDistro: (
    distro: WineDistribution,
    downloadKey?: string
  ) => TaskProgram;
  enableWineDistro: (distro: WineDistribution) => TaskProgram;
  uninstallWineDistro: (distro: WineDistribution) => TaskProgram;
  locale: Locale;
  aria2: Aria2;
  onCheckUpdate: () => void;
  onGameRunningChange?: (running: boolean) => void;
  gameCloseHandler?: { current?: () => Promise<void> };
  onResetWineEnv: () => Promise<void>;
  region: HoyoPlayRegion;
  specs?: MultiGameGameSpec[];
  bootPerformance?: BootPerformance;
}) {
  const baseWine = wine;
  let globalWineName = wineDistroId;
  try {
    const distros = await getWineDistributions();
    globalWineName =
      distros.find(distro => distro.id == wineDistroId)?.displayName ??
      wineDistroId;
  } catch {
    /* keep the id as a fallback label */
  }
  const actionDisabledRef = { current: () => false };
  const gameWineTaskDispatcher: {
    current?: (request: HypGameWineTaskRequest) => void;
  } = {};
  const games: HypGame[] = [];

  const gameDisplays = new Map<
    HoyoPlayRegion,
    Map<string, HoyoConnectGameDisplay["display"]>
  >();
  try {
    const displayRegions = new Set(
      specs.map(spec => spec.displayRegion ?? region)
    );
    await Promise.all(
      [...displayRegions].map(async displayRegion => {
        const displays = await (bootPerformance?.measure(
          `multi-game-displays:${displayRegion}`,
          () => getLatestGameDisplays(displayRegion)
        ) ?? getLatestGameDisplays(displayRegion));
        gameDisplays.set(displayRegion, displays);
      })
    );
  } catch {
    // The per-game clients still have their existing fallback assets.
    log("[hyp-connect] Failed to fetch HoYoPlay game display assets");
  }

  const gameBizByRegion: Record<string, Record<HoyoPlayRegion, string>> = {
    hk4e: { CN: "hk4e_cn", OS: "hk4e_global" },
    hsr: { CN: "hkrpg_cn", OS: "hkrpg_global" },
    zzz: { CN: "nap_cn", OS: "nap_global" },
    bh3: { CN: "bh3_cn", OS: "bh3_global" },
  };

  // Initialize the channel the user last viewed first. This keeps its
  // background and install state on the critical startup path while the
  // remaining channels can be hydrated afterward by the client layer.
  const lastView = await getKeyOrDefault("hyp_last_view", "");
  const prioritizedSpecs = [...specs].sort((a, b) => {
    if (a.id === lastView) return -1;
    if (b.id === lastView) return 1;
    return 0;
  });

  const gamesById = new Map<string, HypGame>();
  let completed = 0;
  let nextIndex = 0;
  let failure: unknown;

  async function initializeGame(spec: MultiGameGameSpec) {
    const storage = createStorage(spec.namespace);
    const index = completed;
    reportBootProgress(
      "BOOT_INITIALIZING_GAME_CLIENT",
      66 + Math.round((index / Math.max(1, specs.length)) * 30)
    );
    const wineRef: MultiGameWineRef = { current: baseWine };
    const gameWine = createMultiGameWineProxy(wineRef);
    const client = await (bootPerformance?.measure(
      `game-client:${spec.id}`,
      () =>
        spec.createClient({
          wine: gameWine,
          aria2,
          locale,
          storage,
          bootPerformance,
        })
    ) ??
      spec.createClient({
        wine: gameWine,
        aria2,
        locale,
        storage,
        bootPerformance,
      }));
    const initialWineTag = await (bootPerformance?.measure(
      `game-wine-config:${spec.id}`,
      () => getMultiGameGameWineTag(spec.id)
    ) ?? getMultiGameGameWineTag(spec.id));
    const [wineTag, setWineTag] = createSignal(initialWineTag);
    const [wineEnabled, setWineEnabled] = createSignal(
      await getMultiGameGameWineEnabled(spec.id)
    );
    const [wineTaskPending, setWineTaskPending] = createSignal(false);
    const gamePrefixPath = () =>
      getMultiGamePrefix(baseWine.prefix, spec.clientId);
    const [gameWineReady, setGameWineReady] = createSignal(false);
    const [gamePrefixExists, setGamePrefixExists] = createSignal(false);
    const refreshGameWineState = async () => {
      const exists = await fileOrDirExists(gamePrefixPath());
      setGamePrefixExists(exists);
      setGameWineReady(
        exists && (await isMultiGamePrefixReady(gamePrefixPath()))
      );
    };
    void refreshGameWineState();

    let resolvingGameWine: Promise<Wine> | undefined;
    const ensureGameWineObject = async (): Promise<Wine> => {
      if (wineTag() === SHARED_WINE_TAG) return baseWine;
      if (wineRef.current.prefix === gamePrefixPath()) return wineRef.current;
      resolvingGameWine ??= (async () => {
        const program = ensureMultiGameGameWine({
          aria2,
          baseWine,
          gameId: spec.id,
          prefixId: spec.clientId,
          wineTag: wineTag(),
        });
        const iterator = program[Symbol.asyncIterator]();
        let step = await iterator.next();
        while (!step.done) step = await iterator.next();
        wineRef.current = step.value;
        return step.value;
      })().finally(() => {
        resolvingGameWine = undefined;
      });
      return resolvingGameWine;
    };
    const wineOptions = await (bootPerformance?.measure(
      `game-wine-options:${spec.id}`,
      () => getMultiGameWineOptions(initialWineTag)
    ) ?? getMultiGameWineOptions(initialWineTag));
    const displayRegion = spec.displayRegion ?? region;
    const display = gameDisplays
      .get(displayRegion)
      ?.get(spec.displayBiz ?? gameBizByRegion[spec.id]?.[displayRegion]);
    const resolvedSpec = {
      ...spec,
      serverLabel: locale.get(spec.serverLabel),
      iconImage: display?.icon.url ?? spec.iconImage,
      bannerImage: display?.thumbnail.url ?? spec.bannerImage,
      logoImage: display?.logo.url ?? spec.logoImage,
    };
    const enqueueWineTask = (fn: () => TaskProgram) => {
      const dispatch = gameWineTaskDispatcher.current;
      if (!dispatch) throw new Error("Game Wine task queue is unavailable");
      setWineTaskPending(true);
      try {
        dispatch({
          gameId: spec.id,
          downloadKey: spec.namespace,
          title: `${resolvedSpec.title} · ${locale.get("INIT_ENVIRONMENT")}`,
          fn: async function* () {
            try {
              yield* fn();
            } finally {
              setWineTaskPending(false);
            }
          },
        });
      } catch (error) {
        setWineTaskPending(false);
        throw error;
      }
    };
    const createSettings = () =>
      createGameSettings({
        locale,
        storage,
        gameInstallDir: client.installDir,
        gameVersion: client.gameVersion,
        onGameInstallDirChange: client.changeInstallDir,
        configForChannelClient: (locale, config) =>
          bootPerformance?.measure(`game-channel-config:${spec.id}`, () =>
            client.createConfig(locale, config)
          ) ?? client.createConfig(locale, config),
        wineTag,
        wineOptions,
        onWineTagChange: (tag, options) => {
          enqueueWineTask(async function* () {
            const prepared = yield* prepareMultiGameGameWine({
              aria2,
              baseWine,
              previousWine: wineRef.current,
              gameId: spec.id,
              prefixId: spec.clientId,
              wineTag: tag,
              migrate: options?.migrate ?? true,
              descriptor: spec.wineUserData,
              downloadKey: spec.namespace,
            });
            wineRef.current = prepared;
            setWineTag(tag);
            await setMultiGameGameWineTag(spec.id, tag);
            await refreshGameWineState();
          });
        },
        wineEnabled: () => wineEnabled(),
        autoWineLabel: globalWineName,
        wineDataSupported: Boolean(spec.wineUserData),
        // ZZZ uses the game's DLSS path (Game Porting Toolkit); all other
        // clients use DXMT's own swapchain MetalFX upscale.
        metalFxDxmtOnly: !spec.clientId.startsWith("nap"),
        onWineEnabledChange: (enabled, options) => {
          enqueueWineTask(async function* () {
            if (enabled) {
              if (options?.overwrite) {
                await rmrf_dangerously(gamePrefixPath());
              }
              const tag =
                wineTag() === SHARED_WINE_TAG ? AUTO_WINE_TAG : wineTag();
              const prepared = yield* prepareMultiGameGameWine({
                aria2,
                baseWine,
                previousWine: wineRef.current,
                gameId: spec.id,
                prefixId: spec.clientId,
                wineTag: tag,
                migrate: options?.migrate ?? true,
                descriptor: spec.wineUserData,
                downloadKey: spec.namespace,
              });
              await setMultiGameGameWineEnabled(spec.id, true);
              await setMultiGameGameWineTag(spec.id, tag);
              wineRef.current = prepared;
              setWineTag(tag);
              setWineEnabled(true);
            } else {
              const prepared = yield* prepareMultiGameGameWine({
                aria2,
                baseWine,
                previousWine: wineRef.current,
                gameId: spec.id,
                prefixId: spec.clientId,
                wineTag: SHARED_WINE_TAG,
                migrate: options?.migrate ?? true,
                descriptor: spec.wineUserData,
                downloadKey: spec.namespace,
              });
              await setMultiGameGameWineEnabled(spec.id, false);
              wineRef.current = prepared;
              setWineTag(SHARED_WINE_TAG);
              setWineEnabled(false);
            }
            await refreshGameWineState();
          });
        },
        onOpenWineCmd: async () => {
          const wine = await ensureGameWineObject();
          await wine.openCmdWindow({ gameDir: gamePrefixPath() });
        },
        onOpenWineCfg: async () => {
          const wine = await ensureGameWineObject();
          await wine.exec2("winecfg", [], {}, "/dev/null");
        },
        winePrefix: () => gamePrefixPath(),
        wineInstalled: () => gameWineReady(),
        wineSavePending: wineTaskPending,
        wineActionDisabled: () => actionDisabledRef.current(),
        onResetWineEnv: async () => {
          const wine = await ensureGameWineObject().catch(
            () => wineRef.current
          );
          await wine.killAll();
          await wine.waitForWineServerExit({ timeoutMs: 5_000 });
          await rmrf_dangerously(gamePrefixPath());
          setGameWineReady(false);
          setGamePrefixExists(false);
        },
        gameWinePrefixExists: () => gamePrefixExists(),
        onRemoveGameWinePrefix: async () => {
          if (await getMultiGameGameWineEnabled(spec.id)) {
            throw new Error(
              "Cannot remove a Wine prefix while the separate Wine environment is enabled"
            );
          }
          await rmrf_dangerously(gamePrefixPath());
          setGameWineReady(false);
          setGamePrefixExists(false);
        },
      });
    const { UI: ConfigurationUI, config } = await (bootPerformance?.measure(
      `game-settings:${spec.id}`,
      createSettings
    ) ?? createSettings());

    gamesById.set(spec.id, {
      ...resolvedSpec,
      storage,
      client,
      config: config as Config,
      ConfigurationUI,
      wineRef,
      wineTag,
      setWineTag,
      wineOptions,
    });
    completed++;
  }

  async function worker() {
    while (failure === undefined) {
      const spec = prioritizedSpecs[nextIndex++];
      if (!spec) return;
      try {
        await initializeGame(spec);
      } catch (error) {
        const detail =
          error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
            : String(error);
        await log(
          `[multi-game] Initialization failed for ${spec.id}: ${detail}`
        );
        failure = error;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(4, prioritizedSpecs.length) }, () => worker())
  );
  if (failure !== undefined) throw failure;
  // Keep the library order stable; only the initialization order is changed.
  games.push(
    ...specs
      .map(spec => gamesById.get(spec.id))
      .filter((game): game is HypGame => !!game)
  );

  reportBootProgress("BOOT_INITIALIZING_GAME_CLIENT", 96);
  return createHypLauncher({
    games,
    showLibrary: true,
    wine,
    wineDistroId,
    wineInstalled,
    locale,
    aria2,
    onCheckUpdate,
    onGameRunningChange,
    gameCloseHandler,
    onResetWineEnv,
    initializeWine,
    downloadWineDistro,
    enableWineDistro,
    uninstallWineDistro,
    actionDisabledRef,
    gameWineTaskDispatcher,
  });
}

export type { MultiGameGameSpec } from "../data/multi-game-spec";
