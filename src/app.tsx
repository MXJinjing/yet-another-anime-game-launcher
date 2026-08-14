import {
  exec,
  log,
  spawn,
  timeout,
  resolve,
  appendFile,
  addTerminationHook,
  GLOBAL_onClose,
  setKey,
  getKeyOrDefault,
  exit,
  rawString,
} from "./utils";
import { createAria2Retry } from "./aria2";
import {
  checkWine,
  configureWineEnvironmentProgram,
  createWine,
  installWineEnvironmentProgram,
  isWineDistroInstalled,
  uninstallWineDistro as uninstallWineDistroFiles,
} from "./wine";
import type { Wine, WineDistribution } from "./wine";
import type { Locale } from "./locale";
import type { CommonUpdateProgram } from "./common-update-ui";
import { createGithubEndpoint } from "./github";
import { createLauncher } from "./launcher";
import { createMultiGameLauncher } from "./launcher/multi-game";
import { MULTI_GAME_CN_GAME_SPECS } from "./launcher/multi-game-cn";
import "./app.css";
import { createUpdater, downloadProgram } from "./updater";
import { createCommonUpdateUI } from "./common-update-ui";
import { createLocale } from "./locale";
import { createClient } from "./clients";
import { createSignal, Show, JSXElement } from "solid-js";
import { reportBootProgress } from "./boot-progress";
import { AppModal, AppModalButton } from "./components/app-modal";
import { hasActiveDownloads } from "./download-control";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Text,
} from "@hope-ui/solid";

export async function createApp() {
  reportBootProgress("正在初始化", 0);
  await setKey("singleton", null);

  const aria2_port = 6868;

  const locale = await createLocale();
  reportBootProgress("正在加载本地设置", 8);
  const github = await createGithubEndpoint();
  reportBootProgress("正在检查网络连接", 14);
  const aria2_session = resolve("./aria2.session");
  await appendFile(aria2_session, "");
  const pid = (await exec(["echo", rawString("$PPID")])).stdOut.split("\n")[0];
  const { pid: apid } = await spawn([
    "./sidecar/aria2/aria2c",
    "-d",
    "/",
    "--no-conf",
    "--enable-rpc",
    `--rpc-listen-port=${aria2_port}`,
    `--rpc-listen-all=true`,
    `--rpc-allow-origin-all`,
    `--input-file`,
    `${aria2_session}`,
    `--save-session`,
    `${aria2_session}`,
    `--pause`,
    `true`,
    "--stop-with-process",
    pid,
  ]);
  addTerminationHook(async () => {
    // double insurance (esp. for self restart)
    await log("killing process " + apid);
    try {
      await exec(["kill", apid + ""]);
    } catch {
      await log("killing process failed?");
    }
    return true;
  });
  const aria2 = await Promise.race([
    createAria2Retry({ host: "127.0.0.1", port: aria2_port }),
    timeout(15000),
  ]).catch(() =>
    Promise.reject(
      new Error(
        "Failed to start download service. Please restart the application."
      )
    )
  );
  await log(`Launched aria2 version ${aria2.version.version}`);
  reportBootProgress("正在启动下载服务", 26);
  const initialUpdateCheck = await createUpdater({
    github,
    aria2,
  });
  reportBootProgress("正在检查启动器更新", 36);

  const ignoredVersion = await getKeyOrDefault("ignore_launcher_update", "");

  const wineStatus = await checkWine(github);
  reportBootProgress("正在检测 Wine 环境", 48);
  const prefixPath = resolve("./wineprefix"); // CHECK: hardcoded path?

  let showPromptSignal: (v: boolean) => void;
  let setPendingUpdateInfoSignal: (v: any) => void;

  const onCheckUpdate = async () => {
    const result = await createUpdater({ github, aria2 });
    if (result.latest) {
      await locale.alert("SETTING_YAAGL_VERSION", "ALREADY_LATEST_VERSION");
    } else {
      if (setPendingUpdateInfoSignal && showPromptSignal) {
        setPendingUpdateInfoSignal(result);
        showPromptSignal(true);
      }
    }
  };

  const [wineInstalled, setWineInstalled] = createSignal(wineStatus.wineReady);
  const wine = await createWine({
    prefix: prefixPath,
    distro: wineStatus.wineDistribution,
  });
  reportBootProgress("正在准备 Wine 环境", 58);

  async function resetWineEnv() {
    await wine.killAll();
    await exec(["rm", "-rf", prefixPath]);
    setWineInstalled(false);
  }
  let gameRunning = false;
  let closeGameProcessesOnExit = true;
  let handlingWindowClose = false;

  // Shared AppModal-based close confirmation, reused for both "a download is
  // still running" and "a game is still running". `closePrompt` holds which
  // confirmation is currently shown; the windowClose handler awaits the
  // resolved decision. While it is pending, handlingWindowClose stays true so
  // further close clicks are ignored.
  const [closePrompt, setClosePrompt] = createSignal<
    "download" | "game" | null
  >(null);
  let closePromptResolve:
    | ((decision: "EXIT" | "CANCEL" | "CLOSE_GAME" | "KEEP_GAME") => void)
    | undefined;

  function waitForClosePrompt(
    kind: "download" | "game"
  ): Promise<"EXIT" | "CANCEL" | "CLOSE_GAME" | "KEEP_GAME"> {
    return new Promise(resolve => {
      closePromptResolve = resolve;
      setClosePrompt(kind);
    });
  }

  function resolveClosePrompt(
    decision: "EXIT" | "CANCEL" | "CLOSE_GAME" | "KEEP_GAME"
  ) {
    setClosePrompt(null);
    closePromptResolve?.(decision);
    closePromptResolve = undefined;
  }

  await Neutralino.events.on("windowClose", async () => {
    if (handlingWindowClose) return;
    handlingWindowClose = true;
    let shouldExit = false;
    try {
      closeGameProcessesOnExit = true;
      if (hasActiveDownloads()) {
        const decision = await waitForClosePrompt("download");
        if (decision == "CANCEL") return;
      }
      if (gameRunning) {
        const decision = await waitForClosePrompt("game");
        if (decision == "CANCEL") return;
        closeGameProcessesOnExit = decision == "CLOSE_GAME";
      }
      shouldExit = await GLOBAL_onClose(false);
      if (shouldExit) {
        await Neutralino.window.hide();
        exit(0);
      }
    } finally {
      if (!shouldExit) {
        closeGameProcessesOnExit = true;
        handlingWindowClose = false;
      }
    }
  });
  // Teardown safety net: when the launcher closes (window close button,
  // Cmd-Q, or kill) we must tear down the wine prefix's process tree.
  // Without this, a hung game launch or force-kill can leave
  // services.exe / winedevice.exe / rpcss.exe attached to the prefix,
  // which causes the NEXT launch to hang indefinitely at "PATCHING"
  // because wineserver refuses to enter the prefix while ghosts are alive.
  // Must run BEFORE the aria2 termination hook (hooks fire in reverse
  // LIFO order; we push this hook AFTER aria2's, so it fires first
  // while aria2 is still available — though wine.killAll does not
  // require aria2, ordering is safest this way).
  addTerminationHook(async () => {
    if (!closeGameProcessesOnExit) {
      await log("Termination hook: leaving wine processes running by request");
      return true;
    }
    await log("Termination hook: killing wine processes");
    try {
      await wine.killAll();
    } catch (e) {
      await log(`wine.killAll failed during shutdown: ${String(e)}`);
    }
    return true;
  });
  reportBootProgress("正在初始化运行环境", 66);
  const channel = import.meta.env.YAAGL_CHANNEL_CLIENT || "hk4ecn";
  const isMergedChannel = channel == "yaaglos" || channel == "yaaglcn";
  let MainApp: () => JSXElement;
  const sharedLauncherProps: {
    wine: Wine;
    wineDistroId: string;
    wineInstalled: () => boolean;
    onResetWineEnv: () => Promise<void>;
    initializeWine: (distro: WineDistribution) => CommonUpdateProgram;
    enableWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
    uninstallWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
    locale: Locale;
    onCheckUpdate: () => void;
    onGameRunningChange?: (running: boolean) => void;
  } = {
    wine,
    wineDistroId: wineStatus.wineDistribution.id,
    wineInstalled,
    onResetWineEnv: resetWineEnv,
    initializeWine: async function* (wineDistro) {
      yield* installWineEnvironmentProgram({
        aria2,
        wineAbsPrefix: prefixPath,
        wineDistro,
        activate: false,
        finishMessage: false,
      });
      yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
      yield ["setUndeterminedProgress"];
      yield* configureWineEnvironmentProgram({
        aria2,
        wineAbsPrefix: prefixPath,
        wineDistro,
      });
      await wine.setDistribution(wineDistro);
      setWineInstalled(true);
    },
    enableWineDistro: async function* (wineDistro) {
      const installed = await isWineDistroInstalled(wineDistro.id);
      if (!installed) {
        yield* installWineEnvironmentProgram({
          aria2,
          wineAbsPrefix: prefixPath,
          wineDistro,
          activate: false,
          finishMessage: false,
        });
      }
      yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
      yield ["setUndeterminedProgress"];
      yield* configureWineEnvironmentProgram({
        aria2,
        wineAbsPrefix: prefixPath,
        wineDistro,
      });
      await wine.setDistribution(wineDistro);
      setWineInstalled(true);
    },
    uninstallWineDistro: async function* (wineDistro) {
      yield ["setStateText", "UNINSTALLING_ENVIRONMENT"];
      yield ["setUndeterminedProgress"];
      await uninstallWineDistroFiles(wineDistro.id);
      yield ["setStateText", "INSTALL_DONE"];
    },
    locale,
    onCheckUpdate,
    onGameRunningChange: running => {
      gameRunning = running;
    },
  };
  if (isMergedChannel) {
    reportBootProgress("正在初始化游戏客户端", 66);
    MainApp = await createMultiGameLauncher({
      ...sharedLauncherProps,
      aria2,
      specs: channel == "yaaglcn" ? MULTI_GAME_CN_GAME_SPECS : undefined,
    });
  } else {
    reportBootProgress("正在初始化游戏客户端", 66);
    MainApp = await createLauncher({
      ...sharedLauncherProps,
      aria2,
      channel,
      channelClient: await createClient({
        wine,
        aria2,
        locale,
      }),
    });
  }
  reportBootProgress("初始化完成", 100);

  return function AppRoot() {
    const [updaterComponent, setUpdaterComponent] =
      createSignal<() => JSXElement>();
    const [pendingUpdateInfo, setPendingUpdateInfo] =
      createSignal(initialUpdateCheck);
    const [showPrompt, setShowPrompt] = createSignal(
      initialUpdateCheck.latest == false &&
        ignoredVersion !== initialUpdateCheck.version
    );

    showPromptSignal = setShowPrompt;
    setPendingUpdateInfoSignal = setPendingUpdateInfo;

    return (
      <>
        <Show when={updaterComponent()}>{updaterComponent()!()}</Show>
        <Show when={!updaterComponent()}>
          <MainApp />
          <Modal opened={showPrompt()} onClose={() => setShowPrompt(false)}>
            <ModalOverlay />
            <ModalContent>
              <ModalHeader>{locale.get("NEW_VERSION_AVAILABLE")}</ModalHeader>
              <ModalBody>
                <Text mb={"$4"} style={{ "white-space": "pre-wrap" }}>
                  {locale.format("NEW_VERSION_AVAILABLE_DESC", [
                    pendingUpdateInfo().version!,
                    pendingUpdateInfo().description!,
                  ])}
                </Text>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="ghost"
                  colorScheme="danger"
                  mr="$3"
                  onClick={async () => {
                    await setKey(
                      "ignore_launcher_update",
                      pendingUpdateInfo().version!
                    );
                    setShowPrompt(false);
                  }}
                >
                  {locale.get("UPDATE_PROMPT_IGNORE")}
                </Button>
                <Button
                  variant="ghost"
                  mr="$3"
                  onClick={() => setShowPrompt(false)}
                >
                  {locale.get("SETTING_CANCEL")}
                </Button>
                <Button
                  onClick={() => {
                    const info = pendingUpdateInfo();
                    setUpdaterComponent(() =>
                      createCommonUpdateUI(locale, () =>
                        downloadProgram(
                          aria2,
                          info.downloadUrl!,
                          info.sidecarDownloadUrl
                        )
                      )
                    );
                    setShowPrompt(false);
                  }}
                >
                  {locale.get("UPDATE_LAUNCHER")}
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        </Show>
        {/* Shared close confirmation, reused for downloads-in-progress and
            games-still-running. Rendered outside the updater Show so it's
            available even while a launcher update UI replaces MainApp. Its
            own X button and Esc are intentionally inert (onClose is a no-op);
            only the footer buttons decide. */}
        <AppModal
          opened={closePrompt() != null}
          onClose={() => undefined}
          title={
            closePrompt() == "game"
              ? locale.get("GAME_RUNNING_CLOSE_TITLE")
              : locale.get("DOWNLOAD_RUNNING_CLOSE_TITLE")
          }
          footer={
            closePrompt() == "game" ? (
              <>
                <AppModalButton
                  variant="secondary"
                  onClick={() => resolveClosePrompt("CANCEL")}
                >
                  {locale.get("SETTING_CANCEL")}
                </AppModalButton>
                <AppModalButton
                  variant="secondary"
                  onClick={() => resolveClosePrompt("KEEP_GAME")}
                >
                  {locale.get("GAME_RUNNING_CLOSE_KEEP")}
                </AppModalButton>
                <AppModalButton
                  variant="danger"
                  onClick={() => resolveClosePrompt("CLOSE_GAME")}
                >
                  {locale.get("GAME_RUNNING_CLOSE_EXIT")}
                </AppModalButton>
              </>
            ) : (
              <>
                <AppModalButton
                  variant="secondary"
                  onClick={() => resolveClosePrompt("CANCEL")}
                >
                  {locale.get("SETTING_CANCEL")}
                </AppModalButton>
                <AppModalButton
                  variant="danger"
                  onClick={() => resolveClosePrompt("EXIT")}
                >
                  {locale.get("DOWNLOAD_RUNNING_CLOSE_EXIT")}
                </AppModalButton>
              </>
            )
          }
        >
          <div class="app-modal-message">
            {closePrompt() == "game"
              ? locale.get("GAME_RUNNING_CLOSE_DESC")
              : locale.get("DOWNLOAD_RUNNING_CLOSE_DESC")}
          </div>
        </AppModal>
      </>
    );
  };
}
