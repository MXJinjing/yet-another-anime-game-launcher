import { batch, createSignal } from "solid-js";
import { Divider } from "@hope-ui/solid";
import { TaskFailedError, type TaskProgram } from "@tasks/task-program";
import {
  ChannelClient,
  ChannelClientBackground,
  ChannelClientInstallState,
} from "../../../channel-client";
import { Server } from "@constants";
import { Locale } from "@locale";
import { log } from "@logging/logger";
import { stats } from "@platform/neutralino";
import { resolveSidecarPath } from "@platform/neutralino/sidecar";
import { rawString } from "@platform/shell";
import { assertValueDefined } from "@runtime/assertions";
import { timeout, waitImageReady } from "@runtime/async";
import { exec, spawn } from "@runtime/command-runner";
import { getFreeSpace } from "@runtime/macos-filesystem";
import { getKey, getKeyOrDefault, setKey } from "@runtime/storage";
import { join } from "path-browserify";
import { gt, lt, SemVer } from "semver";
import { Config } from "@config";
import { checkIntegrityProgram } from "./program-check-integrity";
import {
  predownloadGameProgram,
  updateGameProgram,
} from "./program-update-game";
import { downloadAndInstallGameProgram } from "./program-install-game";
import { launchGameProgram } from "./program-launch-game";
import { patchRevertProgram } from "../patch";
import { Aria2 } from "@aria2";
import { Sophon, createSophonRetry } from "@sophon";
import { Wine } from "@wine";
import {
  checkAndDownloadDXMT,
  checkAndDownloadDXVK,
  checkAndDownloadReshade,
  isDXMTInstalled,
} from "@wine/runtime-resources";
import createMhypBaseReplacement from "./config/mhypbase-replacement";
import createPatchOff from "./config/patch-off";
import createSteamPatch from "./config/steam-patch";
import createBlockNet from "./config/block-net";
import { getDefaultBlockHostsText } from "../block-hosts";
import { CN_BLOCK_URL, OS_BLOCK_URL } from "../../secret";
import createResolution from "./config/resolution";
import createTimeoutFix from "./config/timeout-fix";
import { createEnableHDRConfig } from "./config/enable-hdr";
import { getGameVersion } from "../unity";
import {
  VoicePackNames,
  HoyoConnectGameBackgroundType,
} from "../launcher-info";
import {
  getLatestLauncherContent,
  getLatestVersionInfo,
  mapBackgroundsToUiContent,
} from "../hyp-connect";
import { HK4E_GAME_LOG_LOCATIONS } from "../../game-log-paths";

// no need to check supported version
// const CURRENT_SUPPORTED_VERSION = "4.8.0";

export async function createHK4EChannelClient({
  server,
  locale,
  aria2,
  wine,
  releaseType,
}: {
  server: Server;
  locale: Locale;
  aria2: Aria2;
  wine: Wine;
  releaseType: "os" | "cn" | "bb";
}): Promise<ChannelClient> {
  let background: string;
  let icon: string;
  let icon_link: string;
  let video_url: string;
  let theme_url: string;
  let bg_type: HoyoConnectGameBackgroundType;
  let backgrounds: ChannelClientBackground[] = [];
  let launcherIconButtons: NonNullable<
    ChannelClient["uiContent"]["launcherIconButtons"]
  > = [];
  let banners: NonNullable<ChannelClient["uiContent"]["banners"]> = [];
  let posts: NonNullable<ChannelClient["uiContent"]["posts"]> = [];
  let social_media_list: NonNullable<
    ChannelClient["uiContent"]["social_media_list"]
  > = [];
  let isAdvFallback = false;
  try {
    const launcherContent = await getLatestLauncherContent(locale, server);
    const advInfos = launcherContent.backgrounds;
    const advInfo = advInfos[0];
    background = advInfo.background.url;
    icon = advInfo.icon.url;
    icon_link = advInfo.icon.link;
    video_url = advInfo.video.url;
    theme_url = advInfo.theme.url;
    bg_type = advInfo.type;
    backgrounds = mapBackgroundsToUiContent(advInfos);
    launcherIconButtons = launcherContent.launcherIconButtons;
    banners = launcherContent.content.banners;
    posts = launcherContent.content.posts;
    social_media_list = launcherContent.content.social_media_list;
  } catch {
    log("Failed to fetch adv info, using fallback UI");
    isAdvFallback = true;
    background = "";
    icon = "";
    icon_link = "";
    video_url = "";
    theme_url = "";
    bg_type = HoyoConnectGameBackgroundType.BACKGROUND_TYPE_UNSPECIFIED;
  }
  // Preload every background image so the switcher can fade between them
  // without waiting on the network during a switch.
  for (const bg of backgrounds) {
    if (bg.background) {
      waitImageReady(bg.background).catch(() => undefined);
    }
  }
  const IS_VIDEO_BG =
    !isAdvFallback &&
    bg_type === HoyoConnectGameBackgroundType.BACKGROUND_TYPE_VIDEO;
  const fallbackBg = "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)";

  const sophon_host = "127.0.0.1";
  const sophonDeadline = Date.now() + 30000;
  let sophon: Sophon | undefined;
  let lastSophonError: unknown;
  while (!sophon && Date.now() < sophonDeadline) {
    const sophonPort = randomSophonPort();
    const pid = (await exec(["echo", rawString("$PPID")])).stdOut.split(
      "\n"
    )[0];
    const { pid: spid } = await spawn(
      [await resolveSidecarPath("sophon_server/sophon-server")],
      {
        TERMINATE_WITH_PID: pid,
        SOPHON_PORT: sophonPort.toString(),
        SOPHON_HOST: sophon_host,
      }
    );
    try {
      const connectedSophon = await Promise.race([
        createSophonRetry(sophon_host, sophonPort),
        timeout(Math.max(500, sophonDeadline - Date.now())),
      ]);
      if (connectedSophon) sophon = connectedSophon;
    } catch (error) {
      lastSophonError = error;
      await log(`Sophon startup failed (${String(error)}); retrying`);
      try {
        await exec(["kill", String(spid)]);
      } catch {
        // The process already exited, usually because the port was busy.
      }
    }
  }
  if (!sophon) {
    throw new Error(
      `Fail to launch sophon.${
        lastSophonError ? ` ${String(lastSophonError)}` : ""
      }`
    );
  }
  assertValueDefined(sophon);
  const sophonClient = sophon;

  const gameInfo = await sophonClient.getLatestOnlineGameInfo(
    releaseType,
    "hk4e"
  );
  log(`Game info: ${JSON.stringify(gameInfo)}`);
  // Fallback to "0.0.0" when the backend could not determine the version.
  // Without this, `lt(gameCurrentVersion(), "")` / `gt(prev, "")` throw
  // "Invalid Version" and crash the launcher whenever the sophon backend
  // returns an empty version (e.g. on network failure or API key parse error).
  const LATEST_GAME_VERSION: string = gameInfo.version || "0.0.0";
  const UPDATABLE_VERSIONS: string[] = gameInfo.updatable_versions;
  const PRE_DOWNLOAD_VERSION: string = gameInfo.pre_download_version || "0.0.0";
  // The CN/BB Sophon pre-download currently omits part of the resources.
  // Keep the feature unreachable for domestic releases until the upstream
  // pre-download manifests can be handled completely.
  const PRE_DOWNLOAD_AVAILABLE: boolean =
    releaseType === "os" && gameInfo.pre_download;
  const INSTALL_SIZE_BYTES: number = gameInfo.install_size;

  if (background) {
    await waitImageReady(background);
  }

  const { gameInstalled, gameInstallDir, gameVersion } = await checkGameState(
    locale,
    server
  );

  const [installed, setInstalled] = createSignal<ChannelClientInstallState>(
    gameInstalled ? "INSTALLED" : "NOT_INSTALLED"
  );
  const [runtimeReady, setRuntimeReady] = createSignal(await isDXMTInstalled());
  const [showPredownloadPrompt, setShowPredownloadPrompt] =
    createSignal<boolean>(
      PRE_DOWNLOAD_AVAILABLE &&
        (await getKeyOrDefault("predownloaded_all", "NOTFOUND")) !=
          PRE_DOWNLOAD_VERSION && // this version has not been downloaded yet
        gameInstalled && // game installed
        gt(PRE_DOWNLOAD_VERSION, gameVersion) // predownload version is greater
    );
  const [_gameInstallDir, setGameInstallDir] = createSignal(
    gameInstallDir ?? ""
  );
  const [gameCurrentVersion, setGameVersion] = createSignal(
    gameVersion ?? "0.0.0"
  );
  const updateRequired = () => lt(gameCurrentVersion(), LATEST_GAME_VERSION);

  async function refreshInstalledGameVersion() {
    const installedVersion = await getGameVersionGI(
      join(_gameInstallDir(), server.dataDir)
    );
    setGameVersion(installedVersion);
    return installedVersion;
  }

  async function* updateToLatest(): TaskProgram<boolean> {
    if (!updateRequired()) return true;

    const currentVersion = gameCurrentVersion();
    const updatable = UPDATABLE_VERSIONS.includes(currentVersion);
    if (!updatable) {
      await locale.prompt("UNSUPPORTED_VERSION", "GAME_VERSION_TOO_OLD_DESC", [
        currentVersion,
      ]);
      batch(() => {
        setInstalled("NOT_INSTALLED");
        setGameInstallDir("");
        setGameVersion("0.0.0");
      });
      await setKey("game_install_dir", null);
      return false;
    }

    yield* updateGameProgram({
      sophon: sophonClient,
      gameDir: _gameInstallDir(),
      server,
      updatedGameVersion: LATEST_GAME_VERSION,
    });
    const installedVersion = await refreshInstalledGameVersion();
    if (lt(installedVersion, LATEST_GAME_VERSION)) {
      log(
        `Update completed but the installed game version is still ${installedVersion}; expected ${LATEST_GAME_VERSION}`
      );
    }
    return true;
  }

  return {
    installState: installed,
    showPredownloadPrompt,
    installDir: _gameInstallDir,
    gameLogLocations: HK4E_GAME_LOG_LOCATIONS,
    gameVersion: gameCurrentVersion,
    latestVersion: () => LATEST_GAME_VERSION,
    updateRequired,
    uiContent: {
      background: background, // Always show image
      background_video: IS_VIDEO_BG ? video_url : undefined,
      background_theme: IS_VIDEO_BG ? theme_url : undefined,
      backgrounds,
      launcherIconButtons,
      banners,
      posts,
      social_media_list,
      url: icon_link,
      channelName: isAdvFallback ? server.id : undefined,
      fallbackBackground: isAdvFallback ? fallbackBg : undefined,
    },
    predownloadVersion: () =>
      PRE_DOWNLOAD_AVAILABLE ? PRE_DOWNLOAD_VERSION : "",
    dismissPredownload() {
      setShowPredownloadPrompt(false);
    },
    runtimeReady: () => runtimeReady(),
    async refreshRuntimeReady() {
      setRuntimeReady(await isDXMTInstalled());
    },
    async *continueInstall(): TaskProgram {
      if (wine.attributes.renderBackend == "dxmt") {
        yield* checkAndDownloadDXMT(aria2);
      }
      setRuntimeReady(true);
    },
    async *install(selection: string): TaskProgram {
      try {
        await stats(join(selection, "pkg_version"));
      } catch {
        const freeSpaceGB = await getFreeSpace(selection, "g");
        const requiredSpaceGB =
          Math.ceil(INSTALL_SIZE_BYTES / Math.pow(1024, 3)) * 1.2;
        // Only enforce the disk-space requirement when the backend actually
        // returned a valid install size. When the manifest load failed the
        // backend returns install_size=0, which would make requiredSpaceGB=0
        // and silently bypass the check; the explicit INSTALL_SIZE_BYTES > 0
        // guard makes that intent clear so a future change to the formula
        // can't accidentally turn "unknown size" into a hard block.
        if (INSTALL_SIZE_BYTES > 0 && freeSpaceGB < requiredSpaceGB) {
          await locale.alert(
            "NO_ENOUGH_DISKSPACE",
            "NO_ENOUGH_DISKSPACE_DESC",
            [requiredSpaceGB + "", (requiredSpaceGB * 1.074).toFixed(1)]
          );
          throw new TaskFailedError(locale.get("NO_ENOUGH_DISKSPACE"));
        }
        if (INSTALL_SIZE_BYTES <= 0) {
          log(
            "install_size unknown (sophon manifest load failed); skipping disk-space check"
          );
        }

        yield* downloadAndInstallGameProgram({
          sophonClient: sophon,
          gameDir: selection,
          installReltype: releaseType,
        });
        if (wine.attributes.renderBackend == "dxmt") {
          yield* checkAndDownloadDXMT(aria2);
        }
        setRuntimeReady(true);

        // setGameInstalled
        const installedVersion = await getGameVersionGI(
          join(selection, server.dataDir)
        );
        batch(() => {
          setInstalled("INSTALLED");
          setGameInstallDir(selection);
          setGameVersion(installedVersion);
        });
        await setKey("game_install_dir", selection);
        return;
      }
      const gameVersion = await getGameVersionGI(
        join(selection, server.dataDir)
      );
      // if (gt(gameVersion, CURRENT_SUPPORTED_VERSION)) {
      //   await locale.alert(
      //     "UNSUPPORTED_VERSION",
      //     "PLEASE_WAIT_FOR_LAUNCHER_UPDATE",
      //     [gameVersion]
      //   );
      //   return;
      // } else
      if (lt(gameVersion, LATEST_GAME_VERSION)) {
        const updatable = UPDATABLE_VERSIONS.includes(gameVersion);
        if (!updatable) {
          await locale.prompt(
            "UNSUPPORTED_VERSION",
            "GAME_VERSION_TOO_OLD_DESC",
            [gameVersion]
          );
          return;
        }
        batch(() => {
          setInstalled("INSTALLED");
          setGameInstallDir(selection);
          setGameVersion(gameVersion);
        });
        await setKey("game_install_dir", selection);
        // FIXME: perform a integrity check?
      } else {
        yield* checkIntegrityProgram({
          sophon,
          gameDir: selection,
        });
        // setGameInstalled
        batch(() => {
          setInstalled("INSTALLED");
          setGameInstallDir(selection);
          setGameVersion(gameVersion);
        });
        await setKey("game_install_dir", selection);
      }
    },
    async *predownload() {
      setShowPredownloadPrompt(false);
      if (!PRE_DOWNLOAD_AVAILABLE) return;
      yield* predownloadGameProgram({
        sophon,
        gameDir: _gameInstallDir(),
        targetVersion: PRE_DOWNLOAD_VERSION,
      });
    },
    async *update() {
      yield* updateToLatest();
    },
    async *launch(config: Config) {
      // if (
      //   gt(gameCurrentVersion(), CURRENT_SUPPORTED_VERSION) &&
      //   !config.patchOff
      // ) {
      //   await locale.alert(
      //     "UNSUPPORTED_VERSION",
      //     "PLEASE_WAIT_FOR_LAUNCHER_UPDATE",
      //     [gameCurrentVersion()]
      //   );
      //   return;
      // }
      if (config.reshade) {
        yield* checkAndDownloadReshade(aria2, wine, _gameInstallDir());
      }
      if (wine.attributes.renderBackend == "dxmt") {
        yield* checkAndDownloadDXMT(aria2);
      }
      yield* launchGameProgram({
        gameDir: _gameInstallDir(),
        wine,
        gameExecutable: server.executable,
        config,
        server,
      });
    },
    async *checkIntegrity() {
      if (!(yield* updateToLatest())) return;
      yield* checkIntegrityProgram({
        sophon,
        gameDir: _gameInstallDir(),
      });
      await refreshInstalledGameVersion();
    },
    async changeInstallDir(selection: string) {
      if (!selection) {
        batch(() => {
          setInstalled("NOT_INSTALLED");
          setGameInstallDir("");
          setGameVersion("0.0.0");
        });
        await setKey("game_install_dir", null);
        return;
      }
      try {
        const gameVersion = await getGameVersionGI(
          join(selection, server.dataDir)
        );
        batch(() => {
          setInstalled("INSTALLED");
          setGameInstallDir(selection);
          setGameVersion(gameVersion);
        });
        await setKey("game_install_dir", selection);
      } catch {
        await locale.alert("CANT_OPEN_GAME_FILE", "CANT_OPEN_GAME_FILE_DESC");
      }
    },
    async *init(config: Config) {
      setRuntimeReady(await isDXMTInstalled());
      try {
        await getKey("patched");
      } catch {
        return;
      }
      try {
        yield* patchRevertProgram(_gameInstallDir(), wine, server, config);
      } catch {
        yield* checkIntegrityProgram({
          sophon,
          gameDir: _gameInstallDir(),
        });
      }
    },
    async createConfig(locale: Locale, config: Partial<Config>) {
      const [W4] = await createMhypBaseReplacement({
        locale,
        config,
        gameInstallDir: _gameInstallDir,
      });
      const [PO] = await createPatchOff({ locale, config });
      const [SP] = await createSteamPatch({ locale, config });
      const blockUrl = server.id == "hk4e_global" ? OS_BLOCK_URL : CN_BLOCK_URL;
      const defaultHosts = [
        { domain: blockUrl, ip: "0.0.0.0" },
        { domain: blockUrl, ip: "::1" },
      ];
      const [BN] = await createBlockNet({
        locale,
        config,
        defaultHostsText: getDefaultBlockHostsText(defaultHosts),
      });
      const [HDR] = await createEnableHDRConfig({ locale, config });
      const [RES] = await createResolution({ locale, config });
      const [TF] = await createTimeoutFix({ locale, config });

      return {
        launch() {
          return [
            <PO />,
            <SP />,
            <TF />,
            <Divider />,
            <BN />,
            <Divider />,
            <W4 />,
          ];
        },
        video() {
          return [<RES />, <HDR />];
        },
      };
    },
  };
}

function randomSophonPort(): number {
  return Math.floor(Math.random() * (65535 - 50000)) + 50000;
}

async function getGameVersionGI(gameDataDir: string) {
  try {
    const ret = await getGameVersion(gameDataDir, 0xac);
    await log(String(new SemVer(ret)));
    return ret;
  } catch {
    return await getGameVersion(gameDataDir);
  }
}

async function checkGameState(locale: Locale, server: Server) {
  let gameDir = "";
  try {
    gameDir = await getKey("game_install_dir");
  } catch {
    return {
      gameInstalled: false,
    } as const;
  }
  try {
    return {
      gameInstalled: true,
      gameInstallDir: gameDir,
      gameVersion: await getGameVersionGI(join(gameDir, server.dataDir)),
    } as const;
  } catch {
    return {
      gameInstalled: false,
    } as const;
  }
}
