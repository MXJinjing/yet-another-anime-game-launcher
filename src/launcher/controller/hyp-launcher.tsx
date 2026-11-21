import {
  sophonPredownloadPath,
  SOPHON_PREDOWNLOAD_ROOT_KEY,
  SOPHON_PREDOWNLOAD_TARGET_KEY,
} from "../../integrations/sophon-settings";
import { removeExternalSophonPredownload } from "@download/sophon-predownload";
import { SophonInstallModal } from "../../modals/sophon-install-modal";
import type { SophonInstallSelection } from "../../integrations/sophon-install-options";
import { resolvePredownloadVisibility } from "../model/predownload-visibility";
import { createGlobalSettings } from "@settings";
import { createConfigStore } from "@config";
import { applyRecommendedGameSettings } from "@settings/recommended-settings";
import { TaskFailedError } from "@tasks/task-program";
import { isAuthorizationCancelledError } from "../../runtime/authorization";
import { isConnectionError } from "../../services/connection-error";
import { InitialWineSetupModal } from "../../modals/initial-wine-setup-modal";
import { applyRecommendedWineProgram } from "@wine/recommended-settings-program";
import { Locale } from "@locale";
import { downloadManagerText } from "../../locale/download-manager";
import { hopeTaskNotifier } from "@tasks/task-notifications";
import { exec2, fatal, getKeyOrDefault, setKey } from "@runtime";
import { log } from "@logging/logger";
import {
  fileOrDirExists,
  openDir,
  readDirectory,
  removeDirectory,
  removeFile,
} from "@platform/neutralino";
import {
  getWineDistributions,
  isWineDistroInstalled,
  resolveRecommendedWineDistro,
  type Wine,
  type WineDistribution,
} from "@wine";
import { AUTO_WINE_TAG, SHARED_WINE_TAG } from "@wine/multi-game";
import { join } from "path-browserify";
import {
  notificationService,
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
  onMount,
} from "solid-js";
import type { JSX } from "solid-js";
import { createGameInstallationDirectorySanitizer } from "@services/game-installation";
import { getDirectorySize } from "@services/directory-size";
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
import { openLogWindow } from "../../logging/log-window-host";
import {
  cancelControlledDownload,
  DownloadControlState,
  getDownloadControlState,
  hasActiveDownloads,
  isDownloadCancelledError,
  isDownloadFailedError,
  pauseControlledDownload,
  resumeControlledDownload,
  subscribeDownloadControl,
} from "@download/control";
import { reloadConfig, setGlobalTaskActive } from "@download/stream-scheduler";
import {
  type DownloadTaskSnapshot,
  getDownloadTasks,
  subscribeDownloadTasks,
} from "@download/task-registry";
import { DownloadManager } from "../views/download-manager";
import { GameUpdatePromptModal } from "../../modals/game-update-prompt-modal";
import { GameCrashModal } from "../../modals/game-crash-modal";
import {
  LaunchErrorModal,
  RuntimeReplacementErrorModal,
} from "../../modals/runtime-replacement-error-modal";
import { isRuntimeReplacementFileMissingError } from "../../clients/mhy/patch";
import cloudDownloadIcon from "../../assets/icons/cloud-download.svg";
import cloudCheckIcon from "../../assets/icons/cloud-check.svg";
import { humanFileSize } from "../../runtime/format";
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
import type {
  HypGame,
  HypGameWineTaskRequest,
  HypLauncherOptions,
} from "./launcher-types";

export type {
  HypGame,
  HypGameWineOption,
  HypLauncherOptions,
} from "./launcher-types";

const BG_STORAGE_KEY = "hyp_bg";
const BG_TRANSITION_MS = 600;
const LIBRARY_TRANSITION_MS = 360;
const PREDOWNLOAD_STAGING_DIRECTORIES = [".ariatmp", ".tmp"];

async function removeDirectoryRecursively(path: string): Promise<void> {
  for (const entry of await readDirectory(path)) {
    const child = join(path, entry.entry);
    if (entry.type === "DIRECTORY") await removeDirectoryRecursively(child);
    else await removeFile(child);
  }
  await removeDirectory(path);
}

type ProgressSummaryData = {
  title: string;
  speed?: string;
  progress?: number;
  progressMode?: "determinate" | "indeterminate";
};

type ProgressPanelData = ProgressSummaryData & {
  file?: string;
  downloaded?: string;
  total?: string;
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

function roundedProgress(progress = 0) {
  return Math.round(Math.min(100, Math.max(0, progress)));
}

function LauncherProgressBar(props: { panel: ProgressSummaryData }) {
  const determinate = () => props.panel.progressMode === "determinate";
  const percent = () => roundedProgress(props.panel.progress);
  return (
    <Show when={props.panel.progressMode !== undefined}>
      <div
        class="hyp-download-progress"
        role="progressbar"
        aria-label={props.panel.title}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={determinate() ? percent() : undefined}
      >
        <div
          classList={{
            "hyp-download-progress-fill": true,
            indeterminate: !determinate(),
          }}
          style={{ width: determinate() ? `${percent()}%` : undefined }}
        />
      </div>
    </Show>
  );
}

function GameProgressSummary(props: {
  panel: ProgressSummaryData;
  locale: Locale;
  onViewDetails?: () => void;
}) {
  return (
    <div class="hyp-progress-div hyp-game-progress-summary">
      <div class="hyp-download-header">
        <span class="hyp-download-title" title={props.panel.title}>
          {props.panel.title}
        </span>
        <Show when={props.onViewDetails}>
          <button
            class="hyp-download-details-link"
            type="button"
            onClick={() => props.onViewDetails?.()}
          >
            {downloadManagerText(props.locale.currentLanguage).viewDetails}
          </button>
        </Show>
      </div>
      <LauncherProgressBar panel={props.panel} />
      <Show
        when={props.panel.progressMode === "determinate" || props.panel.speed}
      >
        <div class="hyp-download-summary-metrics">
          <span>
            <Show when={props.panel.progressMode === "determinate"}>
              {roundedProgress(props.panel.progress)}%
            </Show>
          </span>
          <Show when={props.panel.speed}>
            <span>{props.panel.speed}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

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
      <LauncherProgressBar panel={current()} />
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
  downloadWineDistro,
  enableWineDistro,
  uninstallWineDistro,
  actionDisabledRef,
  gameWineTaskDispatcher,
}: HypLauncherOptions) {
  const baseWine = wine;

  const [activeWineDistroId, setActiveWineDistroId] =
    createSignal(wineDistroId);

  let requestWineDistroEnable = (
    _distro: WineDistribution,
    _onDone: (distro: WineDistribution) => void
  ): void => undefined;
  let requestWineDistroDownload = (
    _distro: WineDistribution,
    _onDone: (distro: WineDistribution) => void,
    _onProgress: (progress: number | undefined, phase?: "extracting") => void,
    _onFinished: () => void
  ): void => undefined;
  let requestWineDistroUninstall = (
    _distro: WineDistribution,
    _onDone: (distro: WineDistribution) => void
  ): void => undefined;
  let markWineDistroEnabled = (_distro: WineDistribution): void => undefined;
  function notifyWineDistroInitialized(distro: WineDistribution) {
    setActiveWineDistroId(distro.id);
    markWineDistroEnabled(distro);
  }
  let _actionDisabled = () => false;
  let _launcherDataBusy = () => true;

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
      launcherDataBusy: () => _launcherDataBusy(),
      gameDirectories: () => games.map(game => game.client.installDir()),
      onEnableWineDistro: (distro, onDone) =>
        requestWineDistroEnable(distro, onDone),
      onDownloadWineDistro: (distro, onDone, onProgress, onFinished) =>
        requestWineDistroDownload(distro, onDone, onProgress, onFinished),
      onUninstallWineDistro: (distro, onDone) =>
        requestWineDistroUninstall(distro, onDone),
      onWineDistroInitialized: onDone => {
        markWineDistroEnabled = onDone;
      },
      wineDistroUsages: () =>
        games.flatMap(game => {
          const distroId = game.wineTag?.();
          return distroId ? [{ distroId, label: game.title }] : [];
        }),
      onResetWineEnv,
      modalTitle: () => locale.get("SETTING_GLOBAL"),
    });

  const { selectPath } = await createGameInstallationDirectorySanitizer({
    openFolderDialog: async () =>
      await openDir(locale.get("SELECT_INSTALLATION_DIR")),
    locale,
  });

  // Debug mode opens the independent log window on the game tab. The window
  // is its own process, so launcher modals and minimize do not cover it, and
  // it is closed with the launcher.

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
      storage: () => games[selectedGameIndex()]?.storage,
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
    const raw = await (game.storage?.getKeyOrDefault(BG_STORAGE_KEY, "") ??
      getKeyOrDefault(BG_STORAGE_KEY, ""));
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
      await (game.storage?.setKey(BG_STORAGE_KEY, value) ??
        setKey(BG_STORAGE_KEY, value));
    }
  }

  const externalPredownloadRoot = (game: HypGame) =>
    game.storage?.getKeyOrDefault(SOPHON_PREDOWNLOAD_ROOT_KEY, "") ??
    Promise.resolve("");

  async function externalPredownloadDirectory(game: HypGame) {
    return sophonPredownloadPath(
      await externalPredownloadRoot(game),
      game.client.installDir()
    );
  }

  async function predownloadDirectories(game: HypGame) {
    const paths = PREDOWNLOAD_STAGING_DIRECTORIES.map(directory =>
      join(game.client.installDir(), directory)
    );
    const external = await externalPredownloadDirectory(game);
    if (external) paths.push(external);
    return paths;
  }

  async function detectCompletedPredownload(
    game: HypGame,
    verifyStagingFiles = true
  ) {
    if (game.client.installState() !== "INSTALLED") return "";
    const targetVersion = game.client.predownloadVersion();
    if (!targetVersion || !game.client.installDir()) return "";

    const storage = game.storage;
    const marker = await (storage?.getKeyOrDefault(
      "predownloaded_all",
      "NOTFOUND"
    ) ?? getKeyOrDefault("predownloaded_all", "NOTFOUND"));
    if (marker !== "true" && marker !== targetVersion) return "";
    if (!verifyStagingFiles) return targetVersion;

    // Aria2 and Sophon keep completed pre-download payloads in these
    // installation-directory staging folders until the game update runs.
    for (const path of await predownloadDirectories(game)) {
      if (!(await fileOrDirExists(path))) continue;
      try {
        if ((await readDirectory(path)).length > 0) return targetVersion;
      } catch {
        // Ignore inaccessible staging directories and try the next one.
      }
    }
    return "";
  }

  const persistedPredownloads: Record<string, string> = {};
  for (const game of games) {
    const version = await detectCompletedPredownload(game);
    if (version) persistedPredownloads[game.id] = version;
  }

  return function HypLauncher() {
    const selectedGame = () => games[selectedGameIndex()];
    const [installPrompt, setInstallPrompt] = createSignal<{
      game: HypGame;
      directory: string;
      purpose: "install" | "verify";
    }>();
    async function enqueueInstall(
      game: HypGame,
      directory: string,
      selection?: SophonInstallSelection
    ) {
      await log(`Game installation requested: ${directory}`);
      taskQueue.enqueue({
        key: game.id,
        fn: gameProgram(aria2, baseWine, game, () =>
          game.client.install(directory, selection)
        ),
        name: "INSTALL",
        downloadTask: gameDownloadTaskMetadata(game, locale, "release"),
      });
    }
    const [initialWineSetup, setInitialWineSetup] = createSignal<{
      game: HypGame;
      distributions: WineDistribution[];
    }>();
    onMount(() => {
      const hydrate = (game: HypGame) => {
        void game.client
          .hydrateUiContent?.()
          .catch(error =>
            log(
              `[hyp-connect] deferred UI hydration failed for ${
                game.id
              }: ${String(error)}`
            )
          );
      };
      const usesIdleCallback = "requestIdleCallback" in window;
      const scheduled = usesIdleCallback
        ? window.requestIdleCallback(() => {
            hydrate(selectedGame());
            games.filter(game => game !== selectedGame()).forEach(hydrate);
          })
        : window.setTimeout(() => {
            hydrate(selectedGame());
            games.filter(game => game !== selectedGame()).forEach(hydrate);
          }, 150);
      onCleanup(() => {
        if (usesIdleCallback) window.cancelIdleCallback(scheduled as number);
        else window.clearTimeout(scheduled as number);
      });
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
    const [downloadManagerOpen, setDownloadManagerOpen] = createSignal(false);
    const [downloadManagerTaskId, setDownloadManagerTaskId] =
      createSignal<string>();
    const [downloadTasks, setDownloadTasks] = createSignal(getDownloadTasks());
    const activeDownloadCount = createMemo(() => downloadTasks().length);
    const selectedGameDownloadTaskId = createMemo(() => {
      const game = selectedGame();
      const key = game.namespace ?? game.id;
      const matching = downloadTasks().filter(task => task.key === key);
      return (matching.find(task => task.status === "active") ?? matching[0])
        ?.id;
    });
    onCleanup(subscribeDownloadTasks(setDownloadTasks));

    function openDownloadManager(taskId?: string) {
      setDownloadManagerTaskId(taskId);
      setDownloadManagerOpen(true);
    }

    void reloadConfig();
    const [globalModalRoute, setGlobalModalRoute] =
      createSignal<GlobalModalRoute | null>(null);
    const [globalSettingsInitialTab, setGlobalSettingsInitialTab] =
      createSignal(0);
    const [missingWineGame, setMissingWineGame] = createSignal<HypGame>();
    const [missingGameExecutableGame, setMissingGameExecutableGame] =
      createSignal<HypGame>();
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
      await (game.storage?.setKey(BG_STORAGE_KEY, value) ??
        setKey(BG_STORAGE_KEY, value));
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
    const [completedPredownloadByGame, setCompletedPredownloadByGame] =
      createSignal<Partial<Record<string, string>>>(persistedPredownloads);
    const predownloadVisibility = createMemo(() => {
      const game = selectedGame();
      return resolvePredownloadVisibility(
        completedPredownloadByGame()[game.id],
        game.client.showPredownloadPrompt(),
        game.client.installState() === "INSTALLED",
        game.client.predownloadVersion(),
        game.client.gameVersion?.() ?? ""
      );
    });
    const [predownloadSizeByGame, setPredownloadSizeByGame] = createSignal<
      Record<string, number | undefined>
    >({});
    const [crashedGame, setCrashedGame] = createSignal<HypGame>();
    const [runtimeReplacementError, setRuntimeReplacementError] = createSignal<{
      game: HypGame;
      details: string;
    }>();
    const pendingCrashKeys = new Set<string>();
    let restoreNativeSettingsNamespace: (() => void) | undefined;
    const taskQueue = createConcurrentTaskQueueState({
      locale,
      onStateKey: (key, stateKey) => {
        if (key === GLOBAL_TASK_KEY) return;
        if (stateKey === "GAME_CRASHED") pendingCrashKeys.add(key);
        if (stateKey == null && pendingCrashKeys.delete(key)) {
          setCrashedGame(games.find(game => game.id === key));
        }
        const lifecycleActive =
          stateKey == "GAME_STARTING" ||
          stateKey == "GAME_RUNNING" ||
          stateKey == "GAME_CRASHED" ||
          stateKey == "REVERT_PATCHING";
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
      notifier: {
        ...hopeTaskNotifier,
        taskFailed: (taskLocale, taskName, error, taskKey) => {
          if (
            taskName === "LAUNCH" &&
            isRuntimeReplacementFileMissingError(error)
          ) {
            const game = games.find(candidate => candidate.id === taskKey);
            if (game) {
              setRuntimeReplacementError({
                game,
                details: error.message,
              });
              return;
            }
          }
          hopeTaskNotifier.taskFailed(taskLocale, taskName, error);
        },
      },
    });

    if (gameWineTaskDispatcher) {
      gameWineTaskDispatcher.current = (request: HypGameWineTaskRequest) => {
        taskQueue.enqueue({
          // Prefix changes must not race this game's own launch/update tasks,
          // but other games and their downloads keep running on other keys.
          key: request.gameId,
          fn: async function* () {
            yield ["setStateText", "INIT_ENVIRONMENT"];
            yield* request.fn();
          },
          name: "INIT_ENVIRONMENT",
          downloadTask: {
            title: request.title,
            key: request.downloadKey,
            showImmediately: true,
          },
        });
      };
    }

    if (gameCloseHandler) {
      gameCloseHandler.current = async () => {
        const lifecycleKeys = Object.entries(gameLifecycleActiveByKey())
          .filter(([, active]) => active)
          .map(([key]) => key);
        const processKeys = Object.entries(gameRunningByKey())
          .filter(([, running]) => running)
          .map(([key]) => key);
        const startupKeys = lifecycleKeys.filter(
          key => taskQueue.getState(key).statusArgs()?.key === "GAME_STARTING"
        );
        const winesToStop = new Set<Wine>();
        for (const key of new Set([...processKeys, ...startupKeys])) {
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
    const gameForDownloadTask = (task: DownloadTaskSnapshot) =>
      games.find(game => (game.namespace ?? game.id) === task.key);

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
    function openLogs() {
      void openLogWindow("launcher").catch(error => {
        notificationService.show({
          status: "warning",
          title: locale.get("LOG_VIEWER_OPEN_FAILED"),
          description: String(error),
        });
      });
    }
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
    const activeProgressPanel = createMemo<ProgressSummaryData | null>(() => {
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
      const isGameRunning =
        args?.key === "GAME_RUNNING" || args?.key === "GAME_STARTING";
      const isLaunchPhase = taskStatusText.startsWith("启动阶段");
      const isRestorePhase =
        args?.key === "REVERT_PATCHING" ||
        taskStatusText.startsWith("还原阶段");
      const isScanning = args?.key === "SCANNING_FILES";
      const title = download.paused
        ? locale.get("DOWNLOAD_STATUS_PAUSED")
        : isScanning
        ? locale.get("CHECKING_GAME_INTEGRITY")
        : isDownloadStatus
        ? isEnvSpeed
          ? locale.get("DOWNLOADING_ENVIRONMENT")
          : locale.get("DOWNLOAD_PROGRESS")
        : taskStatusText;
      const speed =
        download.paused || !isDownloadStatus
          ? undefined
          : args?.args[isEnvSpeed ? 0 : 1];
      const progressMode: ProgressSummaryData["progressMode"] =
        isEnvironmentExtract || isEnvironmentConfiguring
          ? "indeterminate"
          : isEnvironmentDownload
          ? isWineDownload
            ? "determinate"
            : "indeterminate"
          : isGameRunning
          ? "indeterminate"
          : isScanning
          ? Number(args?.args[1]) > 0
            ? "determinate"
            : "indeterminate"
          : isDownloadStatus ||
            isLaunchPhase ||
            isRestorePhase ||
            taskState.progress() > 0
          ? "determinate"
          : undefined;
      return { title, speed, progress: taskState.progress(), progressMode };
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
      const [file, speed, downloaded, total, , fileIndex, fileCount] =
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
    function usesSharedWine(game: HypGame) {
      const tag = game.wineTag?.();
      return !game.recommendedWinePrefix || !tag || tag === SHARED_WINE_TAG;
    }

    function launcherTasksBusy() {
      return (
        anyGameRunning() ||
        activeDownloadCount() > 0 ||
        taskQueue.isBusy(GLOBAL_TASK_KEY) ||
        games.some(game => taskQueue.isBusy(game.id))
      );
    }
    _launcherDataBusy = () => launcherTasksBusy() || hasActiveDownloads();

    function recommendedSettingsDisabled() {
      return !wineInstalled() || launcherTasksBusy();
    }

    function applyRecommendedSettings(game: HypGame) {
      if (recommendedSettingsDisabled()) return;
      const distro = resolveRecommendedWineDistro();
      const shared = usesSharedWine(game);
      closeNativeSettings();
      taskQueue.enqueue({
        fn: async function* () {
          try {
            const tag = game.wineTag?.();
            const effectiveDistroId =
              shared || tag === AUTO_WINE_TAG ? activeWineDistroId() : tag;
            yield* applyRecommendedWineProgram({
              effectiveDistroId,
              installed: () => isWineDistroInstalled(distro.id),
              separatePrefix: shared ? undefined : game.recommendedWinePrefix,
              download: downloadWineDistro,
              enable: async function* (distro) {
                yield* enableWineDistro(distro);
                notifyWineDistroInitialized(distro);
              },
            });

            await applyRecommendedGameSettings(
              createConfigStore(game.storage),
              game.clientId,
              game.config
            );

            for (const candidate of games) {
              await candidate.refreshGameWineSelection?.(
                shared ? distro : undefined
              );
              if (
                candidate === game ||
                (shared &&
                  (usesSharedWine(candidate) ||
                    candidate.wineTag?.() === AUTO_WINE_TAG))
              ) {
                await candidate.client.refreshRuntimeReady();
              }
            }
          } catch (error) {
            if (
              isDownloadCancelledError(error) ||
              isDownloadFailedError(error)
            ) {
              throw error;
            }
            throw new TaskFailedError(String(error));
          }
        },
        name: "SETTING_APPLY_RECOMMENDED_SETTINGS",
      });
    }

    requestWineDistroEnable = (distro, onDone) => {
      if (actionDisabled()) return;
      closeNativeSettings();
      setGlobalModalRoute(null);
      log(`Wine environment enable requested: ${distro.id}`);
      taskQueue.enqueue({
        fn: async function* () {
          yield* enableWineDistro(distro);
          setActiveWineDistroId(distro.id);
          onDone(distro);
        },
        name: "SETTING_WINE_ENABLED",
      });
    };
    requestWineDistroDownload = (distro, onDone, onProgress, onFinished) => {
      if (actionDisabled()) {
        onFinished();
        return;
      }
      const downloadKey = `wine-download:${distro.id}`;
      log(`Wine distribution download requested: ${distro.id}`);
      taskQueue.enqueue({
        key: downloadKey,
        fn: async function* () {
          try {
            for await (const command of downloadWineDistro(
              distro,
              downloadKey
            )) {
              if (command[0] == "setProgress") onProgress(command[1]);
              else if (command[0] == "setUndeterminedProgress")
                onProgress(undefined);
              else if (
                command[0] == "setStateText" &&
                command[1] == "EXTRACTING"
              )
                onProgress(undefined, "extracting");
              yield command;
            }
            onDone(distro);
          } finally {
            onFinished();
          }
        },
        name: "DOWNLOADING_ENVIRONMENT",
        downloadTask: {
          title: distro.displayName,
          key: downloadKey,
        },
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

    function startInitializeWine(
      distro: WineDistribution,
      recommendedFor?: HypGame
    ) {
      if (actionDisabled() || wineInstalled()) return;
      setInitialWineSetup(undefined);
      log(`Initialize Wine environment requested: ${distro.id}`);
      closeNativeSettings();
      setGlobalModalRoute(null);
      taskQueue.enqueue({
        fn: async function* () {
          try {
            yield* initializeWine(
              distro,
              recommendedFor
                ? () =>
                    applyRecommendedGameSettings(
                      createConfigStore(recommendedFor.storage),
                      recommendedFor.clientId,
                      recommendedFor.config
                    )
                : undefined
            );
          } catch (error) {
            if (
              isDownloadCancelledError(error) ||
              isDownloadFailedError(error) ||
              isAuthorizationCancelledError(error) ||
              isConnectionError(error)
            ) {
              throw error;
            }
            throw new TaskFailedError(
              error instanceof Error ? error.message : String(error)
            );
          }
          notifyWineDistroInitialized(distro);
          // Re-read runtime-component state (e.g. DXMT) now that the Wine
          // environment is installed, so the primary button reflects reality.
          for (const game of games) {
            await game.client
              .refreshRuntimeReady()
              .catch(error =>
                log(
                  `Failed to refresh runtime components for ${
                    game.id
                  }: ${String(error)}`
                )
              );
          }
        },
        name: "INIT_ENVIRONMENT",
        downloadTask: { title: distro.displayName },
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
        case "initialize-wine": {
          const distributions = await getWineDistributions();
          if (!wineInstalled() && !actionDisabled()) {
            setInitialWineSetup({ game, distributions });
          }
          return;
        }
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
          enqueueGameUpdate(game);
          return;
        case "launch":
          await startGameLaunch(game);
          return;
        case "install": {
          const selection = await selectPath();
          if (!selection) return;
          if (game.client.installOptions) {
            setInstallPrompt({
              game,
              directory: selection,
              purpose: "install",
            });
          } else {
            await enqueueInstall(game, selection);
          }
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
      if (game.client.integrityOptions) {
        setInstallPrompt({
          game,
          directory: game.client.installDir(),
          purpose: "verify",
        });
        return;
      }
      // Before checking integrity, check for game updates automatically. If a
      // new version is available, ask the user whether to install it first.
      if (
        resolveIntegrityAction(game.client.updateRequired()) === "prompt-update"
      ) {
        setUpdatePromptGame(game);
      } else {
        enqueueCheckIntegrity(game);
      }
    }

    function enqueueCheckIntegrity(
      game: HypGame,
      directory?: string,
      selection?: SophonInstallSelection
    ) {
      taskQueue.enqueue({
        key: game.id,
        fn: gameProgram(aria2, baseWine, game, () =>
          game.client.checkIntegrity(directory, selection)
        ),
        name: "SETTING_CHECK_INTEGRITY",
        downloadTask: gameDownloadTaskMetadata(game, locale, "integrity"),
      });
    }

    async function startGameLaunch(game: HypGame) {
      await log(`Game launch requested: ${game.id}`);
      if (!(await isGameExecutableAvailable(game))) {
        setMissingGameExecutableGame(game);
        return;
      }
      if (!(await isSelectedWineAvailable(game))) {
        setMissingWineGame(game);
        return;
      }
      taskQueue.enqueue({
        key: game.id,
        fn: gameProgram(aria2, baseWine, game, () =>
          createGameLaunchProgram({
            game,
            baseWine,
            onDebugLogs: async target => {
              try {
                await openLogWindow("game", target);
              } catch (error) {
                notificationService.show({
                  status: "warning",
                  title: locale.get("LOG_VIEWER_OPEN_FAILED"),
                  description: String(error),
                });
              }
            },
          })
        ),
        name: "LAUNCH",
        suppressCompletionNotification: true,
      });
    }

    async function isGameExecutableAvailable(game: HypGame) {
      const executable = game.client.gameExecutable?.();
      // Clients without an executable declaration retain their existing
      // launch behavior until they opt in to this preflight check.
      if (!executable) return true;
      try {
        return await fileOrDirExists(
          join(game.client.installDir(), executable)
        );
      } catch {
        return false;
      }
    }

    async function isSelectedWineAvailable(game: HypGame) {
      const selectedTag = game.wineTag?.();
      const distroId =
        !selectedTag ||
        selectedTag === SHARED_WINE_TAG ||
        selectedTag === AUTO_WINE_TAG
          ? activeWineDistroId()
          : selectedTag;
      try {
        const distros = await getWineDistributions();
        return (
          distros.some(distro => distro.id === distroId) &&
          (await isWineDistroInstalled(distroId))
        );
      } catch {
        return false;
      }
    }

    function primaryButtonLabel() {
      if (selectedGameRunning()) {
        return locale.get("GAME_RUNNING");
      }
      const gameTaskState = selectedGameTaskState();
      const gameStatusArgs = gameTaskState.statusArgs();
      if (gameStatusArgs?.key === "GAME_STARTING") {
        return locale.get("GAME_STARTING");
      }
      if (
        gameTaskState.busy() &&
        (gameStatusArgs?.key === "INIT_ENVIRONMENT" ||
          gameStatusArgs?.key === "DOWNLOADING_ENVIRONMENT" ||
          gameStatusArgs?.key === "DOWNLOADING_ENVIRONMENT_SPEED" ||
          gameStatusArgs?.key === "EXTRACT_ENVIRONMENT" ||
          gameStatusArgs?.key === "CONFIGURING_ENVIRONMENT")
      ) {
        return locale.get("INIT_ENVIRONMENT");
      }
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
      setDownloadManagerOpen(false);
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
        fn: async function* () {
          yield* gameProgram(aria2, baseWine, game, () =>
            game.client.predownload()
          )();
          if (!(await refreshPredownloadCompletion(game, false))) {
            throw new TaskFailedError(locale.get("NOTIFICATION_TASK_FAILED"));
          }
        },
        name: "PREDOWNLOAD_READY",
        nameArgs: [game.title, game.client.predownloadVersion()],
        downloadTask: gameDownloadTaskMetadata(game, locale, "predownload"),
      });
    }

    function enqueueGameUpdate(game: HypGame) {
      taskQueue.enqueue({
        key: game.id,
        fn: async function* () {
          yield* gameProgram(aria2, baseWine, game, () =>
            game.client.update()
          )();
          await refreshPredownloadCompletion(game);
        },
        name: "UPDATE",
        downloadTask: gameDownloadTaskMetadata(game, locale, "release"),
      });
    }

    async function refreshPredownloadCompletion(
      game: HypGame,
      verifyStagingFiles = true
    ) {
      const version = await detectCompletedPredownload(
        game,
        verifyStagingFiles
      );
      setCompletedPredownloadByGame(previous => ({
        ...previous,
        [game.id]: version,
      }));
      return version;
    }

    async function refreshPredownloadSize(game: HypGame) {
      setPredownloadSizeByGame(previous => ({
        ...previous,
        [game.id]: undefined,
      }));
      let size = 0;
      for (const path of await predownloadDirectories(game)) {
        const directorySize = await getDirectorySize(path);
        if (directorySize != null) size += directorySize;
      }
      setPredownloadSizeByGame(previous => ({ ...previous, [game.id]: size }));
    }

    async function deletePredownload(game: HypGame) {
      const installDir = game.client.installDir();
      for (const directory of PREDOWNLOAD_STAGING_DIRECTORIES) {
        try {
          await removeDirectoryRecursively(join(installDir, directory));
        } catch {
          // The directory may be absent or already removed.
        }
      }
      const external = await externalPredownloadRoot(game);
      if (external) {
        await removeExternalSophonPredownload(external, installDir);
      }
      await game.storage?.setKey(SOPHON_PREDOWNLOAD_ROOT_KEY, null);
      await game.storage?.setKey(SOPHON_PREDOWNLOAD_TARGET_KEY, null);
      await (game.storage?.setKey("predownloaded_all", null) ??
        setKey("predownloaded_all", null));
      setCompletedPredownloadByGame(previous => ({
        ...previous,
        [game.id]: "",
      }));
      setPredownloadSizeByGame(previous => ({ ...previous, [game.id]: 0 }));
    }

    async function openNativeSettings(game: HypGame) {
      if (nativeSettingsCloseTimer) {
        clearTimeout(nativeSettingsCloseTimer);
        nativeSettingsCloseTimer = undefined;
        setNativeSettingsGame(undefined);
      }
      batch(() => {
        restoreNativeSettingsNamespace = undefined;
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
                preload="metadata"
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
                preload="metadata"
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

        <Show when={!downloadManagerOpen() && currentBackgrounds().length > 1}>
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

        <aside
          classList={{
            "hyp-game-rail": true,
            "single-game": games.length === 1,
          }}
        >
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
                    active:
                      !downloadManagerOpen() &&
                      selectedGameIndex() === entry.index,
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
                active: !downloadManagerOpen() && libraryOpen(),
              }}
              aria-label="游戏库"
              title="游戏库"
              onClick={() => {
                const wasViewingDownloads = downloadManagerOpen();
                const next = wasViewingDownloads || !libraryOpen();
                setDownloadManagerOpen(false);
                if (wasViewingDownloads) openLibrary();
                else toggleLibrary();
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
            classList={{
              "hyp-rail-button": true,
              "hyp-download-queue-button": true,
              active: downloadManagerOpen(),
            }}
            aria-label={locale.get("DOWNLOAD_MANAGER")}
            aria-current={downloadManagerOpen() ? "page" : undefined}
            title={locale.get("DOWNLOAD_MANAGER")}
            onClick={() => openDownloadManager()}
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
          hidden={downloadManagerOpen()}
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

        <Show when={downloadManagerOpen()}>
          <main
            class="hyp-stage downloads-open"
            aria-label={locale.get("DOWNLOAD_MANAGER")}
          >
            <DownloadManager
              locale={locale}
              initialTaskId={downloadManagerTaskId()}
              onOpenSettings={() => {
                setGlobalSettingsInitialTab(1);
                setGlobalModalRoute("settings");
              }}
              getTaskArtwork={task => {
                const game = gameForDownloadTask(task);
                return game
                  ? game.bannerImage ||
                      GAME_BANNER_URLS[game.id] ||
                      game.client.uiContent.background
                  : undefined;
              }}
              renderTaskIcon={task => {
                const game = gameForDownloadTask(task);
                return (
                  <GameIcon
                    src={
                      (game &&
                        (game.client.uiContent.iconImage ||
                          game.fallbackIcon)) ||
                      ""
                    }
                    title={task.title}
                    channel={task.key ?? task.id}
                  />
                );
              }}
            />
          </main>
        </Show>

        <section class="hyp-action-area" hidden={downloadManagerOpen()}>
          <div class="hyp-action-group">
            <Show when={globalProgressPanel()}>
              <ProgressPanel panel={globalProgressPanel} locale={locale} />
            </Show>
            <Show when={activeProgressPanel()}>
              {panel => (
                <GameProgressSummary
                  panel={panel()}
                  locale={locale}
                  onViewDetails={
                    selectedGameDownloadTaskId()
                      ? () => openDownloadManager(selectedGameDownloadTaskId())
                      : undefined
                  }
                />
              )}
            </Show>
            <Show
              when={
                predownloadVisibility() !== "hidden" &&
                !selectedGameTaskState().busy() &&
                wineInstalled()
              }
            >
              <Show
                when={predownloadVisibility() === "completed"}
                fallback={
                  <button class="hyp-secondary-button" onClick={onPredownload}>
                    <img src={cloudDownloadIcon} alt="" aria-hidden="true" />
                    {locale.format("PREDOWNLOAD_BUTTON", [
                      selectedGame().client.predownloadVersion(),
                    ])}
                  </button>
                }
              >
                <Popover
                  placement="top-start"
                  onOpen={() => {
                    void refreshPredownloadSize(selectedGame());
                  }}
                >
                  {({ onClose }) => (
                    <>
                      <PopoverTrigger class="hyp-secondary-button done">
                        <img src={cloudCheckIcon} alt="" aria-hidden="true" />
                        {locale.get("PREDOWNLOAD_DONE")}
                      </PopoverTrigger>
                      <PopoverContent class="hyp-menu-popover-content">
                        <PopoverBody class="hyp-menu-popover-body">
                          <div class="hyp-menu-popover">
                            <div class="hyp-menu-version">
                              <span>
                                {locale.get("SETTING_PREDOWNLOAD")}{" "}
                                {selectedGame().client.predownloadVersion()}
                              </span>
                              <strong>
                                <Show
                                  when={
                                    predownloadSizeByGame()[
                                      selectedGame().id
                                    ] != undefined
                                  }
                                  fallback="..."
                                >
                                  {locale.format("SETTING_PREDOWNLOAD_SIZE", [
                                    humanFileSize(
                                      predownloadSizeByGame()[
                                        selectedGame().id
                                      ] ?? 0,
                                      false,
                                      2
                                    ),
                                  ])}
                                </Show>
                              </strong>
                            </div>
                            <button
                              class="hyp-menu-item hyp-menu-item-danger"
                              onClick={() => {
                                void deletePredownload(selectedGame());
                                onClose();
                              }}
                            >
                              {locale.get("SETTING_DELETE_PREDOWNLOAD")}
                            </button>
                          </div>
                        </PopoverBody>
                      </PopoverContent>
                    </>
                  )}
                </Popover>
              </Show>
            </Show>
            <div class="hyp-primary-row">
              <button
                classList={{
                  "hyp-primary-button": true,
                  "hyp-primary-button-label-long":
                    primaryButtonLabel().length > 12,
                  "hyp-primary-button-label-extra-long":
                    primaryButtonLabel().length > 22,
                  "hyp-primary-button-downloading":
                    !selectedGameRunning() &&
                    (selectedDownloadControl().active ||
                      activeTaskState().progress() > 0),
                }}
                data-label-length={
                  primaryButtonLabel().length > 22
                    ? "extra-long"
                    : primaryButtonLabel().length > 12
                    ? "long"
                    : "normal"
                }
                title={primaryButtonLabel()}
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
                onApplyRecommendedSettings={() =>
                  applyRecommendedSettings(game())
                }
                recommendedSettingsDisabled={recommendedSettingsDisabled}
                recommendedSettingsUsesSharedWine={() => usesSharedWine(game())}
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

        <Show when={installPrompt()} keyed>
          {prompt => (
            <SophonInstallModal
              locale={locale}
              title={prompt.game.title}
              directory={prompt.directory}
              purpose={prompt.purpose}
              chooseDirectory={selectPath}
              load={directory =>
                prompt.purpose === "verify"
                  ? prompt.game.client.integrityOptions!(directory)
                  : prompt.game.client.installOptions!(directory)
              }
              onClose={() => setInstallPrompt()}
              onConfirm={(directory, selection) => {
                setInstallPrompt();
                if (prompt.purpose === "verify") {
                  enqueueCheckIntegrity(prompt.game, directory, selection);
                } else {
                  void enqueueInstall(prompt.game, directory, selection).catch(
                    fatal
                  );
                }
              }}
            />
          )}
        </Show>

        <GameUpdatePromptModal
          game={updatePromptGame}
          locale={locale}
          onClose={() => setUpdatePromptGame()}
          onConfirm={target => {
            setUpdatePromptGame();
            enqueueGameUpdate(target);
          }}
        />

        <RuntimeReplacementErrorModal
          opened={runtimeReplacementError() != undefined}
          locale={locale}
          details={runtimeReplacementError()?.details ?? ""}
          onCancel={() => setRuntimeReplacementError()}
          onOpenSettings={() => {
            const failure = runtimeReplacementError();
            setRuntimeReplacementError();
            if (failure) void openNativeSettings(failure.game);
          }}
        />

        <LaunchErrorModal
          opened={missingWineGame() != undefined}
          title={
            locale.currentLanguage.startsWith("zh")
              ? "Wine 不可用"
              : "Wine unavailable"
          }
          message={
            locale.currentLanguage.startsWith("zh")
              ? `“${
                  missingWineGame()?.title ?? "该游戏"
                }”选择的 Wine 已不存在或无法使用。请在 Wine 设置中下载、添加或重新选择 Wine 版本后再启动。`
              : `The Wine selected for ${
                  missingWineGame()?.title ?? "this game"
                } is missing or unavailable. Download, add, or select a Wine version in Wine Settings before launching again.`
          }
          cancelLabel={locale.get("SETTING_CANCEL")}
          settingsLabel={
            locale.currentLanguage.startsWith("zh")
              ? "打开全局 Wine 设置"
              : "Open Global Wine Settings"
          }
          alternateSettingsLabel={
            locale.currentLanguage.startsWith("zh")
              ? "打开游戏 Wine 设置"
              : "Open Game Wine Settings"
          }
          onCancel={() => setMissingWineGame()}
          onOpenAlternateSettings={() => {
            const game = missingWineGame();
            setMissingWineGame();
            if (game) void openNativeSettings(game);
          }}
          onOpenSettings={() => {
            setMissingWineGame();
            closeNativeSettings();
            setGlobalSettingsInitialTab(2);
            setGlobalModalRoute("settings");
          }}
        />

        <LaunchErrorModal
          opened={missingGameExecutableGame() != undefined}
          title={
            locale.currentLanguage.startsWith("zh")
              ? "游戏文件缺失"
              : "Game executable missing"
          }
          message={
            locale.currentLanguage.startsWith("zh")
              ? `“${
                  missingGameExecutableGame()?.title ?? "该游戏"
                }”的游戏可执行文件不存在或无法访问。请确认安装目录，或检查游戏文件完整性后再启动。`
              : `The game executable for ${
                  missingGameExecutableGame()?.title ?? "this game"
                } is missing or inaccessible. Verify the installation directory or check game file integrity before launching again.`
          }
          cancelLabel={locale.get("SETTING_CANCEL")}
          settingsLabel={
            locale.currentLanguage.startsWith("zh")
              ? "打开游戏设置"
              : "Open Game Settings"
          }
          alternateSettingsLabel={
            locale.currentLanguage.startsWith("zh")
              ? "检查完整性"
              : "Check Integrity"
          }
          onCancel={() => setMissingGameExecutableGame()}
          onOpenAlternateSettings={() => {
            const game = missingGameExecutableGame();
            setMissingGameExecutableGame();
            if (game) startCheckIntegrity(game);
          }}
          onOpenSettings={() => {
            const game = missingGameExecutableGame();
            setMissingGameExecutableGame();
            if (game) void openNativeSettings(game);
          }}
        />

        <GameCrashModal
          opened={crashedGame() != undefined}
          locale={locale}
          onIgnore={() => setCrashedGame()}
          onOpenSettings={() => {
            const game = crashedGame();
            setCrashedGame();
            if (game) void openNativeSettings(game);
          }}
        />

        <Show when={initialWineSetup()} keyed>
          {setup => {
            const recommended = resolveRecommendedWineDistro();
            return (
              <InitialWineSetupModal
                locale={locale}
                recommended={recommended}
                defaultDistro={
                  setup.distributions.find(
                    distro => distro.id === wineDistroId
                  ) ?? recommended
                }
                distributions={setup.distributions}
                onClose={() => setInitialWineSetup(undefined)}
                onConfirm={(distro, useRecommended) =>
                  startInitializeWine(
                    distro,
                    useRecommended ? setup.game : undefined
                  )
                }
              />
            );
          }}
        </Show>

        <GlobalModals
          route={globalModalRoute}
          onRouteChange={route => {
            setGlobalModalRoute(route);
            if (route != "settings") setGlobalSettingsInitialTab(0);
            if (route == null) void refreshThemeColor();
          }}
          settingsUI={GlobalConfigurationUI}
          settingsInitialTab={globalSettingsInitialTab}
          onOpenLogs={openLogs}
          actionDisabled={actionDisabled}
          locale={locale}
          channelCode={aboutChannelCode()}
          onCheckUpdate={onCheckUpdate}
        />

        <GameUninstallDialog />
      </div>
    );
  };
}
