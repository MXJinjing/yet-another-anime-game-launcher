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
import { checkWine, createWine, installWineEnvironmentProgram } from "./wine";
import { createGithubEndpoint } from "./github";
import { createLauncher } from "./launcher";
import "./app.css";
import { createUpdater, downloadProgram } from "./updater";
import { createCommonUpdateUI } from "./common-update-ui";
import { createLocale } from "./locale";
import { createClient } from "./clients";
import { createSignal, Show, JSXElement } from "solid-js";
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
  await setKey("singleton", null);

  const aria2_port = 6868;

  const locale = await createLocale();
  const github = await createGithubEndpoint();
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
  const initialUpdateCheck = await createUpdater({
    github,
    aria2,
  });

  const ignoredVersion = await getKeyOrDefault("ignore_launcher_update", "");

  const wineStatus = await checkWine(github);
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
  let gameRunning = false;
  let closeGameProcessesOnExit = true;
  let handlingWindowClose = false;

  async function confirmCloseWhileGameRuns() {
    const out = await Neutralino.os.showMessageBox(
      locale.get("GAME_RUNNING_CLOSE_TITLE"),
      locale.get("GAME_RUNNING_CLOSE_DESC"),
      "YES_NO_CANCEL"
    );
    if (out == "YES") return "CLOSE_GAME";
    if (out == "NO") return "KEEP_GAME";
    return "CANCEL";
  }

  await Neutralino.events.on("windowClose", async () => {
    if (handlingWindowClose) return;
    handlingWindowClose = true;
    let shouldExit = false;
    try {
      closeGameProcessesOnExit = true;
      if (gameRunning) {
        const decision = await confirmCloseWhileGameRuns();
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
  const MainApp: () => JSXElement = await createLauncher({
    wine,
    wineDistroId: wineStatus.wineDistribution.id,
    wineInstalled,
    initializeWine: async function* () {
      yield* installWineEnvironmentProgram({
        aria2,
        wineAbsPrefix: prefixPath,
        wineDistro: wineStatus.wineDistribution,
      });
      setWineInstalled(true);
    },
    locale,
    github,
    channelClient: await createClient({
      wine,
      aria2,
      locale,
    }),
    onCheckUpdate,
    onGameRunningChange: running => {
      gameRunning = running;
    },
  });

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
      </>
    );
  };
}
