import { createGlobalSettings } from "@settings";
import { Locale } from "@locale";
import {
  activateStorageNamespace,
  exec2,
  fatal,
  getActiveStorageNamespace,
  getKeyOrDefault,
  setKey,
  withStorageNamespace,
} from "@runtime";
import { log } from "@logging/logger";
import { openDir } from "@platform/neutralino";
import { getWineDistributions, type Wine, type WineDistribution } from "@wine";
import { SHARED_WINE_TAG } from "@wine/multi-game";
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
} from "@hope-ui/solid";
import {
  batch,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { JSX } from "solid-js";
import { createGameInstallationDirectorySanitizer } from "@services/game-installation";
import { createGameUninstallDialog } from "../../modals/game-uninstall-modal";
import { GAME_BANNER_URLS } from "../data/game-assets";
import {
  parseBackgroundPersistedState,
  resolveInitialIndex,
} from "../model/background-switcher";
import { GameIcon } from "../components/game-icon";
import { GameLibraryView, GameLibraryItem } from "../views/game-library";
import { MhyClientView } from "../views/clients/mhy";
import { GlobalModals } from "../../modals/global-modal-host";
import type { GlobalModalRoute } from "../../modals/global-modal-host";
import { getThemeColorHex, getContrastText } from "@settings/theme/color";
import { createConcurrentTaskQueueState, GLOBAL_TASK_KEY } from "./task-queue";
import { createLogViewer } from "../../modals/log-viewer-modal";
import {
  cancelControlledDownload,
  DownloadControlState,
  getDownloadControlState,
  pauseControlledDownload,
  resumeControlledDownload,
  subscribeDownloadControl,
} from "@download/control";
import { reloadConfig, setGlobalTaskActive } from "@download/stream-scheduler";
import {
  getDownloadTaskCount,
  subscribeDownloadTasks,
} from "@download/task-registry";
import { DownloadQueueModal } from "../../modals/download-queue-modal";
import { GameUpdatePromptModal } from "../../modals/game-update-prompt-modal";
import { getProgressPanelVisibility } from "../model/progress-panel-visibility";
import {
  clearGameInstallationState,
  createGameLaunchProgram,
  gameDownloadTaskMetadata,
  gameProgram,
} from "./hyp-controller";
import {
  resolveIntegrityAction,
  resolvePrimaryLauncherAction,
} from "./action-policy";
import type { HypGame, HypLauncherOptions } from "./launcher-types";

export type {
  HypGame,
  HypGameWineOption,
  HypLauncherOptions,
} from "./launcher-types";

const BG_STORAGE_KEY = "hyp_bg";
const BG_TRANSITION_MS = 600;
const LIBRARY_TRANSITION_MS = 360;

type ProgressPanelData = {
  title: string;
  file?: string;
  speed?: string;
  downloaded?: string;
  total?: string;
  percent?: string;
  progress?: number;
  progressMode?: "determinate" | "indeterminate";
  fileIndex?: string;
  fileCount?: string;
  showFileRow: boolean;
  showFileIndex: boolean;
  showDownloadedRow: boolean;
  showSpeedRow: boolean;
  canCancel: boolean;
  cancelDisabled: boolean;
  namespace?: string;
};

function ProgressPanel({
  panel,
  locale,
}: {
  panel: () => ProgressPanelData | null;
  locale: Locale;
}) {
  // Show guarantees this panel is only mounted while the memo is non-null;
  // reading through a memo keeps every update in place (no DOM recreation).
  const current = createMemo(() => panel()!);
  const progressPercent = createMemo(() =>
    Math.round(Math.min(100, Math.max(0, current().progress ?? 0)))
  );
  return (
    <div class="hyp-progress-div">
      <div class="hyp-download-header">
        <span class="hyp-download-title" title={current().title}>
          {current().title}
        </span>
        <Show when={current().canCancel}>
          <button
            class="hyp-download-cancel"
            aria-label={locale.get("CANCEL_DOWNLOAD")}
            data-tooltip={locale.get("CANCEL_DOWNLOAD")}
            disabled={current().cancelDisabled}
            onClick={() => {
              void cancelControlledDownload(current().namespace).catch(fatal);
            }}
          >
            <span class="hyp-download-cancel-icon" aria-hidden="true" />
            <span class="hyp-download-cancel-label">
              {locale.get("SETTING_CANCEL")}
            </span>
          </button>
        </Show>
      </div>
      <Show when={current().progressMode !== undefined}>
        <div
          class="hyp-download-progress"
          role="progressbar"
          aria-label={current().title}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={
            current().progressMode === "determinate"
              ? progressPercent()
              : undefined
          }
        >
          <div
            classList={{
              "hyp-download-progress-fill": true,
              indeterminate: current().progressMode === "indeterminate",
            }}
            style={{
              width:
                current().progressMode === "determinate"
                  ? `${progressPercent()}%`
                  : undefined,
            }}
          />
        </div>
      </Show>
      <div class="hyp-download-rows">
        <Show when={current().showFileRow}>
          <div class="hyp-download-row">
            <span class="hyp-download-label">
              {locale.get("DOWNLOAD_FILE")}
            </span>
            <span class="hyp-download-value" title={current().file}>
              {current().file}
            </span>
          </div>
        </Show>
        <Show when={current().showFileIndex}>
          <div class="hyp-download-row">
            <span class="hyp-download-label">
              {locale.get("DOWNLOAD_FILE_INDEX")}
            </span>
            <span class="hyp-download-value">
              {current().fileIndex}/{current().fileCount}
            </span>
          </div>
        </Show>
        <Show when={current().showDownloadedRow}>
          <div class="hyp-download-row">
            <span class="hyp-download-label">{locale.get("DOWNLOADED")}</span>
            <span class="hyp-download-value">
              {current().downloaded}/{current().total}
            </span>
          </div>
        </Show>
        <Show when={current().showSpeedRow}>
          <div class="hyp-download-row">
            <span class="hyp-download-label">
              {locale.get("DOWNLOAD_SPEED")}
            </span>
            <span class="hyp-download-value">{current().speed}</span>
          </div>
        </Show>
      </div>
    </div>
  );
}

export async function createHypLauncher({
  games,
  showLibrary,
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
  enableWineDistro,
  uninstallWineDistro,
  actionDisabledRef,
}: HypLauncherOptions) {
  const baseWine = wine;
  const wineDistros = await getWineDistributions();
  const initialWineDistro =
    wineDistros.find(distro => distro.id == wineDistroId) ?? wineDistros[0];

  let requestWineDistroEnable = (
    _distro: WineDistribution,
    _onDone: (distro: WineDistribution) => void
  ): void => undefined;
  let requestWineDistroUninstall = (
    _distro: WineDistribution,
    _onDone: (distro: WineDistribution) => void
  ): void => undefined;
  let notifyWineDistroInitialized = (_distro: WineDistribution): void =>
    undefined;
  let _actionDisabled = () => false;

  const anyInstalled = games.some(
    game => game.client.installState() === "INSTALLED"
  );
  const firstInstalledIndex = games.findIndex(
    game => game.client.installState() === "INSTALLED"
  );
  const lastView = showLibrary
    ? await getKeyOrDefault("hyp_last_view", "")
    : "";
  let initialSelectedGameIndex =
    showLibrary && firstInstalledIndex >= 0 ? firstInstalledIndex : 0;
  if (showLibrary && anyInstalled && lastView && lastView !== "library") {
    const persistedIndex = games.findIndex(
      game => game.id === lastView && game.client.installState() === "INSTALLED"
    );
    if (persistedIndex >= 0) {
      initialSelectedGameIndex = persistedIndex;
    }
  }
  const [selectedGameIndex, setSelectedGameIndex] = createSignal(
    initialSelectedGameIndex
  );

  // Global (launcher-wide) settings: General / Wine / Licenses. Wine
  // environment install/uninstall/reset and launcher-level preferences live
  // here and are shared by every game.
  const { UI: GlobalConfigurationUI, disableVideoBackground } =
    await createGlobalSettings({
      wine: baseWine,
      wineDistroId,
      wineInstalled,
      locale,
      actionDisabled: () => _actionDisabled(),
      onEnableWineDistro: (distro, onDone) =>
        requestWineDistroEnable(distro, onDone),
      onUninstallWineDistro: (distro, onDone) =>
        requestWineDistroUninstall(distro, onDone),
      onWineDistroInitialized: onDone => {
        notifyWineDistroInitialized = onDone;
      },
      onResetWineEnv,
      modalTitle: () => locale.get("SETTING_GLOBAL"),
    });

  const { selectPath } = await createGameInstallationDirectorySanitizer({
    openFolderDialog: async () =>
      await openDir(locale.get("SELECT_INSTALLATION_DIR")),
    locale,
  });

  // Debug mode: when enabled (game settings -> Launch -> Debug mode),
  // launching a game opens its configured runtime/error log file. The
  // preference lives in the global `config_debug_mode` key and is read fresh
  // at every launch.
  let stopGameLogOpen: (() => void) | undefined;
  // The log viewer still handles manual launcher-log viewing. Debug-mode file
  // opening runs outside the component and does not populate that viewer.
  let openGameLogs: (() => void) | undefined;

  const { UI: GameUninstallDialog, open: openGameUninstallDialog } =
    await createGameUninstallDialog({
      locale,
      gameInstallDir: () =>
        games[selectedGameIndex()]?.client.installDir() ?? "",
      onUninstall: async () => {
        const game = games[selectedGameIndex()];
        if (!game) return;
        await clearGameInstallationState(game);
      },
      actionDisabled: () => _actionDisabled(),
    });

  const initialThemeHex = await getThemeColorHex();
  const [themeHex, setThemeHex] = createSignal(initialThemeHex);
  const themeText = () => getContrastText(themeHex());
  async function refreshThemeColor() {
    setThemeHex(await getThemeColorHex());
  }

  // Load the persisted background selection per game. If the fetched
  // background set changed (ids no longer match), reset to the first one.
  const initialBgIndex: Record<string, number> = {};
  for (const game of games) {
    const currentIds = (game.client.uiContent.backgrounds ?? [])
      .map(bg => bg.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const readStored = () => getKeyOrDefault(BG_STORAGE_KEY, "");
    const raw = game.namespace
      ? await withStorageNamespace(game.namespace, readStored)
      : await readStored();
    const stored = parseBackgroundPersistedState(raw);
    const index = resolveInitialIndex(stored, currentIds);
    initialBgIndex[game.id] = index;
    const storedIdsMatch =
      stored !== null &&
      stored.ids.length === currentIds.length &&
      stored.ids.every((id, i) => id === currentIds[i]);
    if (
      currentIds.length > 0 &&
      (!stored || stored.index !== index || !storedIdsMatch)
    ) {
      const value = JSON.stringify({ ids: currentIds, index });
      const writeStored = () => setKey(BG_STORAGE_KEY, value);
      if (game.namespace)
        await withStorageNamespace(game.namespace, writeStored);
      else await writeStored();
    }
  }

  return function HypLauncher() {
    const selectedGame = () => games[selectedGameIndex()];
    onCleanup(() => {
      stopGameLogOpen?.();
      stopGameLogOpen = undefined;
      openGameLogs = undefined;
    });
    const initialLibraryOpen =
      showLibrary && (!anyInstalled || lastView === "library");
    const [libraryOpen, setLibraryOpen] = createSignal(initialLibraryOpen);
    const [libraryMounted, setLibraryMounted] =
      createSignal(initialLibraryOpen);
    const [libraryClosing, setLibraryClosing] = createSignal(false);
    let libraryCloseTimer: ReturnType<typeof setTimeout> | undefined;

    onCleanup(() => {
      if (libraryCloseTimer) clearTimeout(libraryCloseTimer);
    });

    function openLibrary() {
      if (libraryCloseTimer) {
        clearTimeout(libraryCloseTimer);
        libraryCloseTimer = undefined;
      }
      setLibraryClosing(false);
      setLibraryMounted(true);
      setLibraryOpen(true);
    }

    function closeLibrary() {
      if (!libraryOpen() && !libraryMounted()) return;
      if (libraryCloseTimer) clearTimeout(libraryCloseTimer);
      setLibraryOpen(false);
      setLibraryClosing(true);
      setLibraryMounted(true);
      libraryCloseTimer = setTimeout(() => {
        libraryCloseTimer = undefined;
        setLibraryMounted(false);
        setLibraryClosing(false);
      }, LIBRARY_TRANSITION_MS);
    }

    function toggleLibrary() {
      if (libraryOpen()) closeLibrary();
      else openLibrary();
    }

    const libraryItems = () =>
      games.map(
        game =>
          ({
            id: game.id,
            title: game.title,
            iconUrl:
              game.iconImage ||
              game.client.uiContent.iconImage ||
              game.fallbackIcon,
            bannerUrl: game.bannerImage ?? GAME_BANNER_URLS[game.id] ?? "",
            serverLabel: game.serverLabel,
            installed: game.client.installState() === "INSTALLED",
            channel: game.id,
            channelName:
              game.client.uiContent.channelName || game.id.toUpperCase(),
          } satisfies GameLibraryItem)
      );
    const [nativeSettingsGame, setNativeSettingsGame] = createSignal<HypGame>();
    const [nativeSettingsOpen, setNativeSettingsOpen] = createSignal(false);
    let nativeSettingsCloseTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => {
      if (nativeSettingsCloseTimer) clearTimeout(nativeSettingsCloseTimer);
    });

    // Download manager: rail button badge keeps the active download count in
    // sync with the shared queue, and persisted speed-limit / concurrency
    // settings are applied at startup.
    const [downloadModalOpen, setDownloadModalOpen] = createSignal(false);
    const [activeDownloadCount, setActiveDownloadCount] = createSignal(
      getDownloadTaskCount()
    );
    onCleanup(
      subscribeDownloadTasks(() => {
        setActiveDownloadCount(getDownloadTaskCount());
      })
    );
    void reloadConfig();
    const [globalModalRoute, setGlobalModalRoute] =
      createSignal<GlobalModalRoute | null>(null);
    const aboutChannelCode = () => {
      const game = selectedGame();
      if (game.namespace?.startsWith("hpcn")) return "CN";
      if (game.namespace) return "OS";
      const id = game.id.toLowerCase();
      if (id.endsWith("cn")) return "CN";
      if (id.includes("universal")) return "Uni";
      return "OS";
    };
    const [updatePromptGame, setUpdatePromptGame] = createSignal<HypGame>();
    const [videoLoaded, setVideoLoaded] = createSignal(false);
    const [bgIndex, setBgIndex] =
      createSignal<Record<string, number>>(initialBgIndex);
    const [bgTransition, setBgTransition] = createSignal<{
      gameId: string;
      to: number;
    } | null>(null);
    let baseVideoRef: HTMLVideoElement | undefined;
    let bgTransitionTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => {
      if (bgTransitionTimer) clearTimeout(bgTransitionTimer);
    });
    const currentBackgrounds = () =>
      selectedGame().client.uiContent.backgrounds ?? [];
    const currentBgIndex = () => {
      const list = currentBackgrounds();
      if (list.length === 0) return 0;
      return Math.min(bgIndex()[selectedGame().id] ?? 0, list.length - 1);
    };
    const currentBg = () => currentBackgrounds()[currentBgIndex()];
    const currentBgImage = () =>
      currentBg()?.background ?? selectedGame().client.uiContent.background;
    const currentBgVideo = () => {
      if (disableVideoBackground()) return undefined;
      return (
        currentBg()?.background_video ??
        selectedGame().client.uiContent.background_video
      );
    };
    const currentBgTheme = () =>
      currentBg()?.background_theme ??
      selectedGame().client.uiContent.background_theme;
    const transitionTarget = () => {
      const t = bgTransition();
      if (!t || t.gameId !== selectedGame().id) return undefined;
      return currentBackgrounds()[t.to];
    };
    async function persistBgIndex(game: HypGame, index: number) {
      const ids = (game.client.uiContent.backgrounds ?? [])
        .map(bg => bg.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ids.length === 0) return;
      const value = JSON.stringify({ ids, index });
      const write = () => setKey(BG_STORAGE_KEY, value);
      if (game.namespace) await withStorageNamespace(game.namespace, write);
      else await write();
    }
    function switchBackground(game: HypGame, to: number) {
      const list = game.client.uiContent.backgrounds ?? [];
      if (list.length <= 1) return;
      if (to === currentBgIndex()) return;
      if (bgTransition()?.gameId === game.id && bgTransition()?.to === to)
        return;
      if (bgTransitionTimer) clearTimeout(bgTransitionTimer);
      setVideoLoaded(false);
      baseVideoRef?.pause();
      setBgTransition({ gameId: game.id, to });
      bgTransitionTimer = setTimeout(() => {
        bgTransitionTimer = undefined;
        batch(() => {
          setBgIndex(prev => ({ ...prev, [game.id]: to }));
          setBgTransition(null);
        });
        void baseVideoRef?.play().catch(() => undefined);
        void persistBgIndex(game, to);
      }, BG_TRANSITION_MS);
    }
    const [gameRunningByKey, setGameRunningByKey] = createSignal<
      Record<string, boolean>
    >({});
    const [gameLifecycleActiveByKey, setGameLifecycleActiveByKey] =
      createSignal<Record<string, boolean>>({});
    let restoreNativeSettingsNamespace: (() => void) | undefined;
    const taskQueue = createConcurrentTaskQueueState({
      locale,
      onStateKey: (key, stateKey) => {
        if (key === GLOBAL_TASK_KEY) return;
        const lifecycleActive =
          stateKey == "GAME_RUNNING" || stateKey == "REVERT_PATCHING";
        const processRunning = stateKey == "GAME_RUNNING";
        const processPrev = gameRunningByKey();
        const lifecyclePrev = gameLifecycleActiveByKey();
        if (processPrev[key] !== processRunning) {
          setGameRunningByKey({
            ...processPrev,
            [key]: processRunning,
          });
        }
        if (lifecyclePrev[key] !== lifecycleActive) {
          const next = {
            ...lifecyclePrev,
            [key]: lifecycleActive,
          };
          setGameLifecycleActiveByKey(next);
          onGameRunningChange?.(Object.values(next).some(Boolean));
        }
      },
    });

    if (gameCloseHandler) {
      gameCloseHandler.current = async () => {
        const lifecycleKeys = Object.entries(gameLifecycleActiveByKey())
          .filter(([, active]) => active)
          .map(([key]) => key);
        const processKeys = Object.entries(gameRunningByKey())
          .filter(([, running]) => running)
          .map(([key]) => key);
        const winesToStop = new Set<Wine>();
        for (const key of processKeys) {
          const game = games.find(candidate => candidate.id === key);
          if (game) winesToStop.add(game.wineRef?.current ?? baseWine);
        }
        await Promise.all(
          [...winesToStop].map(wineToStop => wineToStop.killAll())
        );
        await Promise.all(lifecycleKeys.map(key => taskQueue.waitForIdle(key)));
      };
    }
    const selectedGameTaskState = createMemo(() =>
      taskQueue.getState(selectedGame().id)
    );
    // Prefer the selected game's task, but fall back to the launcher-wide
    // (global) task so downloads like the Wine environment still surface
    // their progress in the action area.
    const activeTaskState = createMemo(() => {
      const gameState = taskQueue.getState(selectedGame().id);
      if (gameState.busy()) return gameState;
      return taskQueue.getState(GLOBAL_TASK_KEY);
    });
    // Download-status args for the progress panel. Both the selected game's
    // task state and the launcher-global state are read unconditionally so the
    // panel updates the moment a download progress message arrives, instead of
    // waiting for the active-task memo to flip state objects.
    // Reactive snapshot of the unified progress panel. All signals are read
    // here (inside a memo) rather than in the Show child, which SolidJS runs
    // inside untrack and therefore never re-runs while the download is in
    // progress. Reading them here lets the panel update as progress arrives.
    const downloadControlKey = (game: HypGame) => game.namespace ?? "";
    const [downloadControlByKey, setDownloadControlByKey] = createSignal<
      Record<string, DownloadControlState>
    >(
      Object.fromEntries(
        games.map(game => [
          downloadControlKey(game),
          getDownloadControlState(game.namespace),
        ])
      )
    );
    games.forEach(game => {
      onCleanup(
        subscribeDownloadControl(
          state =>
            setDownloadControlByKey(prev => ({
              ...prev,
              [downloadControlKey(game)]: state,
            })),
          game.namespace
        )
      );
    });
    const [globalDownloadControl, setGlobalDownloadControl] =
      createSignal<DownloadControlState>(getDownloadControlState());
    onCleanup(
      subscribeDownloadControl(state => setGlobalDownloadControl(state))
    );
    // Downloads always run inside a per-game task, so `busy()` is enough to
    // keep a not-yet-installed game visible. Reading `downloadControlByKey`
    // here instead would re-create the sidebar list on every aria2 poll tick.
    const sidebarGames = () =>
      showLibrary
        ? games
            .map((game, index) => ({ game, index }))
            .filter(
              ({ game }) =>
                game.client.installState() === "INSTALLED" ||
                taskQueue.getState(game.id).busy()
            )
        : games.map((game, index) => ({ game, index }));
    const selectedDownloadControl = () => {
      const key = downloadControlKey(selectedGame());
      return (
        downloadControlByKey()[key] ??
        getDownloadControlState(selectedGame().namespace)
      );
    };
    const anyGameRunning = () =>
      Object.values(gameRunningByKey()).some(Boolean);
    const selectedGameRunning = () =>
      Boolean(gameRunningByKey()[selectedGame().id]);
    // Kill every Wine process attached to the selected game's prefix. For
    // multi-game channels each game runs in its own per-game Wine, so we
    // target that prefix; single-game channels use the launcher-wide Wine.
    // The launch task is blocked on the game process, so once the prefix is
    // torn down it resumes, reverts patches, and the running state clears.
    async function forceQuitSelectedGame() {
      const game = selectedGame();
      try {
        await log(`Force quit requested: ${game.id}`);
        const target = game.wineRef ? game.wineRef.current : wine;
        await target.killAll();
        await log(`Force quit complete: ${game.id}`);
      } catch (e) {
        await log(`Force quit failed for ${game.id}: ${String(e)}`);
      }
    }
    const { LogViewer, openLogs } = createLogViewer(locale);
    openGameLogs = openLogs;
    function actionDisabled() {
      // A launcher-global task (e.g. Wine environment init) takes priority:
      // while it runs, the primary button stays disabled even if a per-game
      // download was paused by the priority mechanism.
      if (taskQueue.getState(GLOBAL_TASK_KEY).busy()) return true;
      const download = selectedDownloadControl();
      if (download.active) {
        if (download.actionPending) return true;
        if (download.pauseRequested || download.paused) {
          return !download.canResume;
        }
        // The pre-download integrity scan doesn't transfer any data yet, so
        // pausing it is meaningless; keep the pause button disabled until the
        // actual download phase begins.
        if (selectedGameTaskState().statusArgs()?.key === "SCANNING_FILES") {
          return true;
        }
        return !download.canPause;
      }
      return selectedGameTaskState().busy() || anyGameRunning();
    }

    if (actionDisabledRef) {
      actionDisabledRef.current = actionDisabled;
    }
    _actionDisabled = actionDisabled;

    // Reactive snapshot of the selected game's progress panel. Reads the
    // selected game's task signals directly (the global task now has its own
    // dedicated panel) so the panel updates as progress arrives.
    const activeProgressPanel = createMemo<ProgressPanelData | null>(() => {
      const taskState = taskQueue.getState(selectedGame().id);
      const download = selectedDownloadControl();
      if (selectedGameRunning() || (!taskState.busy() && !download.active)) {
        return null;
      }
      const args = taskState.statusArgs();
      const taskStatusText = taskState.statusText();
      // A task is not ready to render a progress panel until it has emitted
      // an actual status. INSTALL_DONE is a terminal marker, not a progress
      // state, so it must not create a transient title-only panel.
      if (args?.key === "INSTALL_DONE" || (!args && !taskStatusText)) {
        return null;
      }
      const isEnvSpeed = args?.key === "DOWNLOADING_ENVIRONMENT_SPEED";
      const isDownloadStatus =
        args?.key === "DOWNLOADING_FILE_PROGRESS" || isEnvSpeed;
      const isEnvironmentDownload =
        args?.key === "DOWNLOADING_ENVIRONMENT" || isEnvSpeed;
      const isEnvironmentExtract =
        args?.key === "EXTRACT_ENVIRONMENT" ||
        args?.key === "DECOMPRESS_FILE_PROGRESS";
      const isEnvironmentConfiguring = args?.key === "CONFIGURING_ENVIRONMENT";
      const isWineDownload =
        isEnvironmentDownload &&
        selectedGame().wineTag?.() !== undefined &&
        selectedGame().wineTag?.() !== SHARED_WINE_TAG;
      const isGameRunning = args?.key === "GAME_RUNNING";
      const isLaunchPhase = taskStatusText.startsWith("启动阶段");
      const isRestorePhase =
        args?.key === "REVERT_PATCHING" ||
        taskStatusText.startsWith("还原阶段");
      // The pre-download integrity scan reports a file counter instead of a
      // transfer; render it as the same "file progress" row as downloads,
      // with a fixed title (the per-file "scanning file N of M" detail lives
      // in the small text row below, not in the title).
      const isScanning = args?.key === "SCANNING_FILES";
      const title = isScanning
        ? locale.get("CHECKING_GAME_INTEGRITY")
        : isDownloadStatus
        ? isEnvSpeed
          ? locale.get("DOWNLOADING_ENVIRONMENT")
          : locale.get("DOWNLOAD_PROGRESS")
        : taskStatusText;
      const downloadArgs = isDownloadStatus || isScanning ? args : null;
      const [file, speed, downloaded, total, percent, fileIndex, fileCount] =
        downloadArgs
          ? isEnvSpeed
            ? [
                undefined,
                downloadArgs.args[0],
                downloadArgs.args[1],
                downloadArgs.args[2],
                downloadArgs.args[3],
                downloadArgs.args[4],
                downloadArgs.args[5],
              ]
            : isScanning
            ? [
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                downloadArgs.args[0],
                downloadArgs.args[1],
              ]
            : downloadArgs.args
          : [];
      const progressMode: ProgressPanelData["progressMode"] =
        isEnvironmentExtract || isEnvironmentConfiguring
          ? "indeterminate"
          : isEnvironmentDownload
          ? isWineDownload
            ? "determinate"
            : "indeterminate"
          : isGameRunning
          ? "indeterminate"
          : isLaunchPhase || isRestorePhase || taskState.progress() > 0
          ? "determinate"
          : undefined;
      return {
        title,
        file,
        speed,
        downloaded,
        total,
        percent,
        progress: taskState.progress(),
        progressMode,
        fileIndex,
        fileCount,
        ...getProgressPanelVisibility({
          isDownloadStatus,
          file,
          speed,
          downloaded,
          total,
          fileIndex,
          fileCount,
        }),
        canCancel: download.active && download.canCancel,
        cancelDisabled: download.actionPending,
        namespace: selectedGame().namespace,
      };
    });
    // Dedicated panel for launcher-global tasks (e.g. Wine environment init).
    // Always rendered on top while the global task runs, regardless of which
    // game page is active.
    const globalProgressPanel = createMemo<ProgressPanelData | null>(() => {
      const globalState = taskQueue.getState(GLOBAL_TASK_KEY);
      const download = globalDownloadControl();
      if (!globalState.busy() && !download.active) return null;
      const args = globalState.statusArgs();
      const taskStatusText = globalState.statusText();
      // Do not show the fallback Processing… panel before the task emits a
      // status, and do not show the terminal INSTALL_DONE marker as a panel.
      if (args?.key === "INSTALL_DONE" || (!args && !taskStatusText)) {
        return null;
      }
      const isEnvSpeed = args?.key === "DOWNLOADING_ENVIRONMENT_SPEED";
      const isDownloadStatus =
        args?.key === "DOWNLOADING_FILE_PROGRESS" || isEnvSpeed;
      const isEnvironmentDownload =
        args?.key === "DOWNLOADING_ENVIRONMENT" || isEnvSpeed;
      const isEnvironmentExtract =
        args?.key === "EXTRACT_ENVIRONMENT" ||
        args?.key === "DECOMPRESS_FILE_PROGRESS";
      const isEnvironmentConfiguring = args?.key === "CONFIGURING_ENVIRONMENT";
      const title = isDownloadStatus
        ? isEnvSpeed
          ? locale.get("DOWNLOADING_ENVIRONMENT")
          : locale.get("DOWNLOAD_PROGRESS")
        : taskStatusText;
      const downloadArgs = isDownloadStatus ? args : null;
      const [file, speed, downloaded, total, percent, fileIndex, fileCount] =
        downloadArgs
          ? isEnvSpeed
            ? [
                undefined,
                downloadArgs.args[0],
                downloadArgs.args[1],
                downloadArgs.args[2],
                downloadArgs.args[3],
                downloadArgs.args[4],
                downloadArgs.args[5],
              ]
            : downloadArgs.args
          : [];
      const progressMode: ProgressPanelData["progressMode"] =
        isEnvironmentExtract || isEnvironmentConfiguring
          ? "indeterminate"
          : isEnvironmentDownload
          ? "determinate"
          : undefined;
      return {
        title,
        file,
        speed,
        downloaded,
        total,
        percent,
        progress: globalState.progress(),
        // The global task is used for installing the launcher's Wine
        // environment, so show its real download progress instead of the
        // indeterminate environment-file marquee.
        progressMode,
        fileIndex,
        fileCount,
        ...getProgressPanelVisibility({
          isDownloadStatus,
          file,
          speed,
          downloaded,
          total,
          fileIndex,
          fileCount,
        }),
        canCancel: download.active && download.canCancel,
        cancelDisabled: download.actionPending,
      };
    });
    // The queue manager owns global-task priority so it can distinguish
    // scheduler-queued streams from downloads the user paused explicitly.
    createEffect(() => {
      const globalBusy = taskQueue.getState(GLOBAL_TASK_KEY).busy();
      setGlobalTaskActive(globalBusy);
    });
    requestWineDistroEnable = (distro, onDone) => {
      if (actionDisabled()) return;
      closeNativeSettings();
      setGlobalModalRoute(null);
      log(`Wine environment enable requested: ${distro.id}`);
      taskQueue.enqueue({
        fn: async function* () {
          yield* enableWineDistro(distro);
          onDone(distro);
        },
        name: "SETTING_WINE_ENABLED",
      });
    };
    requestWineDistroUninstall = (distro, onDone) => {
      if (actionDisabled()) return;
      closeNativeSettings();
      setGlobalModalRoute(null);
      log(`Wine environment uninstall requested: ${distro.id}`);
      taskQueue.enqueue({
        fn: async function* () {
          yield* uninstallWineDistro(distro);
          onDone(distro);
        },
        name: "SETTING_WINE_UNINSTALLED",
      });
    };

    if (wineInstalled()) {
      games.forEach(game => {
        if (game.client.updateRequired()) return;
        taskQueue.enqueue({
          key: game.id,
          fn: gameProgram(aria2, baseWine, game, () =>
            game.client.init(game.config)
          ),
        });
      });
    }

    function startInitializeWine() {
      log(`Initialize Wine environment requested: ${initialWineDistro.id}`);
      closeNativeSettings();
      setGlobalModalRoute(null);
      taskQueue.enqueue({
        fn: async function* () {
          yield* initializeWine(initialWineDistro);
          notifyWineDistroInitialized(initialWineDistro);
          // Re-read runtime-component state (e.g. DXMT) now that the Wine
          // environment is installed, so the primary button reflects reality.
          for (const game of games) {
            await game.client.refreshRuntimeReady();
          }
        },
        name: "INIT_ENVIRONMENT",
      });
    }

    async function onPrimaryAction() {
      const download = selectedDownloadControl();
      const game = selectedGame();
      const action = resolvePrimaryLauncherAction({
        download,
        gameTaskBusy: selectedGameTaskState().busy(),
        wineInstalled: wineInstalled(),
        installState: game.client.installState(),
        updateRequired: game.client.updateRequired(),
        runtimeReady: game.client.runtimeReady(),
      });
      switch (action) {
        case "none":
          return;
        case "resume-download":
          await resumeControlledDownload(game.namespace);
          return;
        case "pause-download":
          await pauseControlledDownload(game.namespace);
          return;
        case "initialize-wine":
          startInitializeWine();
          return;
        case "continue-install":
          await log("Runtime installation requested");
          taskQueue.enqueue({
            key: game.id,
            fn: gameProgram(aria2, baseWine, game, () =>
              game.client.continueInstall()
            ),
            name: "INSTALL",
            downloadTask: gameDownloadTaskMetadata(game, locale, "release"),
          });
          return;
        case "update":
          await log("Game update requested");
          taskQueue.enqueue({
            key: game.id,
            fn: gameProgram(aria2, baseWine, game, () => game.client.update()),
            name: "UPDATE",
            downloadTask: gameDownloadTaskMetadata(game, locale, "release"),
          });
          return;
        case "launch":
          await startGameLaunch(game);
          return;
        case "install": {
          const selection = await selectPath();
          if (!selection) return;
          await log(`Game installation requested: ${selection}`);
          taskQueue.enqueue({
            key: game.id,
            fn: gameProgram(aria2, baseWine, game, () =>
              game.client.install(selection)
            ),
            name: "INSTALL",
            downloadTask: gameDownloadTaskMetadata(game, locale, "release"),
          });
          return;
        }
      }
    }

    function actionLabel(game: HypGame) {
      if (game.client.installState() !== "INSTALLED")
        return locale.get("INSTALL");
      if (!game.client.runtimeReady()) return locale.get("CONTINUE_INSTALL");
      if (!game.client.updateRequired()) return locale.get("LAUNCH");
      return locale.get("UPDATE");
    }

    function displayGameVersion(game: HypGame) {
      const version = game.client.gameVersion?.() ?? "0.0.0";
      return version == "0.0.0"
        ? locale.get("SETTING_GAME_VERSION_NOT_INSTALLED")
        : version;
    }

    function startCheckIntegrity(game: HypGame) {
      // Before checking integrity, check for game updates automatically. If a
      // new version is available, ask the user whether to install it first.
      if (
        resolveIntegrityAction(game.client.updateRequired()) === "prompt-update"
      ) {
        setUpdatePromptGame(game);
      } else {
        taskQueue.enqueue({
          key: game.id,
          fn: gameProgram(aria2, baseWine, game, () =>
            game.client.checkIntegrity()
          ),
          name: "SETTING_CHECK_INTEGRITY",
          // Integrity verification itself is not a download task. Keeping it
          // out of the explicit download-task registry also prevents any
          // incidental Wine/runtime stream from being mislabeled as a game
          // download. Actual repair streams are still materialized by the
          // download registry when they start.
        });
      }
    }

    async function startGameLaunch(game: HypGame) {
      await log(`Game launch requested: ${game.id}`);
      taskQueue.enqueue({
        key: game.id,
        fn: gameProgram(aria2, baseWine, game, () =>
          createGameLaunchProgram({
            game,
            baseWine,
            getStopGameLogOpen: () => stopGameLogOpen,
            setStopGameLogOpen: stop => {
              stopGameLogOpen = stop;
            },
          })
        ),
        name: "LAUNCH",
      });
    }

    function primaryButtonLabel() {
      if (selectedGameRunning()) {
        return locale.get("GAME_RUNNING");
      }
      const gameTaskState = selectedGameTaskState();
      const gameStatusArgs = gameTaskState.statusArgs();
      const isRecovering =
        gameStatusArgs?.key === "REVERT_PATCHING" ||
        gameTaskState.statusText().startsWith("还原阶段");
      if (isRecovering) {
        return locale.get("GAME_RECOVERING");
      }
      if (taskQueue.getState(GLOBAL_TASK_KEY).busy()) {
        return locale.get("ENVIRONMENT_CONFIGURING");
      }
      const download = selectedDownloadControl();
      if (download.active) {
        return download.pauseRequested
          ? locale.get("DOWNLOAD_PAUSED")
          : locale.get("DOWNLOADING");
      }
      if (!wineInstalled()) return locale.get("INIT_ENVIRONMENT");
      return actionLabel(selectedGame());
    }

    function selectGame(index: number) {
      const game = games[index];
      setSelectedGameIndex(index);
      setVideoLoaded(false);
      closeLibrary();
      if (showLibrary && game) {
        void setKey("hyp_last_view", game.id);
      }
    }

    function onPredownload() {
      const game = selectedGame();
      taskQueue.enqueue({
        key: game.id,
        fn: gameProgram(aria2, baseWine, game, () => game.client.predownload()),
        name: "PREDOWNLOAD_READY",
        downloadTask: gameDownloadTaskMetadata(game, locale, "predownload"),
      });
    }

    async function openNativeSettings(game: HypGame) {
      restoreNativeSettingsNamespace?.();
      let restore: (() => void) | undefined;
      if (game.namespace) {
        if (getActiveStorageNamespace() === game.namespace) {
          // The namespace is already active — e.g. the game itself is running
          // and its launch task holds the namespace, which blocks the
          // serialized namespace queue. Nothing to switch; settings stay usable
          // while the game is running.
          restore = () => undefined;
        } else {
          // Don't let a running game's held namespace block opening settings:
          // apply the switch in the background and restore it when the modal
          // closes.
          const activation = activateStorageNamespace(game.namespace);
          restore = () => {
            void activation.then(fn => fn());
          };
        }
      }
      if (nativeSettingsCloseTimer) {
        clearTimeout(nativeSettingsCloseTimer);
        nativeSettingsCloseTimer = undefined;
        setNativeSettingsGame(undefined);
      }
      batch(() => {
        restoreNativeSettingsNamespace = restore;
        setNativeSettingsOpen(true);
        setNativeSettingsGame(game);
      });
    }

    function closeNativeSettings() {
      restoreNativeSettingsNamespace?.();
      restoreNativeSettingsNamespace = undefined;
      setNativeSettingsOpen(false);
      if (nativeSettingsCloseTimer) {
        clearTimeout(nativeSettingsCloseTimer);
        nativeSettingsCloseTimer = undefined;
      }
      if (nativeSettingsGame()) {
        nativeSettingsCloseTimer = setTimeout(() => {
          nativeSettingsCloseTimer = undefined;
          setNativeSettingsGame(undefined);
        }, 220);
      }
    }

    return (
      <div
        classList={{
          "hyp-shell": true,
          "library-open": libraryOpen(),
          "library-closing": libraryClosing(),
        }}
        style={{
          "--hyp-accent": themeHex(),
          "--hyp-accent-text": themeText(),
        }}
      >
        <Show when={currentBgImage()}>
          <div
            classList={{
              "hyp-bg-layer": true,
              leaving: bgTransition()?.gameId === selectedGame().id,
            }}
            style={{
              "background-image": `url(${currentBgImage()})`,
            }}
          >
            <Show when={currentBgVideo()}>
              <video
                ref={el => {
                  baseVideoRef = el;
                }}
                class="hyp-video"
                src={currentBgVideo()}
                autoplay
                loop
                muted
                playsinline
                onLoadedData={() => setVideoLoaded(true)}
                style={{ opacity: videoLoaded() ? 1 : 0 }}
              />
            </Show>
            <Show when={currentBgTheme()}>
              <div
                class="hyp-theme"
                style={{
                  "background-image": `url(${currentBgTheme()})`,
                }}
              />
            </Show>
          </div>
        </Show>

        <Show when={transitionTarget()}>
          <div
            class="hyp-bg-layer enter"
            style={{
              "background-image": transitionTarget()?.background
                ? `url(${transitionTarget()?.background})`
                : undefined,
            }}
          >
            <Show
              when={
                !disableVideoBackground() &&
                transitionTarget()?.background_video
              }
            >
              <video
                class="hyp-video"
                src={transitionTarget()?.background_video}
                autoplay
                loop
                muted
                playsinline
              />
            </Show>
            <Show when={transitionTarget()?.background_theme}>
              <div
                class="hyp-theme"
                style={{
                  "background-image": `url(${
                    transitionTarget()?.background_theme
                  })`,
                }}
              />
            </Show>
          </div>
        </Show>

        <div class="hyp-vignette" aria-hidden="true" />

        <Show when={currentBackgrounds().length > 1}>
          <div class="hyp-bg-switcher" role="group" aria-label="Backgrounds">
            <For each={currentBackgrounds()}>
              {(_, index) => (
                <button
                  type="button"
                  classList={{
                    "hyp-bg-dot": true,
                    active: currentBgIndex() === index(),
                  }}
                  aria-label={`Background ${index() + 1}`}
                  aria-pressed={currentBgIndex() === index()}
                  title={`Background ${index() + 1}`}
                  onClick={() => switchBackground(selectedGame(), index())}
                />
              )}
            </For>
          </div>
        </Show>

        <aside class="hyp-game-rail">
          <button class="hyp-orbit-button" aria-label="Yaaglm">
            <span />
          </button>
          <div class="hyp-game-icons">
            <For each={sidebarGames()}>
              {entry => (
                <button
                  classList={{
                    "hyp-game-icon": true,
                    // 必须在 classList 内直接读取 selectedGameIndex()：
                    // 若先求值到非响应式局部变量，切换游戏后高亮不会移动。
                    active: selectedGameIndex() === entry.index,
                  }}
                  aria-label={entry.game.title}
                  onClick={() => selectGame(entry.index)}
                >
                  <GameIcon
                    src={
                      entry.game.iconImage ||
                      entry.game.client.uiContent.iconImage ||
                      entry.game.fallbackIcon
                    }
                    title={entry.game.title}
                    channel={entry.game.id}
                  />
                </button>
              )}
            </For>
          </div>
          <Show when={showLibrary}>
            <button
              classList={{
                "hyp-rail-button": true,
                "hyp-library-button": true,
                active: libraryOpen(),
              }}
              aria-label="游戏库"
              title="游戏库"
              onClick={() => {
                const next = !libraryOpen();
                toggleLibrary();
                if (next) {
                  void setKey("hyp_last_view", "library");
                } else {
                  void setKey("hyp_last_view", selectedGame().id);
                }
              }}
            >
              <span class="hyp-library-icon" />
            </button>
          </Show>
          <button
            class="hyp-rail-button hyp-download-queue-button"
            aria-label={locale.get("DOWNLOAD_MANAGER")}
            title={locale.get("DOWNLOAD_MANAGER")}
            onClick={() => setDownloadModalOpen(true)}
          >
            <span class="hyp-download-queue-icon" aria-hidden="true" />
            <Show when={activeDownloadCount() > 0}>
              <span class="hyp-download-queue-badge">
                {activeDownloadCount()}
              </span>
            </Show>
          </button>
          <div class="hyp-rail-bottom">
            <button
              class="hyp-rail-button"
              aria-label="Global settings"
              title="Global settings"
              onClick={() => setGlobalModalRoute("settings")}
            >
              <span class="hyp-gear-icon" aria-hidden="true" />
            </button>
          </div>
        </aside>

        <main
          classList={{
            "hyp-stage": true,
            "library-open": libraryMounted(),
          }}
          aria-label={selectedGame().title}
        >
          <MhyClientView
            client={selectedGame().client}
            channelName={
              selectedGame().client.uiContent.channelName ||
              selectedGame().id.toUpperCase()
            }
          />
          <Show when={libraryMounted()}>
            <GameLibraryView
              games={libraryItems()}
              themeColor={themeHex()}
              closing={libraryClosing()}
              onClose={() => {
                closeLibrary();
                void setKey("hyp_last_view", selectedGame().id);
              }}
              onSelect={index => {
                selectGame(index);
              }}
            />
          </Show>
        </main>

        <section class="hyp-action-area">
          <div class="hyp-action-group">
            <Show when={globalProgressPanel()}>
              <ProgressPanel panel={globalProgressPanel} locale={locale} />
            </Show>
            <Show when={activeProgressPanel()}>
              <ProgressPanel panel={activeProgressPanel} locale={locale} />
            </Show>
            <Show
              when={
                selectedGame().client.showPredownloadPrompt() &&
                !selectedGameTaskState().busy() &&
                wineInstalled()
              }
            >
              <button class="hyp-secondary-button" onClick={onPredownload}>
                {locale.format("PREDOWNLOAD_READY", [
                  selectedGame().client.predownloadVersion(),
                ])}
              </button>
            </Show>
            <div class="hyp-primary-row">
              <button
                classList={{
                  "hyp-primary-button": true,
                  "hyp-primary-button-downloading":
                    !selectedGameRunning() &&
                    (selectedDownloadControl().active ||
                      activeTaskState().progress() > 0),
                }}
                disabled={actionDisabled()}
                onClick={() => onPrimaryAction().catch(fatal)}
                style={
                  {
                    "--hyp-accent": themeHex(),
                    "--hyp-accent-text": themeText(),
                  } as JSX.CSSProperties
                }
              >
                <Show
                  when={
                    !selectedGameRunning() &&
                    (selectedDownloadControl().active ||
                      activeTaskState().progress() > 0)
                  }
                >
                  <span class="hyp-ring">
                    <span
                      class="hyp-ring-progress"
                      style={{
                        "--hyp-ring-progress": `${activeTaskState().progress()}%`,
                      }}
                      aria-hidden="true"
                    />
                    <Show
                      when={selectedDownloadControl().pauseRequested}
                      fallback={
                        <span class="hyp-ring-text">
                          {Math.round(activeTaskState().progress())}
                        </span>
                      }
                    >
                      <span class="hyp-ring-icon">
                        <span class="hyp-ring-icon-pause" aria-hidden="true" />
                      </span>
                    </Show>
                  </span>
                </Show>
                <span class="hyp-action-copy">
                  <span>{primaryButtonLabel()}</span>
                </span>
              </button>
              <Popover placement="top-end">
                {({ onClose }) => (
                  <>
                    <PopoverTrigger
                      class="hyp-menu-button"
                      aria-label={locale.get("SETTING_QUICK_ACTIONS")}
                      title={locale.get("SETTING_QUICK_ACTIONS")}
                    >
                      <span class="hyp-menu-icon" aria-hidden="true" />
                    </PopoverTrigger>
                    <PopoverContent class="hyp-menu-popover-content">
                      <PopoverBody class="hyp-menu-popover-body">
                        <div class="hyp-menu-popover">
                          <div class="hyp-menu-version">
                            <span>{locale.get("GAME_VERSION")}</span>
                            <strong>
                              {displayGameVersion(selectedGame())}
                            </strong>
                          </div>
                          <button
                            class="hyp-menu-item"
                            disabled={
                              selectedGame().client.installState() !==
                                "INSTALLED" || actionDisabled()
                            }
                            onClick={() => {
                              startCheckIntegrity(selectedGame());
                              onClose();
                            }}
                          >
                            {locale.get("SETTING_CHECK_INTEGRITY")}
                          </button>
                          <button
                            class="hyp-menu-item"
                            disabled={!selectedGame().client.installDir()}
                            onClick={() => {
                              void exec2(
                                ["open", selectedGame().client.installDir()],
                                {},
                                false,
                                "/dev/null"
                              );
                              onClose();
                            }}
                          >
                            {locale.get("SETTING_OPEN_GAME_INSTALL_DIR")}
                          </button>
                          <button
                            class="hyp-menu-item"
                            disabled={
                              !selectedGame().client.installDir() ||
                              actionDisabled()
                            }
                            onClick={() => {
                              openGameUninstallDialog();
                              onClose();
                            }}
                          >
                            {locale.get("SETTING_UNINSTALL_GAME")}
                          </button>
                          <div class="hyp-menu-divider" />
                          <button
                            class="hyp-menu-item"
                            onClick={() => {
                              openNativeSettings(selectedGame());
                              onClose();
                            }}
                          >
                            {locale.currentLanguage.startsWith("zh")
                              ? "游戏设置"
                              : "Game Settings"}
                          </button>
                          <button
                            class="hyp-menu-item"
                            onClick={() => {
                              openLogs();
                              onClose();
                            }}
                          >
                            {locale.get("LOG_VIEWER_OPEN_ACTION")}
                          </button>
                          <Show when={selectedGameRunning()}>
                            <button
                              class="hyp-menu-item hyp-menu-item-danger"
                              onClick={() => {
                                void forceQuitSelectedGame();
                                onClose();
                              }}
                            >
                              {locale.get("FORCE_QUIT_GAME")}
                            </button>
                          </Show>
                          <Show
                            when={
                              selectedGame().client.installState() ===
                                "INSTALLED" &&
                              wineInstalled() &&
                              selectedGame().client.runtimeReady() &&
                              selectedGame().client.updateRequired() &&
                              !selectedGameRunning()
                            }
                          >
                            <button
                              class="hyp-menu-item"
                              disabled={actionDisabled()}
                              onClick={() => {
                                void startGameLaunch(selectedGame());
                                onClose();
                              }}
                            >
                              {locale.get("LAUNCH_WITHOUT_UPDATE")}
                            </button>
                          </Show>
                        </div>
                      </PopoverBody>
                    </PopoverContent>
                  </>
                )}
              </Popover>
            </div>
          </div>
        </section>

        <Show when={nativeSettingsGame()}>
          {game => {
            const UI = game().ConfigurationUI;
            return (
              <UI
                opened={nativeSettingsOpen()}
                onOpenLogs={openLogs}
                actionDisabled={actionDisabled}
                onOpenGlobalSettings={() => {
                  closeNativeSettings();
                  setGlobalModalRoute("settings");
                }}
                onClose={action => {
                  const savedGame = game();
                  closeNativeSettings();
                  if (action === "check-integrity") {
                    startCheckIntegrity(savedGame);
                  }
                }}
              />
            );
          }}
        </Show>

        <GameUpdatePromptModal
          game={updatePromptGame}
          locale={locale}
          onClose={() => setUpdatePromptGame()}
          onConfirm={target => {
            setUpdatePromptGame();
            taskQueue.enqueue({
              key: target.id,
              fn: gameProgram(aria2, baseWine, target, () =>
                target.client.update()
              ),
              name: "UPDATE",
              downloadTask: gameDownloadTaskMetadata(target, locale, "release"),
            });
          }}
        />

        <GlobalModals
          route={globalModalRoute}
          onRouteChange={route => {
            setGlobalModalRoute(route);
            if (route == null) void refreshThemeColor();
          }}
          settingsUI={GlobalConfigurationUI}
          onOpenLogs={openLogs}
          actionDisabled={actionDisabled}
          locale={locale}
          channelCode={aboutChannelCode()}
          onCheckUpdate={onCheckUpdate}
        />

        <DownloadQueueModal
          opened={downloadModalOpen()}
          onClose={() => setDownloadModalOpen(false)}
          locale={locale}
        />
        <GameUninstallDialog />
        <LogViewer />
      </div>
    );
  };
}
