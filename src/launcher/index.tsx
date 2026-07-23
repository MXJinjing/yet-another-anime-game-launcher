import { openDir, fatal, open, log, getKeyOrDefault, setKey } from "@utils";
import {
  Box,
  Button,
  ButtonGroup,
  createDisclosure,
  Flex,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverTrigger,
  Progress,
  ProgressIndicator,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectTrigger,
  SelectValue,
  Text,
} from "@hope-ui/solid";
import { createIcon } from "@hope-ui/solid";
import { For, Show, createSignal, onCleanup } from "solid-js";
import { Locale } from "@locale";
import { createConfiguration } from "@config";
import { Github } from "../github";
import { createGameInstallationDirectorySanitizer } from "../accidental-complexity";
import { ChannelClient } from "../channel-client";
import { createTaskQueueState } from "./task-queue";
import { getWineDistributions, Wine, WineDistribution } from "@wine";
import { CommonUpdateProgram } from "../common-update-ui";
import { createLogViewer } from "../log-viewer";
import {
  cancelControlledDownload,
  getDownloadControlState,
  pauseControlledDownload,
  resumeControlledDownload,
  subscribeDownloadControl,
} from "../download-control";

const SKIP_INITIAL_WINE_GUIDE_KEY = "skip_initial_wine_guide";

const IconSetting = createIcon({
  viewBox: "0 0 1024 1024",
  path() {
    return (
      <path
        fill="currentColor"
        d="M396.72 320.592a141.184 141.184 0 0 1-99.824 15.92 277.648 277.648 0 0 0-45.344 74.576 141.216 141.216 0 0 1 37.52 95.952 141.248 141.248 0 0 1-41.728 100.32 274.4 274.4 0 0 0 49.952 86.224 141.264 141.264 0 0 1 107.168 14.176 141.216 141.216 0 0 1 63.984 79.296 274.72 274.72 0 0 0 86.816-1.92 141.248 141.248 0 0 1 66.016-86.304 141.216 141.216 0 0 1 101.856-15.488 277.648 277.648 0 0 0 41.92-76.544 141.184 141.184 0 0 1-36.128-94.4c0-34.912 12.768-67.68 34.816-92.96a274.736 274.736 0 0 0-38.192-70.032 141.264 141.264 0 0 1-105.792-14.56 141.312 141.312 0 0 1-67.168-90.912 274.4 274.4 0 0 0-92.784 0.016 141.152 141.152 0 0 1-63.088 76.64z m22.56-116.656c57.312-16 119.024-16.224 178.016 1.216a93.44 93.44 0 0 0 142.288 86.736 322.64 322.64 0 0 1 79.104 142.656 93.328 93.328 0 0 0-41.76 77.84 93.36 93.36 0 0 0 42.88 78.592 322.832 322.832 0 0 1-34.208 85.232 323.392 323.392 0 0 1-47.968 63.568 93.392 93.392 0 0 0-92.352 0.64 93.408 93.408 0 0 0-46.688 83.616 322.704 322.704 0 0 1-171.424 3.84 93.376 93.376 0 0 0-46.704-78.544 93.408 93.408 0 0 0-95.184 1.008A322.432 322.432 0 0 1 192 589.28a93.408 93.408 0 0 0 49.072-82.24c0-34.128-18.304-64-45.632-80.288a323.392 323.392 0 0 1 31.088-73.328 322.832 322.832 0 0 1 56.704-72.256 93.36 93.36 0 0 0 89.488-2.144 93.328 93.328 0 0 0 46.56-75.088z m92.208 385.28a68.864 68.864 0 1 0 0-137.76 68.864 68.864 0 0 0 0 137.76z m0 48a116.864 116.864 0 1 1 0-233.76 116.864 116.864 0 0 1 0 233.76z"
        p-id="2766"
      ></path>
    );
  },
});

export async function createLauncher({
  wine,
  wineDistroId,
  wineInstalled,
  initializeWine,
  enableWineDistro,
  uninstallWineDistro,
  locale,
  github,
  channelClient: {
    installDir,
    installState,
    gameVersion,
    showPredownloadPrompt,
    updateRequired,
    install,
    predownload,
    launch,
    update,
    checkIntegrity,
    init,
    uiContent: {
      background,
      background_video,
      background_theme,
      url,
      iconImage,
      launchButtonLocation,
      logo,
    },
    dismissPredownload,
    predownloadVersion,
    createConfig,
    changeInstallDir,
  },
  onCheckUpdate,
  onGameRunningChange,
}: {
  wine: Wine;
  wineDistroId: string;
  wineInstalled: () => boolean;
  initializeWine: (distro: WineDistribution) => CommonUpdateProgram;
  enableWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
  uninstallWineDistro: (distro: WineDistribution) => CommonUpdateProgram;
  locale: Locale;
  github: Github;
  channelClient: ChannelClient;
  onCheckUpdate: () => void;
  onGameRunningChange?: (running: boolean) => void;
}) {
  const showInitialWineGuideByDefault =
    !wineInstalled() &&
    (await getKeyOrDefault(SKIP_INITIAL_WINE_GUIDE_KEY, "false")) != "true";
  const wineDistros = await getWineDistributions();
  const initialWineDistro =
    wineDistros.find(distro => distro.id == wineDistroId) ?? wineDistros[0];
  let wineActionDisabled = () => false;
  let requestWineDistroEnable = (
    _distro: WineDistribution,
    _onDone: (distro: WineDistribution) => void
  ): void => undefined;
  let requestWineDistroUninstall = (
    _distro: WineDistribution,
    _onDone: (distro: WineDistribution) => void
  ): void => undefined;

  const { UI: ConfigurationUI, config } = await createConfiguration({
    wine,
    wineDistroId,
    wineInstalled,
    gameInstalled: () => installState() == "INSTALLED",
    gameVersion,
    locale,
    gameInstallDir: installDir,
    onGameInstallDirChange: changeInstallDir,
    configForChannelClient: createConfig,
    onCheckUpdate,
    wineActionDisabled: () => wineActionDisabled(),
    onEnableWineDistro: (distro, onDone) =>
      requestWineDistroEnable(distro, onDone),
    onUninstallWineDistro: (distro, onDone) =>
      requestWineDistroUninstall(distro, onDone),
  });

  const { selectPath } = await createGameInstallationDirectorySanitizer({
    openFolderDialog: async () =>
      await openDir(locale.get("SELECT_INSTALLATION_DIR")),
    locale,
  });

  return function Launcher() {
    // const bh = 40 / window.devicePixelRatio;
    // const bw = 136 / window.devicePixelRatio;
    const bh = 40;
    const bw = 136;
    const [gameRunning, setGameRunning] = createSignal(false);
    const [initialWineDistroId, setInitialWineDistroId] = createSignal(
      initialWineDistro.id
    );
    const selectedInitialWineDistro = () =>
      wineDistros.find(distro => distro.id == initialWineDistroId()) ??
      initialWineDistro;

    const [statusText, progress, programBusy, taskQueue] = createTaskQueueState(
      {
        locale,
        onStateKey: key => {
          const running = key == "GAME_RUNNING";
          setGameRunning(running);
          onGameRunningChange?.(running);
        },
      }
    );
    if (wineInstalled()) {
      taskQueue.next(() => init(config));
    }

    const [
      nonUrgentStatusText,
      nonUrgentProgress,
      nonUrgentProgramBusy,
      nonUrgentTaskQueue,
    ] = createTaskQueueState({ locale });

    const { isOpen, onOpen, onClose } = createDisclosure();
    const [showInitialWineGuide, setShowInitialWineGuide] = createSignal(
      showInitialWineGuideByDefault
    );
    const [showInitializeWineConfirm, setShowInitializeWineConfirm] =
      createSignal(false);
    const [customizeInitialWineDistro, setCustomizeInitialWineDistro] =
      createSignal(false);
    const { LogViewer, openLogs } = createLogViewer(locale);

    const [videoLoaded, setVideoLoaded] = createSignal(false);
    const [downloadControl, setDownloadControl] = createSignal(
      getDownloadControlState()
    );
    onCleanup(subscribeDownloadControl(setDownloadControl));

    function gameUpdateCheckDisabled() {
      const download = downloadControl();
      return (
        programBusy() ||
        nonUrgentProgramBusy() ||
        download.active ||
        download.actionPending ||
        gameRunning()
      );
    }

    function wineDistroActionDisabled() {
      const download = downloadControl();
      return (
        programBusy() ||
        nonUrgentProgramBusy() ||
        download.active ||
        download.actionPending ||
        gameRunning()
      );
    }

    wineActionDisabled = wineDistroActionDisabled;
    requestWineDistroEnable = (distro, onDone) => {
      if (wineDistroActionDisabled()) return;
      onClose();
      log(`Wine environment enable requested: ${distro.id}`);
      taskQueue.next(async function* () {
        yield* enableWineDistro(distro);
        onDone(distro);
      });
    };
    requestWineDistroUninstall = (distro, onDone) => {
      if (wineDistroActionDisabled()) return;
      log(`Wine environment uninstall requested: ${distro.id}`);
      taskQueue.next(async function* () {
        yield* uninstallWineDistro(distro);
        onDone(distro);
      });
    };

    function openInitializeWineConfirm() {
      setShowInitialWineGuide(false);
      setCustomizeInitialWineDistro(false);
      setInitialWineDistroId(initialWineDistro.id);
      setShowInitializeWineConfirm(true);
    }

    function startInitializeWine(distro: WineDistribution) {
      log(`Initialize Wine environment requested: ${distro.id}`);
      setShowInitializeWineConfirm(false);
      taskQueue.next(() => initializeWine(distro));
    }

    async function onButtonClick() {
      const download = downloadControl();
      if (download.active) {
        if (!download.canPause) return;
        if (download.pauseRequested) {
          await resumeControlledDownload();
        } else {
          await pauseControlledDownload();
        }
        return;
      }
      if (programBusy()) return; // ignore
      if (!wineInstalled()) {
        openInitializeWineConfirm();
        return;
      }
      if (installState() == "INSTALLED") {
        if (updateRequired() == true) {
          await log("Game update requested");
          taskQueue.next(update);
        } else {
          await log("Game launch requested");
          taskQueue.next(() => launch(config));
        }
      } else {
        const selection = await selectPath();
        if (!selection) return;
        await log(`Game installation requested: ${selection}`);
        taskQueue.next(() => install(selection));
      }
    }

    return (
      <div
        class="background"
        style={{
          "background-image": background ? `url(${background})` : undefined,
        }}
      >
        <Show when={background_video}>
          <video
            class="background-video"
            src={background_video}
            autoplay
            loop
            muted
            playsinline
            onLoadedData={() => setVideoLoaded(true)}
            style={{
              opacity: videoLoaded() ? 1 : 0,
              transition: "opacity 0.5s ease-in",
            }}
          />
        </Show>
        <Show when={background_theme}>
          <div
            class="background-theme"
            style={{
              "background-image": `url(${background_theme})`,
              // HACK: always load video overlay image.
              // Image seems to align with overlay. Fix for ZZZ not having text in image.
            }}
          />
        </Show>
        {logo ? (
          <div
            class="game-logo"
            style={{
              "background-image": `url(${logo})`,
              height: `${234}px`,
              width: `${416}px`, //fixme: responsive size
            }}
          />
        ) : null}
        {iconImage ? (
          <div
            onClick={() => open(url)}
            role="button"
            class="version-icon"
            style={{
              "background-image": `url(${iconImage})`,
              height: `${bh}px`,
              width: `${bw}px`, //fixme: responsive size
            }}
          />
        ) : null}
        <Flex h="100vh" direction={"column-reverse"}>
          <Flex
            direction={launchButtonLocation == "left" ? "row-reverse" : "row"}
            mr={"calc(10vw + 2px)"} // 微操大师
            ml={"10vw"}
            mb={50}
            columnGap="10vw"
            alignItems={"flex-end"}
          >
            <Box flex={1}>
              <Show when={nonUrgentProgramBusy()}>
                <h3
                  onClick={openLogs}
                  title={locale.get("LOG_VIEWER_OPEN_HINT")}
                  style={
                    "text-shadow: 1px 1px 2px #333;color:white;margin-bottom:5px;margin-top:8px;cursor:pointer"
                  }
                >
                  {nonUrgentStatusText()}
                </h3>
                <Box
                  role="button"
                  title={locale.get("LOG_VIEWER_OPEN_HINT")}
                  onClick={openLogs}
                >
                  <Progress
                    value={nonUrgentProgress()}
                    indeterminate={nonUrgentProgress() == 0}
                    size="sm"
                    borderRadius={8}
                  >
                    <ProgressIndicator
                      style={"transition: none;"}
                      borderRadius={8}
                    ></ProgressIndicator>
                  </Progress>
                </Box>
              </Show>
              <Show when={programBusy()}>
                <h3
                  onClick={openLogs}
                  title={locale.get("LOG_VIEWER_OPEN_HINT")}
                  style={
                    "text-shadow: 1px 1px 2px #333;color:white;margin-bottom:5px;margin-top:8px;cursor:pointer;"
                  }
                >
                  {statusText()}
                </h3>
                <Box
                  role="button"
                  title={locale.get("LOG_VIEWER_OPEN_HINT")}
                  onClick={openLogs}
                >
                  <Progress
                    value={progress()}
                    indeterminate={progress() == 0}
                    size="sm"
                    borderRadius={8}
                  >
                    <ProgressIndicator
                      style={"transition: none;"}
                      borderRadius={8}
                    ></ProgressIndicator>
                  </Progress>
                </Box>
              </Show>
            </Box>
            <Popover
              placement="top"
              opened={showPredownloadPrompt() && !isOpen()}
              onClose={dismissPredownload}
              closeOnBlur={true}
            >
              <PopoverTrigger as={Box}>
                <Box class="launch-actions">
                  <ButtonGroup
                    class="launch-button"
                    size="xl"
                    attached
                    minWidth={150}
                  >
                    <Button
                      mr="-1px"
                      disabled={
                        downloadControl().active
                          ? !downloadControl().canPause ||
                            downloadControl().actionPending
                          : programBusy()
                      }
                      onClick={() => onButtonClick().catch(fatal)}
                    >
                      {downloadControl().active
                        ? downloadControl().pauseRequested
                          ? locale.get("RESUME_DOWNLOAD")
                          : locale.get("PAUSE_DOWNLOAD")
                        : !wineInstalled()
                        ? locale.get("INIT_ENVIRONMENT")
                        : installState() == "INSTALLED"
                        ? updateRequired()
                          ? locale.get("UPDATE")
                          : locale.get("LAUNCH")
                        : locale.get("INSTALL")}
                    </Button>
                    <IconButton
                      onClick={onOpen}
                      disabled={programBusy() && !downloadControl().active}
                      fontSize={30}
                      aria-label="Settings"
                      icon={<IconSetting />}
                    />
                  </ButtonGroup>
                  <Box class="download-cancel-slot">
                    <Show
                      when={downloadControl().active}
                      fallback={
                        <Show when={gameRunning()}>
                          <Box
                            class="download-cancel-action"
                            onClick={() =>
                              (async () => {
                                await log("Force quit game requested");
                                await wine.killAll();
                              })().catch(e =>
                                log(`Force quit game failed: ${String(e)}`)
                              )
                            }
                          >
                            {locale.get("FORCE_QUIT_GAME")}
                          </Box>
                        </Show>
                      }
                    >
                      <Box
                        class="download-cancel-action"
                        onClick={() =>
                          cancelControlledDownload().catch(e =>
                            log(`Cancel download failed: ${String(e)}`)
                          )
                        }
                      >
                        {locale.get("CANCEL_DOWNLOAD")}
                      </Box>
                    </Show>
                  </Box>
                </Box>
              </PopoverTrigger>
              <PopoverContent
                borderColor="$success3"
                bg="$success3"
                color="$success11"
                width={200}
              >
                <PopoverArrow />
                <PopoverCloseButton />
                <PopoverBody width={200}>
                  <Button
                    id="predownload"
                    colorScheme="success"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await log("Game predownload requested");
                      nonUrgentTaskQueue.next(predownload);
                    }}
                  >
                    {locale.format("PREDOWNLOAD_READY", [predownloadVersion()])}
                  </Button>
                </PopoverBody>
              </PopoverContent>
            </Popover>
            <Modal opened={isOpen()} onClose={onClose} scrollBehavior="inside">
              <ModalOverlay />
              <ConfigurationUI
                onOpenLogs={openLogs}
                gameUpdateCheckDisabled={gameUpdateCheckDisabled}
                onCheckGameUpdate={async () => {
                  if (gameUpdateCheckDisabled()) return;
                  onClose();
                  await log("Game update check requested");
                  if (updateRequired()) {
                    taskQueue.next(update);
                  } else {
                    await locale.alert(
                      "GAME_VERSION",
                      "ALREADY_LATEST_VERSION"
                    );
                  }
                }}
                onClose={action => {
                  onClose();
                  if (action == "check-integrity") {
                    taskQueue.next(checkIntegrity);
                  }
                }}
              ></ConfigurationUI>
            </Modal>
          </Flex>
        </Flex>
        <Modal
          opened={showInitialWineGuide() && !wineInstalled()}
          onClose={() => setShowInitialWineGuide(true)}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>{locale.get("INIT_ENVIRONMENT_TITLE")}</ModalHeader>
            <ModalBody>
              <Text>{locale.get("INIT_ENVIRONMENT_DESC")}</Text>
            </ModalBody>
            <ModalFooter justifyContent="space-between">
              <Button
                variant="ghost"
                size="xs"
                colorScheme="neutral"
                onClick={async () => {
                  await setKey(SKIP_INITIAL_WINE_GUIDE_KEY, "true");
                  setShowInitialWineGuide(false);
                }}
              >
                {locale.get("DONT_REMIND_AGAIN")}
              </Button>
              <Box>
                <Button
                  variant="ghost"
                  mr="$3"
                  onClick={() => setShowInitialWineGuide(false)}
                >
                  {locale.get("SKIP")}
                </Button>
                <Button onClick={openInitializeWineConfirm}>
                  {locale.get("INIT_ENVIRONMENT")}
                </Button>
              </Box>
            </ModalFooter>
          </ModalContent>
        </Modal>
        <Modal
          opened={showInitializeWineConfirm() && !wineInstalled()}
          onClose={() => setShowInitializeWineConfirm(false)}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>{locale.get("INIT_ENVIRONMENT_TITLE")}</ModalHeader>
            <ModalBody>
              <Text>
                {locale.format("INIT_ENVIRONMENT_CONFIRM_DESC", [
                  (customizeInitialWineDistro()
                    ? selectedInitialWineDistro()
                    : initialWineDistro
                  ).displayName,
                ])}
              </Text>
              <Show when={customizeInitialWineDistro()}>
                <Box mt="$4">
                  <Text mb="$2" fontWeight="$semibold">
                    {locale.get("INIT_ENVIRONMENT_WINE_VERSION")}
                  </Text>
                  <Select
                    value={initialWineDistroId()}
                    onChange={setInitialWineDistroId}
                  >
                    <SelectTrigger>
                      <SelectValue />
                      <SelectIcon />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectListbox>
                        <For each={wineDistros}>
                          {distro => (
                            <SelectOption value={distro.id}>
                              <SelectOptionText>
                                {distro.displayName}
                              </SelectOptionText>
                              <SelectOptionIndicator />
                            </SelectOption>
                          )}
                        </For>
                      </SelectListbox>
                    </SelectContent>
                  </Select>
                </Box>
              </Show>
            </ModalBody>
            <ModalFooter>
              <Show
                when={customizeInitialWineDistro()}
                fallback={
                  <>
                    <Button
                      variant="ghost"
                      mr="$3"
                      onClick={() => setShowInitializeWineConfirm(false)}
                    >
                      {locale.get("SETTING_CANCEL")}
                    </Button>
                    <Button
                      variant="ghost"
                      mr="$3"
                      onClick={() => setCustomizeInitialWineDistro(true)}
                    >
                      {locale.get("INIT_ENVIRONMENT_CUSTOM_WINE")}
                    </Button>
                    <Button
                      onClick={() => startInitializeWine(initialWineDistro)}
                    >
                      {locale.get("INIT_ENVIRONMENT_USE_RECOMMENDED")}
                    </Button>
                  </>
                }
              >
                <Button
                  variant="ghost"
                  mr="$3"
                  onClick={() => setShowInitializeWineConfirm(false)}
                >
                  {locale.get("SETTING_CANCEL")}
                </Button>
                <Button
                  onClick={() =>
                    startInitializeWine(selectedInitialWineDistro())
                  }
                >
                  {locale.get("INIT_ENVIRONMENT")}
                </Button>
              </Show>
            </ModalFooter>
          </ModalContent>
        </Modal>
        <LogViewer />
      </div>
    );
  };
}
