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
import { CURRENT_YAAGL_VERSION } from "@constants";
import { log } from "./logging/logger";
import { createLocale, type Locale } from "./locale";
import { CloseConfirmationModal } from "./modals/close-confirmation-modal";
import { LauncherUpdateModal } from "./modals/launcher-update-modal";
import { HostsHelperTokenRecoveryModal } from "./modals/hosts-helper-token-recovery-modal";
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
import {
  cancelControlledDownload,
  hasActiveDownloads,
} from "./download/control";
import { cancelStream, getStreamsByKey } from "./download/stream-scheduler";
import {
  createUpdater,
  downloadProgram,
  getReleaseAssetsForVersion,
  isUpdateHalfApplied,
  UPDATE_DOWNLOAD_KEY,
} from "./update/updater";
import {
  getPrivilegedHostsHelperStatus,
  getPrivilegedHostsHelperTokenRecoveryState,
  isPrivilegedHostsHelperStatusRepairable,
  reRegisterPrivilegedHostsHelper,
  uninstallPrivilegedHostsHelper,
  unblockPrivilegedHosts,
  upgradePrivilegedHostsHelperIfNeeded,
} from "./system/privileged-hosts";
import {
  checkWineEnvironment,
  createWine,
  createWineEnvironmentService,
  type Wine,
  type WineDistribution,
} from "./wine";
import { reportBootProgress, setBootProgressLocale } from "./boot-progress";

type LauncherWineActions = {
  initializeWine: (distro: WineDistribution) => TaskProgram;
  enableWineDistro: (distro: WineDistribution) => TaskProgram;
  uninstallWineDistro: (distro: WineDistribution) => TaskProgram;
};

const HOSTS_HELPER_REREGISTER_KEY = "hosts_helper_reregister_after_update";

type HostsHelperReregisterMarker = {
  targetVersion: string;
  attempted: boolean;
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
  const gameCloseHandler: {
    current?: () => Promise<void>;
  } = {};
  // Tracks the launcher self-update task so the window-close flow can wait for
  // it to settle (and cancel its downloads) before exiting, the same way the
  // game-close flow stops game processes and waits for the task queue.
  let pendingUpdateTask: Promise<void> | undefined;
  let resolvePendingUpdateTask: (() => void) | undefined;
  const cancelPendingUpdate = async () => {
    for (const stream of getStreamsByKey(UPDATE_DOWNLOAD_KEY)) {
      if (
        !["completed", "error", "cancelled"].includes(stream.status) &&
        stream.canCancel
      ) {
        await cancelStream(stream.id);
      }
    }
  };
  const [closePrompt, setClosePrompt] = createSignal<
    "download" | "game" | null
  >(null);
  const windowCloseController = createWindowCloseController({
    hasActiveDownloads,
    isGameRunning: () => gameRunning,
    requestGameClose: async () => {
      await gameCloseHandler.current?.();
    },
    pendingUpdate: () => pendingUpdateTask,
    cancelPendingUpdate,
    onPromptChange: setClosePrompt,
    onBeforeExit: () => GLOBAL_onClose(false),
    hideWindow: () => Neutralino.window.hide(),
    exit: async () => exit(0),
  });

  await Neutralino.events.on("windowClose", async () => {
    await windowCloseController.requestClose();
  });
  addTerminationHook(async () => {
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
      if (result.aheadOfLatest) {
        await locale.alert("AHEAD_OF_LATEST_TITLE", "AHEAD_OF_LATEST_JOKE");
        return;
      }
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
    gameCloseHandler: { current?: () => Promise<void> };
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
    gameCloseHandler,
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
    const [showTokenRecovery, setShowTokenRecovery] = createSignal(false);
    const [tokenRecoveryBusy, setTokenRecoveryBusy] = createSignal(false);
    const [tokenRecoveryBusyText, setTokenRecoveryBusyText] = createSignal("");
    const [tokenRecoveryError, setTokenRecoveryError] = createSignal("");
    const [tokenRecoveryDescription, setTokenRecoveryDescription] =
      createSignal("");

    showPromptSignal = setShowPrompt;
    setPendingUpdateInfoSignal = setPendingUpdateInfo;

    async function handleHostsHelperStartup() {
      if (CURRENT_YAAGL_VERSION === "development") return;

      const recoveryState = await getPrivilegedHostsHelperTokenRecoveryState();
      const markerRaw = await getKeyOrDefault(HOSTS_HELPER_REREGISTER_KEY, "");

      if (recoveryState === "token-missing") {
        if (markerRaw) await setKey(HOSTS_HELPER_REREGISTER_KEY, null);
        setTokenRecoveryError("");
        setTokenRecoveryDescription(
          locale.get("SETTING_HOSTS_HELPER_TOKEN_MISSING_DESC")
        );
        setShowTokenRecovery(true);
        return;
      }

      if (recoveryState === "token-present" && markerRaw) {
        // The marker records that a launcher update just happened. Detect the
        // version registered by the installed hosts-helper daemon and upgrade
        // it only when it is older than the new build manifest. The upgrade is
        // a plain install (no --re-register), so the helper's persistent data
        // (token + registry row) is preserved.
        await setKey(HOSTS_HELPER_REREGISTER_KEY, null);
        await locale.alert(
          "SETTING_HOSTS_HELPER",
          "SETTING_HOSTS_HELPER_REREGISTERING",
          [],
          "info"
        );
        try {
          await upgradePrivilegedHostsHelperIfNeeded();
        } catch (error) {
          await log(
            `Hosts Helper upgrade after update failed: ${String(error)}`
          );
          await locale.alert(
            "SETTING_HOSTS_HELPER",
            "SETTING_HOSTS_HELPER_REREGISTER_FAILED",
            [],
            "warning"
          );
        }
      }

      // Use the full STATUS-based check so startup also catches registration
      // conflicts, a stopped daemon, and broken installs, not only a missing
      // token file.
      const status = await getPrivilegedHostsHelperStatus();
      if (!isPrivilegedHostsHelperStatusRepairable(status)) return;
      setTokenRecoveryError("");
      setTokenRecoveryDescription(
        locale.get("SETTING_HOSTS_HELPER_REPAIR_DESC")
      );
      setShowTokenRecovery(true);
    }

    async function deleteMissingTokenRegistration() {
      setTokenRecoveryBusy(true);
      setTokenRecoveryBusyText(
        locale.get("SETTING_HOSTS_HELPER_DELETE_REGISTRATION_BUSY")
      );
      setTokenRecoveryError("");
      try {
        // Best-effort cleanup. Missing token normally makes this request fail
        // before it reaches the daemon, but it must not block authorized
        // registry deletion.
        try {
          await unblockPrivilegedHosts();
        } catch (error) {
          await log(
            `Hosts Helper unblock before token recovery failed: ${String(
              error
            )}`
          );
        }
        await uninstallPrivilegedHostsHelper();
        await setKey(HOSTS_HELPER_REREGISTER_KEY, null);
        setShowTokenRecovery(false);
        await locale.alert(
          "SETTING_HOSTS_HELPER",
          "SETTING_HOSTS_HELPER_DELETE_REGISTRATION_SUCCESS",
          [],
          "success"
        );
      } catch (error) {
        await log(
          `Hosts Helper token recovery uninstall failed: ${String(error)}`
        );
        setTokenRecoveryError(
          locale.get("SETTING_HOSTS_HELPER_DELETE_REGISTRATION_AUTH_REQUIRED")
        );
      } finally {
        setTokenRecoveryBusy(false);
      }
    }

    async function repairHostsHelperRegistration() {
      setTokenRecoveryBusy(true);
      setTokenRecoveryBusyText(
        locale.get("SETTING_HOSTS_HELPER_REREGISTERING")
      );
      setTokenRecoveryError("");
      try {
        await reRegisterPrivilegedHostsHelper();
        await setKey(HOSTS_HELPER_REREGISTER_KEY, null);
        setShowTokenRecovery(false);
        await locale.alert(
          "SETTING_HOSTS_HELPER",
          "SETTING_HOSTS_HELPER_REREGISTER_SUCCESS",
          [],
          "success"
        );
      } catch (error) {
        await log(`Hosts Helper startup repair failed: ${String(error)}`);
        setTokenRecoveryError(
          locale.get("SETTING_HOSTS_HELPER_REREGISTER_FAILED")
        );
      } finally {
        setTokenRecoveryBusy(false);
      }
    }

    function startUpdateFlow(
      assets: { downloadUrl: string; sidecarDownloadUrl?: string },
      targetVersion?: string
    ) {
      if (targetVersion && CURRENT_YAAGL_VERSION !== "development") {
        void setKey(
          HOSTS_HELPER_REREGISTER_KEY,
          JSON.stringify({
            targetVersion,
            attempted: false,
          } satisfies HostsHelperReregisterMarker)
        );
      }
      pendingUpdateTask = new Promise<void>(resolve => {
        resolvePendingUpdateTask = resolve;
      });
      const updateAbort = new AbortController();
      setUpdaterComponent(() =>
        createTaskProgressScreen({
          locale,
          image: UPDATE_UI_IMAGE,
          program: () =>
            downloadProgram(
              aria2,
              assets.downloadUrl,
              assets.sidecarDownloadUrl,
              updateAbort.signal
            ),
          onRestart: _safeRelaunch,
          onFailed: () => setUpdaterComponent(undefined),
          onCancel: () => {
            void cancelControlledDownload(UPDATE_DOWNLOAD_KEY);
            updateAbort.abort();
          },
          onCancelled: () => setUpdaterComponent(undefined),
          onSettled: () => {
            resolvePendingUpdateTask?.();
            resolvePendingUpdateTask = undefined;
            pendingUpdateTask = undefined;
          },
        })
      );
    }

    onMount(() => {
      void (async () => {
        try {
          await handleHostsHelperStartup();
        } catch (error) {
          await log(
            `Hosts Helper startup recovery check failed: ${String(error)}`
          );
        }
        if (initialUpdateCheck.latest === undefined) {
          await notifyUpdateCheckFailure(initialUpdateCheck.errorStatus);
          return;
        }
        // No newer release available, but a previous (older, buggy) hot update
        // may have left this install half-applied: the frontend is already the
        // current version while the bundle/sidecar/manifest are still the old
        // one. Re-apply the current release automatically so the install is
        // repaired in one go.
        if (
          initialUpdateCheck.latest &&
          (await isUpdateHalfApplied())
        ) {
          const assets = await getReleaseAssetsForVersion(
            github,
            CURRENT_YAAGL_VERSION
          );
          if (assets?.sidecarDownloadUrl) {
            await log(
              "Re-applying current release to repair a half-applied update"
            );
            startUpdateFlow(assets, CURRENT_YAAGL_VERSION);
          } else {
            await log(
              "Half-applied update detected but release assets are unavailable; skipping auto-repair"
            );
          }
        }
      })();
    });

    return (
      <>
        <Show when={updaterComponent()}>{updaterComponent()!()}</Show>
        <Show when={!updaterComponent()}>
          <MainApp />
          <LauncherUpdateModal
            opened={() => showPrompt() && !showTokenRecovery()}
            onClose={() => setShowPrompt(false)}
            pendingUpdateInfo={pendingUpdateInfo}
            locale={locale}
            onIgnore={version => setKey("ignore_launcher_update", version)}
            onUpdate={info => {
              startUpdateFlow(
                {
                  downloadUrl: info.downloadUrl!,
                  sidecarDownloadUrl: info.sidecarDownloadUrl,
                },
                info.version
              );
            }}
          />
        </Show>
        <HostsHelperTokenRecoveryModal
          opened={showTokenRecovery}
          busy={tokenRecoveryBusy}
          error={tokenRecoveryError}
          description={tokenRecoveryDescription}
          busyText={tokenRecoveryBusyText}
          locale={locale}
          onClose={() => setShowTokenRecovery(false)}
          onRepair={repairHostsHelperRegistration}
          onDelete={deleteMissingTokenRegistration}
        />
        <CloseConfirmationModal
          prompt={closePrompt}
          locale={locale}
          resolve={windowCloseController.resolvePrompt}
        />
      </>
    );
  };
}
