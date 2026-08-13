import { Aria2 } from "@aria2";
import { CommonUpdateProgram } from "@common-update-ui";
import { createConfiguration } from "@config";
import { Locale } from "@locale";
import {
  activateStorageNamespace,
  exec2,
  fatal,
  getKeyOrDefault,
  log,
  openDir,
  setKey,
  withStorageNamespace,
} from "@utils";
import { getWineDistributions, Wine, WineDistribution } from "@wine";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Progress,
  ProgressIndicator,
  Text,
} from "@hope-ui/solid";
import {
  Accessor,
  For,
  JSXElement,
  Show,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import type { JSX } from "solid-js";
import { createGameInstallationDirectorySanitizer } from "../accidental-complexity";
import { ChannelClient } from "../channel-client";
import { Config } from "../config/config-def";
import { createGameUninstallDialog } from "../config/game-uninstall-dialog";
import { GAME_BANNER_URLS } from "./game-assets";
import { GameLibraryView, GameLibraryItem } from "./game-library";
import { getThemeColorHex, getContrastText } from "../utils/theme-color";
import { createConcurrentTaskQueueState, GLOBAL_TASK_KEY } from "./task-queue";
import { ensureMultiGameGameWine, MultiGameWineRef } from "./multi-game-wine";
import { createLogViewer } from "../log-viewer";
import {
  DownloadControlState,
  getDownloadControlState,
  pauseControlledDownload,
  resumeControlledDownload,
  subscribeDownloadControl,
} from "../download-control";

export type HoyoplayGameWineOption = {
  tag: string;
  displayName: string;
  url: string;
};

export type HoyoplayGame = {
  id: string;
  namespace?: string;
  title: string;
  fallbackIcon: string;
  iconImage?: string;
  serverLabel: string;
  client: ChannelClient;
  config: Config;
  ConfigurationUI: (props: {
    opened: boolean;
    onClose: (action: "check-integrity" | "close") => void;
    onOpenLogs: () => void;
    actionDisabled: () => boolean;
  }) => JSXElement;
  wineRef?: MultiGameWineRef;
  wineTag?: Accessor<string>;
  setWineTag?: (value: string) => void;
  wineOptions?: HoyoplayGameWineOption[];
};

export type HoyoplayLauncherOptions = {
  games: HoyoplayGame[];
  showLibrary: boolean;
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  locale: Locale;
  aria2: Aria2;
  onCheckUpdate: () => void;
  onGameRunningChange?: (running: boolean) => void;
  onResetWineEnv: () => Promise<void>;
  initializeWine: (distro: WineDistribution) => CommonUpdateProgram;
  enableWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
  uninstallWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
  actionDisabledRef?: { current: () => boolean };
};

// Multi-game programs run with a per-game Wine and namespace. Single-game
// channels run directly against the launcher-wide Wine and global storage, so
// they keep their existing install directory and settings.
function gameProgram(
  aria2: Aria2,
  baseWine: Wine,
  game: HoyoplayGame,
  program: () => CommonUpdateProgram
): () => CommonUpdateProgram {
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

export async function createHoyoplayLauncher({
  games,
  showLibrary,
  wine,
  wineDistroId,
  wineInstalled,
  locale,
  aria2,
  onCheckUpdate,
  onGameRunningChange,
  onResetWineEnv,
  initializeWine,
  enableWineDistro,
  uninstallWineDistro,
  actionDisabledRef,
}: HoyoplayLauncherOptions) {
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
    ? await getKeyOrDefault("hoyoplay_last_view", "")
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
  const { UI: GlobalConfigurationUI } = await createConfiguration({
    wine: baseWine,
    wineDistroId,
    wineInstalled,
    locale,
    gameInstallDir: () => games[selectedGameIndex()]?.client.installDir() ?? "",
    configForChannelClient: async () => () => null,
    onCheckUpdate,
    actionDisabled: () => _actionDisabled(),
    onEnableWineDistro: (distro, onDone) =>
      requestWineDistroEnable(distro, onDone),
    onUninstallWineDistro: (distro, onDone) =>
      requestWineDistroUninstall(distro, onDone),
    onWineDistroInitialized: onDone => {
      notifyWineDistroInitialized = onDone;
    },
    onResetWineEnv,
    scope: "global",
    modalTitle: () => locale.get("SETTING_GLOBAL"),
  });

  const { selectPath } = await createGameInstallationDirectorySanitizer({
    openFolderDialog: async () =>
      await openDir(locale.get("SELECT_INSTALLATION_DIR")),
    locale,
  });

  async function clearGameState(game: HoyoplayGame) {
    const clear = async () => {
      await setKey("game_install_dir", null);
      await game.client.changeInstallDir?.("");
    };
    if (game.namespace) {
      await withStorageNamespace(game.namespace, clear);
    } else {
      await clear();
    }
  }

  const { UI: GameUninstallDialog, open: openGameUninstallDialog } =
    await createGameUninstallDialog({
      locale,
      gameInstallDir: () =>
        games[selectedGameIndex()]?.client.installDir() ?? "",
      onUninstall: async () => {
        const game = games[selectedGameIndex()];
        if (!game) return;
        await clearGameState(game);
      },
      actionDisabled: () => _actionDisabled(),
    });

  function launchProgram(game: HoyoplayGame): CommonUpdateProgram {
    return (async function* () {
      yield* game.client.launch(
        game.config.advancedEnable
          ? game.config
          : { ...game.config, reshade: false, metalFxEnable: false }
      );
    })();
  }

  const initialThemeHex = await getThemeColorHex();
  const [themeHex, setThemeHex] = createSignal(initialThemeHex);
  const themeText = () => getContrastText(themeHex());
  async function refreshThemeColor() {
    setThemeHex(await getThemeColorHex());
  }

  return function HoyoplayLauncher() {
    const selectedGame = () => games[selectedGameIndex()];
    const [libraryOpen, setLibraryOpen] = createSignal(
      showLibrary && (!anyInstalled || lastView === "library")
    );
    const installedGames = () =>
      games
        .map((game, index) => ({ game, index }))
        .filter(({ game }) => game.client.installState() === "INSTALLED");
    const sidebarGames = () =>
      showLibrary
        ? installedGames()
        : games.map((game, index) => ({ game, index }));
    const libraryItems = () =>
      games.map(
        game =>
          ({
            id: game.id,
            title: game.title,
            iconUrl:
              game.iconImage ??
              game.client.uiContent.iconImage ??
              game.fallbackIcon,
            bannerUrl: GAME_BANNER_URLS[game.id] ?? "",
            serverLabel: game.serverLabel,
            installed: game.client.installState() === "INSTALLED",
          } satisfies GameLibraryItem)
      );
    const [nativeSettingsGame, setNativeSettingsGame] =
      createSignal<HoyoplayGame>();
    const [globalSettingsOpen, setGlobalSettingsOpen] = createSignal(false);
    const [updatePromptGame, setUpdatePromptGame] =
      createSignal<HoyoplayGame>();
    const [videoLoaded, setVideoLoaded] = createSignal(false);
    const [gameRunningByKey, setGameRunningByKey] = createSignal<
      Record<string, boolean>
    >({});
    let restoreNativeSettingsNamespace: (() => void) | undefined;
    const taskQueue = createConcurrentTaskQueueState({
      locale,
      onStateKey: (key, stateKey) => {
        if (key === GLOBAL_TASK_KEY) return;
        const running = stateKey == "GAME_RUNNING";
        setGameRunningByKey(prev => ({ ...prev, [key]: running }));
        const next = { ...gameRunningByKey(), [key]: running };
        onGameRunningChange?.(Object.values(next).some(Boolean));
      },
    });
    const selectedGameTaskState = createMemo(() =>
      taskQueue.getState(selectedGame().id)
    );
    const downloadControlKey = (game: HoyoplayGame) => game.namespace ?? "";
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
    const { LogViewer, openLogs } = createLogViewer(locale);
    const ringCircumference = 2 * Math.PI * 15.5;

    function actionDisabled() {
      const download = selectedDownloadControl();
      if (download.active) {
        return download.actionPending || !download.canPause;
      }
      return (
        selectedGameTaskState().busy() ||
        taskQueue.getState(GLOBAL_TASK_KEY).busy() ||
        anyGameRunning()
      );
    }

    if (actionDisabledRef) {
      actionDisabledRef.current = actionDisabled;
    }
    _actionDisabled = actionDisabled;
    requestWineDistroEnable = (distro, onDone) => {
      if (actionDisabled()) return;
      closeNativeSettings();
      setGlobalSettingsOpen(false);
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
      setGlobalSettingsOpen(false);
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
      setGlobalSettingsOpen(false);
      taskQueue.enqueue({
        fn: async function* () {
          yield* initializeWine(initialWineDistro);
          notifyWineDistroInitialized(initialWineDistro);
        },
        name: "INIT_ENVIRONMENT",
      });
    }

    async function onPrimaryAction() {
      const download = selectedDownloadControl();
      if (download.active) {
        if (!download.canPause) return;
        if (download.pauseRequested) {
          await resumeControlledDownload(selectedGame().namespace);
        } else {
          await pauseControlledDownload(selectedGame().namespace);
        }
        return;
      }
      if (selectedGameTaskState().busy()) return;
      const game = selectedGame();
      if (!wineInstalled()) {
        startInitializeWine();
        return;
      }
      if (game.client.installState() == "INSTALLED") {
        if (game.client.updateRequired()) {
          await log("Game update requested");
          taskQueue.enqueue({
            key: game.id,
            fn: gameProgram(aria2, baseWine, game, () => game.client.update()),
            name: "UPDATE",
          });
        } else {
          await log("Game launch requested");
          taskQueue.enqueue({
            key: game.id,
            fn: gameProgram(aria2, baseWine, game, () => launchProgram(game)),
            name: "LAUNCH",
          });
        }
      } else {
        const selection = await selectPath();
        if (!selection) return;
        await log(`Game installation requested: ${selection}`);
        taskQueue.enqueue({
          key: game.id,
          fn: gameProgram(aria2, baseWine, game, () =>
            game.client.install(selection)
          ),
          name: "INSTALL",
        });
      }
    }

    function actionLabel(game: HoyoplayGame) {
      if (game.client.installState() !== "INSTALLED")
        return locale.get("INSTALL");
      if (!game.client.updateRequired()) return locale.get("LAUNCH");
      return locale.get("UPDATE");
    }

    function displayGameVersion(game: HoyoplayGame) {
      const version = game.client.gameVersion?.() ?? "0.0.0";
      return version == "0.0.0"
        ? locale.get("SETTING_GAME_VERSION_NOT_INSTALLED")
        : version;
    }

    function startCheckIntegrity(game: HoyoplayGame) {
      // Before checking integrity, check for game updates automatically. If a
      // new version is available, ask the user whether to install it first.
      if (game.client.updateRequired()) {
        setUpdatePromptGame(game);
      } else {
        taskQueue.enqueue({
          key: game.id,
          fn: gameProgram(aria2, baseWine, game, () =>
            game.client.checkIntegrity()
          ),
          name: "SETTING_CHECK_INTEGRITY",
        });
      }
    }

    function primaryButtonLabel() {
      const download = selectedDownloadControl();
      if (download.active) {
        return download.pauseRequested
          ? locale.get("RESUME_DOWNLOAD")
          : locale.get("PAUSE_DOWNLOAD");
      }
      if (!wineInstalled()) return locale.get("INIT_ENVIRONMENT");
      return actionLabel(selectedGame());
    }

    function selectGame(index: number) {
      const game = games[index];
      setSelectedGameIndex(index);
      setVideoLoaded(false);
      setLibraryOpen(false);
      if (showLibrary && game) {
        void setKey("hoyoplay_last_view", game.id);
      }
    }

    function onPredownload() {
      const game = selectedGame();
      taskQueue.enqueue({
        key: game.id,
        fn: gameProgram(aria2, baseWine, game, () => game.client.predownload()),
        name: "PREDOWNLOAD_READY",
      });
    }

    async function openNativeSettings(game: HoyoplayGame) {
      restoreNativeSettingsNamespace?.();
      if (game.namespace) {
        restoreNativeSettingsNamespace = await activateStorageNamespace(
          game.namespace
        );
      }
      setNativeSettingsGame(game);
    }

    function closeNativeSettings() {
      restoreNativeSettingsNamespace?.();
      restoreNativeSettingsNamespace = undefined;
      setNativeSettingsGame(undefined);
    }

    return (
      <div
        class="hoyoplay-shell"
        style={{
          "background-image": selectedGame().client.uiContent.background
            ? `url(${selectedGame().client.uiContent.background})`
            : undefined,
        }}
      >
        <Show when={selectedGame().client.uiContent.background_video}>
          <video
            class="hoyoplay-video"
            src={selectedGame().client.uiContent.background_video}
            autoplay
            loop
            muted
            playsinline
            onLoadedData={() => setVideoLoaded(true)}
            style={{ opacity: videoLoaded() ? 1 : 0 }}
          />
        </Show>
        <Show when={selectedGame().client.uiContent.background_theme}>
          <div
            class="hoyoplay-theme"
            style={{
              "background-image": `url(${
                selectedGame().client.uiContent.background_theme
              })`,
            }}
          />
        </Show>

        <aside class="hoyoplay-game-rail">
          <button class="hoyoplay-orbit-button" aria-label="Yaagl">
            <span />
          </button>
          <div class="hoyoplay-game-icons">
            <For each={sidebarGames()}>
              {entry => (
                <button
                  classList={{
                    "hoyoplay-game-icon": true,
                    active: selectedGameIndex() === entry.index,
                  }}
                  aria-label={entry.game.title}
                  onClick={() => selectGame(entry.index)}
                >
                  <img
                    src={
                      entry.game.iconImage ??
                      entry.game.client.uiContent.iconImage ??
                      entry.game.fallbackIcon
                    }
                    alt=""
                  />
                </button>
              )}
            </For>
          </div>
          <Show when={showLibrary}>
            <button
              classList={{
                "hoyoplay-rail-button": true,
                "hoyoplay-library-button": true,
                active: libraryOpen(),
              }}
              aria-label="游戏库"
              title="游戏库"
              onClick={() => {
                const next = !libraryOpen();
                setLibraryOpen(next);
                if (next) {
                  void setKey("hoyoplay_last_view", "library");
                }
              }}
            >
              <span class="hoyoplay-library-icon" />
            </button>
          </Show>
          <div class="hoyoplay-rail-bottom">
            <button
              class="hoyoplay-rail-button"
              aria-label="Global settings"
              title="Global settings"
              onClick={() => setGlobalSettingsOpen(true)}
            >
              <span class="hoyoplay-gear-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
            </button>
          </div>
        </aside>

        <main class="hoyoplay-stage" aria-label={selectedGame().title}>
          <Show when={libraryOpen()}>
            <GameLibraryView
              games={libraryItems()}
              onSelect={index => {
                selectGame(index);
              }}
            />
          </Show>
        </main>

        <Show when={!libraryOpen()}>
          <section class="hoyoplay-action-area">
            <Show
              when={
                selectedGameTaskState().busy() &&
                !selectedDownloadControl().active
              }
            >
              <div class="hoyoplay-progress">
                <strong>{selectedGameTaskState().statusText()}</strong>
                <Progress
                  value={selectedGameTaskState().progress()}
                  indeterminate={
                    selectedGameTaskState().progress() === 0 ||
                    selectedGameRunning()
                  }
                  size="sm"
                  borderRadius={8}
                >
                  <ProgressIndicator
                    style={"transition: none;"}
                    borderRadius={8}
                  />
                </Progress>
              </div>
            </Show>
            <div class="hoyoplay-action-group">
              <Show when={selectedGameTaskState().statusArgs()}>
                {args => {
                  const status = args();
                  if (status.key !== "DOWNLOADING_FILE_PROGRESS") return null;
                  const [file, speed, downloaded, total, percent] = status.args;
                  return (
                    <div class="hoyoplay-download-details">
                      <div class="hoyoplay-download-file" title={file}>
                        {file}
                      </div>
                      <div class="hoyoplay-download-meta">
                        <span>
                          {downloaded} / {total} ({percent}%)
                        </span>
                        <span>{speed}</span>
                      </div>
                    </div>
                  );
                }}
              </Show>
              <Show
                when={
                  selectedGame().client.showPredownloadPrompt() &&
                  !selectedGameTaskState().busy() &&
                  wineInstalled()
                }
              >
                <button
                  class="hoyoplay-secondary-button"
                  onClick={onPredownload}
                >
                  {locale.format("PREDOWNLOAD_READY", [
                    selectedGame().client.predownloadVersion(),
                  ])}
                </button>
              </Show>
              <button
                class="hoyoplay-primary-button"
                disabled={actionDisabled()}
                onClick={() => onPrimaryAction().catch(fatal)}
                style={
                  {
                    "--hoyoplay-accent": themeHex(),
                    "--hoyoplay-accent-text": themeText(),
                  } as JSX.CSSProperties
                }
              >
                <Show when={selectedDownloadControl().active}>
                  <span class="hoyoplay-ring">
                    <svg viewBox="0 0 36 36">
                      <circle
                        class="hoyoplay-ring-bg"
                        cx="18"
                        cy="18"
                        r="15.5"
                      />
                      <circle
                        class="hoyoplay-ring-fg"
                        cx="18"
                        cy="18"
                        r="15.5"
                        style={{
                          "stroke-dasharray": String(ringCircumference),
                          "stroke-dashoffset": String(
                            ringCircumference *
                              (1 - selectedGameTaskState().progress() / 100)
                          ),
                        }}
                      />
                    </svg>
                    <span class="hoyoplay-ring-text">
                      {Math.round(selectedGameTaskState().progress())}%
                    </span>
                  </span>
                </Show>
                <span class="hoyoplay-action-copy">
                  <span>{primaryButtonLabel()}</span>
                </span>
              </button>
            </div>
            <Popover placement="top-end">
              {({ onClose }) => (
                <>
                  <PopoverTrigger
                    class="hoyoplay-menu-button"
                    aria-label={locale.get("SETTING_QUICK_ACTIONS")}
                    title={locale.get("SETTING_QUICK_ACTIONS")}
                  >
                    <span class="hoyoplay-settings-icon" />
                  </PopoverTrigger>
                  <PopoverContent class="hoyoplay-menu-popover-content">
                    <PopoverBody class="hoyoplay-menu-popover-body">
                      <div class="hoyoplay-menu-popover">
                        <div class="hoyoplay-menu-version">
                          <span>{locale.get("GAME_VERSION")}</span>
                          <strong>{displayGameVersion(selectedGame())}</strong>
                        </div>
                        <button
                          class="hoyoplay-menu-item"
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
                          class="hoyoplay-menu-item"
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
                          class="hoyoplay-menu-item"
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
                        <div class="hoyoplay-menu-divider" />
                        <button
                          class="hoyoplay-menu-item"
                          onClick={() => {
                            openNativeSettings(selectedGame());
                            onClose();
                          }}
                        >
                          {locale.get("SETTING")}
                        </button>
                        <button
                          class="hoyoplay-menu-item"
                          onClick={() => {
                            openLogs();
                            onClose();
                          }}
                        >
                          {locale.get("LOG_VIEWER_OPEN_ACTION")}
                        </button>
                      </div>
                    </PopoverBody>
                  </PopoverContent>
                </>
              )}
            </Popover>
          </section>
        </Show>

        <Show when={nativeSettingsGame()}>
          {game => {
            const UI = game().ConfigurationUI;
            return (
              <UI
                opened
                onOpenLogs={openLogs}
                actionDisabled={actionDisabled}
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

        <Modal
          opened={!!updatePromptGame()}
          onClose={() => setUpdatePromptGame()}
          scrollBehavior="inside"
        >
          <ModalOverlay />
          <Show when={updatePromptGame()}>
            {game => {
              const savedGame = game();
              return (
                <ModalContent>
                  <ModalHeader>
                    {locale.get("SETTING_GAME_UPDATE_AVAILABLE")}
                  </ModalHeader>
                  <ModalBody>
                    <Text style={{ "white-space": "pre-wrap" }}>
                      {locale.get("SETTING_GAME_UPDATE_AVAILABLE_DESC")}
                    </Text>
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      variant="ghost"
                      mr="$3"
                      onClick={() => {
                        const target = savedGame;
                        setUpdatePromptGame();
                        // Declined the update: still run the requested
                        // integrity check.
                        taskQueue.enqueue({
                          key: target.id,
                          fn: gameProgram(aria2, baseWine, target, () =>
                            target.client.checkIntegrity()
                          ),
                          name: "SETTING_CHECK_INTEGRITY",
                        });
                      }}
                    >
                      {locale.get("SETTING_CANCEL_INSTALL")}
                    </Button>
                    <Button
                      onClick={() => {
                        const target = savedGame;
                        setUpdatePromptGame();
                        taskQueue.enqueue({
                          key: target.id,
                          fn: gameProgram(aria2, baseWine, target, () =>
                            target.client.update()
                          ),
                          name: "UPDATE",
                        });
                      }}
                    >
                      {locale.get("SETTING_CONFIRM_INSTALL")}
                    </Button>
                  </ModalFooter>
                </ModalContent>
              );
            }}
          </Show>
        </Modal>

        <GlobalConfigurationUI
          opened={globalSettingsOpen()}
          onOpenLogs={openLogs}
          actionDisabled={actionDisabled}
          onClose={action => {
            setGlobalSettingsOpen(false);
            void refreshThemeColor();
          }}
        />

        <GameUninstallDialog />
        <LogViewer />
      </div>
    );
  };
}
