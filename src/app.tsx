import "./app.css";
import { createSignal, onMount, Show, type JSXElement } from "solid-js";
import {
  createClient,
  DEFAULT_WINE_DISTRO_TAG,
  UPDATE_UI_IMAGE,
} from "./clients";
import { createGithubEndpoint } from "./integrations/github";
import {
  createLauncher,
  createMultiGameLauncher,
  MULTI_GAME_CN_GAME_SPECS,
} from "./launcher";
import { log } from "./logging/logger";
import { createLocale, type Locale } from "./locale";
import { CloseConfirmationModal } from "./modals/close-confirmation-modal";
import { LauncherUpdateModal } from "./modals/launcher-update-modal";
import { exit } from "./platform/neutralino/system";
import { resolve } from "./platform/neutralino/path";
import {
  _safeRelaunch,
  addTerminationHook,
  GLOBAL_onClose,
  getKeyOrDefault,
  setKey,
} from "./runtime";
import { createWindowCloseController } from "./services/window-close-controller";
import { createTaskProgressScreen } from "./tasks/task-progress-screen";
import type { TaskProgram } from "./tasks/task-program";
import { startAria2Service } from "./download/aria2-service";
import { hasActiveDownloads } from "./download/control";
import { createUpdater, downloadProgram } from "./update/updater";
import {
  checkWineEnvironment,
  createWine,
  createWineEnvironmentService,
  type Wine,
  type WineDistribution,
} from "./wine";
import {
  reportBootProgress,
  setBootProgressLocale,
} from "./boot-progress";

type LauncherWineActions = {
  initializeWine: (distro: WineDistribution) => TaskProgram;
  enableWineDistro: (distro: WineDistribution) => TaskProgram;
  uninstallWineDistro: (distro: WineDistribution) => TaskProgram;
};

/**
 * Creates application-scoped infrastructure and composes the launcher UI.
 * Domain services are constructed here so views and launcher orchestration do
 * not have to know how Neutralino processes, Wine or update UI are wired.
 */
export async function createApp() {
  reportBootProgress("BOOT_INITIALIZING", 0);
  await setKey("singleton", null);

  const locale = await createLocale();
  setBootProgressLocale(locale);
  reportBootProgress("BOOT_LOADING_LOCAL_SETTINGS", 8);
  const github = await createGithubEndpoint();
  const aria2 = await startAria2Service();
  reportBootProgress("BOOT_STARTING_DOWNLOAD_SERVICE", 26);

  const initialUpdateCheck = await createUpdater({
    github,
    aria2,
    automatic: true,
  });
  reportBootProgress("BOOT_CHECKING_LAUNCHER_UPDATE", 36);
  const ignoredVersion = await getKeyOrDefault("ignore_launcher_update", "");

  const wineStatus = await checkWineEnvironment(DEFAULT_WINE_DISTRO_TAG);
  reportBootProgress("BOOT_CHECKING_WINE_ENVIRONMENT", 48);
  const prefixPath = resolve("./wineprefix");
  const [wineInstalled, setWineInstalled] = createSignal(wineStatus.wineReady);
  const wine = await createWine({
    prefix: prefixPath,
    distro: wineStatus.wineDistribution,
  });
  const wineEnvironment = createWineEnvironmentService({
    aria2,
    wine,
    wineAbsPrefix: prefixPath,
    setWineInstalled,
  });
  reportBootProgress("BOOT_PREPARING_WINE_ENVIRONMENT", 58);

  let gameRunning = false;
  const [closePrompt, setClosePrompt] = createSignal<
    "download" | "game" | null
  >(null);
  const windowCloseController = createWindowCloseController({
    hasActiveDownloads,
    isGameRunning: () => gameRunning,
    onPromptChange: setClosePrompt,
    onBeforeExit: () => GLOBAL_onClose(false),
    hideWindow: () => Neutralino.window.hide(),
    exit: async () => exit(0),
  });

  await Neutralino.events.on("windowClose", async () => {
    await windowCloseController.requestClose();
  });
  addTerminationHook(async () => {
    if (!windowCloseController.shouldCloseGameProcessesOnExit()) {
      await log("Termination hook: leaving wine processes running by request");
      return true;
    }
    await log("Termination hook: killing wine processes");
    try {
      await wine.killAll();
    } catch (error) {
      await log(`wine.killAll failed during shutdown: ${String(error)}`);
    }
    return true;
  });

  let showPromptSignal: ((value: boolean) => void) | undefined;
  let setPendingUpdateInfoSignal:
    | ((value: typeof initialUpdateCheck) => void)
    | undefined;
  const notifyUpdateCheckFailure = async (status?: number) => {
    await locale.alert(
      "CHECK_UPDATE_FAILED",
      "CHECK_UPDATE_FAILED_DESC",
      [status == null ? "N/A" : String(status)],
      "danger"
    );
  };

  const onCheckUpdate = async () => {
    const result = await createUpdater({
      github,
      aria2,
      automatic: false,
    });
    if (result.latest === undefined) {
      await notifyUpdateCheckFailure(result.errorStatus);
      return;
    }
    if (result.latest) {
      await locale.alert("SETTING_YAAGL_VERSION", "ALREADY_LATEST_VERSION");
      return;
    }
    setPendingUpdateInfoSignal?.(result);
    showPromptSignal?.(true);
  };

  reportBootProgress("BOOT_INITIALIZING_RUNTIME", 66);
  const channel = import.meta.env.YAAGL_CHANNEL_CLIENT || "hk4ecn";
  const isMergedChannel = channel == "mhyos" || channel == "mhycn";
  const sharedLauncherProps: {
    wine: Wine;
    wineDistroId: string;
    wineInstalled: () => boolean;
    onResetWineEnv: () => Promise<void>;
    locale: Locale;
    onCheckUpdate: () => void;
    onGameRunningChange: (running: boolean) => void;
  } & LauncherWineActions = {
    wine,
    wineDistroId: wineStatus.wineDistribution.id,
    wineInstalled,
    onResetWineEnv: wineEnvironment.reset,
    initializeWine: wineEnvironment.initialize,
    enableWineDistro: wineEnvironment.enable,
    uninstallWineDistro: wineEnvironment.uninstall,
    locale,
    onCheckUpdate: () => void onCheckUpdate(),
    onGameRunningChange: running => {
      gameRunning = running;
    },
  };

  let MainApp: () => JSXElement;
  if (isMergedChannel) {
    reportBootProgress("BOOT_INITIALIZING_GAME_CLIENT", 66);
    MainApp = await createMultiGameLauncher({
      ...sharedLauncherProps,
      aria2,
      region: channel == "mhycn" ? "CN" : "OS",
      specs: channel == "mhycn" ? MULTI_GAME_CN_GAME_SPECS : undefined,
    });
  } else {
    reportBootProgress("BOOT_INITIALIZING_GAME_CLIENT", 66);
    MainApp = await createLauncher({
      ...sharedLauncherProps,
      aria2,
      channel,
      channelClient: await createClient({ wine, aria2, locale }),
    });
  }
  reportBootProgress("BOOT_COMPLETE", 100);

  return function AppRoot() {
    const [updaterComponent, setUpdaterComponent] = createSignal<
      (() => JSXElement) | undefined
    >();
    const [pendingUpdateInfo, setPendingUpdateInfo] =
      createSignal(initialUpdateCheck);
    const [showPrompt, setShowPrompt] = createSignal(
      initialUpdateCheck.latest == false &&
        ignoredVersion !== initialUpdateCheck.version
    );

    showPromptSignal = setShowPrompt;
    setPendingUpdateInfoSignal = setPendingUpdateInfo;

    onMount(() => {
      if (initialUpdateCheck.latest === undefined) {
        void notifyUpdateCheckFailure(initialUpdateCheck.errorStatus);
      }
    });

    return (
      <>
        <Show when={updaterComponent()}>{updaterComponent()!()}</Show>
        <Show when={!updaterComponent()}>
          <MainApp />
          <LauncherUpdateModal
            opened={showPrompt}
            onClose={() => setShowPrompt(false)}
            pendingUpdateInfo={pendingUpdateInfo}
            locale={locale}
            onIgnore={version => setKey("ignore_launcher_update", version)}
            onUpdate={info =>
              setUpdaterComponent(() =>
                createTaskProgressScreen({
                  locale,
                  image: UPDATE_UI_IMAGE,
                  program: () =>
                    downloadProgram(
                      aria2,
                      info.downloadUrl!,
                      info.sidecarDownloadUrl
                    ),
                  onRestart: _safeRelaunch,
                  onFailed: () => setUpdaterComponent(undefined),
                })
              )
            }
          />
        </Show>
        <CloseConfirmationModal
          prompt={closePrompt}
          locale={locale}
          resolve={windowCloseController.resolvePrompt}
        />
      </>
    );
  };
}
