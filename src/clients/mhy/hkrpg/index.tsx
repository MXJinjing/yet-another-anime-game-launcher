import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
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
import { assertValueDefined } from "@runtime/assertions";
import { exec } from "@runtime/command-runner";
import { getFreeSpace } from "@runtime/macos-filesystem";
import { globalStorage, type Storage } from "@runtime/storage";
import { join } from "path-browserify";
import { gt, lt } from "semver";
import { Config } from "@config";
import { checkIntegrityProgram } from "../program-check-integrity";
import {
  predownloadGameProgram,
  updateGameProgram,
} from "./program-update-game";
import { downloadAndInstallGameProgram } from "./program-install-game";
import { launchGameProgram } from "./program-launch-game";
import { patchRevertProgram } from "../patch";
import { Aria2 } from "@aria2";
import { Wine } from "@wine";
import {
  checkAndDownloadDXMT,
  checkAndDownloadDXVK,
  checkAndDownloadJadeite,
  checkAndDownloadReshade,
  isDXMTInstalled,
} from "@wine/runtime-resources";
import { getGameVersion2019 } from "../unity";
import {
  HoyoConnectGameBackgroundType,
  HoyoConnectGamePackages,
  VoicePackNames,
} from "../launcher-info";
import createPatchOff from "./config/patch-off";
import createBlockNet from "./config/block-net";
import { getDefaultBlockHostsText } from "../block-hosts";
import { HKRPG_CN_BLOCK_URL, HKRPG_OS_BLOCK_URL } from "../../secret";
import createMhypBaseReplacement from "../hk4e/config/runtime-replacement";
import {
  getLatestLauncherContent,
  getLatestVersionInfo,
  mapBackgroundsToUiContent,
} from "../hyp-connect";
import { HKRPG_GAME_LOG_LOCATIONS } from "../../game-log-paths";

// no need to check supported version
// const CURRENT_SUPPORTED_VERSION = "4.3.0";

export async function createHKRPGChannelClient({
  server,
  locale,
  aria2,
  wine,
  storage = globalStorage,
}: {
  server: Server;
  locale: Locale;
  aria2: Aria2;
  wine: Wine;
  storage?: Storage;
}): Promise<ChannelClient> {
  const { getKey, getKeyOrDefault, setKey } = storage;
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
  let loadContent: Awaited<
    ReturnType<typeof getLatestLauncherContent>
  >["loadContent"];
  let isAdvFallback = false;
  try {
    const launcherContent = await getLatestLauncherContent(locale, server, {
      deferContent: true,
    });
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
    loadContent = launcherContent.loadContent;
  } catch {
    isAdvFallback = true;
    background = "";
    icon = "";
    icon_link = "";
    video_url = "";
    theme_url = "";
    bg_type = HoyoConnectGameBackgroundType.BACKGROUND_TYPE_UNSPECIFIED;
  }
  const IS_VIDEO_BG =
    !isAdvFallback &&
    bg_type === HoyoConnectGameBackgroundType.BACKGROUND_TYPE_VIDEO;
  const fallbackBg = "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)";
  // Uninstalled games skip the online version request during startup. Keep a
  // valid semver value so updateRequired() remains safe before installation.
  let GAME_LATEST_VERSION: string = "0.0.0";
  let game_pkgs: { url: string; size: string }[];
  let decompressed_path: string;
  let patches: HoyoConnectGamePackages[];
  let pre_download: {
    major: HoyoConnectGamePackages | null;
    patches: HoyoConnectGamePackages[];
  } = { major: null, patches: [] };
  let versionLoaded = false;
  const loadVersionInfo = async () => {
    const versionInfo = await getLatestVersionInfo(server);
    GAME_LATEST_VERSION = versionInfo.main.major.version || "0.0.0";
    game_pkgs = versionInfo.main.major.game_pkgs;
    decompressed_path = versionInfo.main.major.res_list_url;
    patches = versionInfo.main.patches;
    pre_download = versionInfo.pre_download;
    versionLoaded = true;
  };
  const localGameState = await checkGameState(locale, server, storage);
  if (localGameState.gameInstalled) try {
    await loadVersionInfo();
  } catch {
    await log("Failed to fetch version info, using fallback");
    await locale.alert(
      "CHECK_GAME_UPDATE_FAILED",
      "CHECK_GAME_UPDATE_FAILED_DESC"
    );
    GAME_LATEST_VERSION = "0.0.0";
    game_pkgs = [];
    decompressed_path = "";
    patches = [];
    pre_download = { major: null, patches: [] };
  }
  const { gameInstalled, gameInstallDir, gameVersion } = localGameState;

  const [installed, setInstalled] = createSignal<ChannelClientInstallState>(
    gameInstalled ? "INSTALLED" : "NOT_INSTALLED"
  );
  const [runtimeReady, setRuntimeReady] = createSignal(await isDXMTInstalled());
  const [showPredownloadPrompt, setShowPredownloadPrompt] =
    createSignal<boolean>(
      pre_download.major != null && //exist pre_download_game data in server response
        (await getKeyOrDefault("predownloaded_all", "NOTFOUND")) ==
          "NOTFOUND" && // not downloaded yet
        gameInstalled && // game installed
        gt(pre_download.major.version || "0.0.0", gameVersion || "0.0.0") // predownload version is greater
    );
  const [_gameInstallDir, setGameInstallDir] = createSignal(
    gameInstallDir ?? ""
  );
  const [gameCurrentVersion, setGameVersion] = createSignal(
    gameVersion ?? "0.0.0"
  );
  const updateRequired = () => lt(gameCurrentVersion(), GAME_LATEST_VERSION);
  const [uiContent, setUiContent] = createStore<ChannelClient["uiContent"]>({
    background,
    background_video: IS_VIDEO_BG ? video_url : undefined,
    background_theme: IS_VIDEO_BG ? theme_url : undefined,
    backgrounds,
    launcherIconButtons,
    banners,
    posts,
    social_media_list,
    launcherContentLoaded: !loadContent,
    url: icon_link,
    channelName: isAdvFallback ? server.id : undefined,
    fallbackBackground: isAdvFallback ? fallbackBg : undefined,
  });
  return {
    installState: installed,
    showPredownloadPrompt,
    installDir: _gameInstallDir,
    gameLogLocations: HKRPG_GAME_LOG_LOCATIONS,
    gameVersion: gameCurrentVersion,
    latestVersion: () => GAME_LATEST_VERSION,
    updateRequired,
    uiContent,
    async hydrateUiContent() {
      if (!loadContent) return;
      try {
        const content = await loadContent();
        setUiContent({
          banners: content.banners,
          posts: content.posts,
          social_media_list: content.social_media_list,
        });
      } finally {
        setUiContent("launcherContentLoaded", true);
      }
    },
    predownloadVersion: () => pre_download?.major?.version ?? "",
    dismissPredownload() {
      setShowPredownloadPrompt(false);
    },
    runtimeReady: () => runtimeReady(),
    async refreshRuntimeReady() {
      setRuntimeReady(await isDXMTInstalled());
    },
    async *continueInstall(): TaskProgram {
      if (wine.attributes.renderBackend == "dxmt") {
        yield* checkAndDownloadDXMT(aria2, storage.namespace);
      }
      setRuntimeReady(true);
    },
    async *install(selection: string): TaskProgram {
      if (!versionLoaded) {
        try {
          await loadVersionInfo();
        } catch {
          await locale.alert("CHECK_GAME_UPDATE_FAILED", "CHECK_GAME_UPDATE_FAILED_DESC");
          return;
        }
      }
      if (game_pkgs.length === 0) {
        await locale.alert(
          "CHECK_GAME_UPDATE_FAILED",
          "CHECK_GAME_UPDATE_FAILED_DESC"
        );
        return;
      }
      try {
        // await stats(join(selection, "pkg_version"));
        await stats(join(selection, "GameAssembly.dll")); // FIXME: no pkg_version?
      } catch {
        const freeSpaceGB = await getFreeSpace(selection, "g");
        // `Array#map(parseInt)` would pass the index as the radix and yield
        // NaN, so parse with an explicit base 10 and coerce failures to 0.
        const totalSize = game_pkgs.reduce(
          (a, x) => a + (Number.parseInt(x.size, 10) || 0),
          0
        );
        const requiredSpaceGB = Math.ceil(totalSize / Math.pow(1024, 3)) * 1.2;
        if (freeSpaceGB < requiredSpaceGB) {
          await locale.alert(
            "NO_ENOUGH_DISKSPACE",
            "NO_ENOUGH_DISKSPACE_DESC",
            [requiredSpaceGB + "", (requiredSpaceGB * 1.074).toFixed(1)]
          );
          throw new TaskFailedError(locale.get("NO_ENOUGH_DISKSPACE"));
        }

        yield* downloadAndInstallGameProgram({
          aria2,
          gameDir: selection,
          gameSegmentZips: game_pkgs.map(x => x.url),
          gameVersion: GAME_LATEST_VERSION,
          server,
          totalBytes: BigInt(totalSize),
          downloadKey: storage.namespace,
        });
        if (wine.attributes.renderBackend == "dxmt") {
          yield* checkAndDownloadDXMT(aria2, storage.namespace);
        }
        setRuntimeReady(true);

        // setGameInstalled
        batch(() => {
          setInstalled("INSTALLED");
          setGameInstallDir(selection);
          setGameVersion(GAME_LATEST_VERSION);
        });
        await setKey("game_install_dir", selection);
        return;
      }
      const gameVersion = await getGameVersion2019(
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
      if (lt(gameVersion, GAME_LATEST_VERSION)) {
        const updateTarget = patches.find(x => x.version == gameVersion);
        if (!updateTarget) {
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
          aria2,
          gameDir: selection,
          remoteDir: decompressed_path,
          downloadKey: storage.namespace,
          storage,
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
      if (pre_download?.major == null) return;
      const updateTarget = pre_download.patches.find(
        x => x.version == gameCurrentVersion()
      );
      if (updateTarget == null) return;
      const voicePacks = (
        await Promise.all(
          updateTarget.audio_pkgs.map(async x => {
            try {
              await stats(
                join(
                  _gameInstallDir(),
                  `Audio_${VoicePackNames[x.language]}_pkg_version`
                )
              );
              return x;
            } catch {
              return null;
            }
          })
        )
      )
        .filter(x => x != null)
        .map(x => {
          assertValueDefined(x);
          return x;
        });
      if (updateTarget.game_pkgs.length != 1) {
        throw new Error(
          "assertation failed (game_pkgs.length!= 1)! please file an issue."
        );
      }
      yield* predownloadGameProgram({
        aria2,
        updateFileZip: updateTarget.game_pkgs[0].url,
        gameDir: _gameInstallDir(),
        updateVoicePackZips: voicePacks.map(x => x.url),
        downloadKey: storage.namespace,
        storage,
      });
    },
    async *update() {
      if (patches.length === 0) {
        await locale.alert(
          "CHECK_GAME_UPDATE_FAILED",
          "CHECK_GAME_UPDATE_FAILED_DESC"
        );
        return;
      }
      const updateTarget = patches.find(x => x.version == gameCurrentVersion());
      if (!updateTarget) {
        await locale.prompt(
          "UNSUPPORTED_VERSION",
          "GAME_VERSION_TOO_OLD_DESC",
          [gameCurrentVersion()]
        );
        batch(() => {
          setInstalled("NOT_INSTALLED");
          setGameInstallDir("");
          setGameVersion("0.0.0");
        });
        await setKey("game_install_dir", null);
        return;
      }
      const voicePacks = (
        await Promise.all(
          updateTarget.audio_pkgs.map(async x => {
            try {
              await stats(
                join(
                  _gameInstallDir(),
                  `Audio_${VoicePackNames[x.language]}_pkg_version`
                )
              );
              return x;
            } catch {
              return null;
            }
          })
        )
      )
        .filter(x => x != null)
        .map(x => {
          assertValueDefined(x);
          return x;
        });
      if (updateTarget.game_pkgs.length != 1) {
        throw new Error(
          "assertation failed (game_pkgs.length!= 1)! please file an issue."
        );
      }
      yield* updateGameProgram({
        aria2,
        server,
        currentGameVersion: gameCurrentVersion(),
        updatedGameVersion: GAME_LATEST_VERSION,
        updateFileZip: updateTarget.game_pkgs[0].url,
        gameDir: _gameInstallDir(),
        updateVoicePackZips: voicePacks.map(x => x.url),
        downloadKey: storage.namespace,
        storage,
      });
      batch(() => {
        setGameVersion(GAME_LATEST_VERSION);
      });
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
        yield* checkAndDownloadDXMT(aria2, storage.namespace);
      }
      yield* checkAndDownloadJadeite(aria2);
      yield* launchGameProgram({
        gameDir: _gameInstallDir(),
        wine,
        gameExecutable: server.executable,
        config,
        server,
        storage,
      });
    },
    async *checkIntegrity() {
      // FIXME: no pkg_version?
      yield* checkIntegrityProgram({
        aria2,
        gameDir: _gameInstallDir(),
        remoteDir: decompressed_path,
        downloadKey: storage.namespace,
        storage,
      });
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
        const gameVersion = await getGameVersion2019(
          join(selection, server.dataDir)
        );
        batch(() => {
          setInstalled("INSTALLED");
          setGameInstallDir(selection);
          setGameVersion(gameVersion);
        });
      } catch {
        batch(() => {
          setInstalled("NOT_INSTALLED");
          setGameInstallDir(selection);
          setGameVersion("0.0.0");
        });
      }
      await setKey("game_install_dir", selection);
    },
    async *init(config: Config) {
      setRuntimeReady(await isDXMTInstalled());
      try {
        await getKey("patched");
      } catch {
        return;
      }
      try {
        yield* patchRevertProgram(
          _gameInstallDir(),
          wine,
          server,
          config,
          storage
        );
      } catch {
        yield* checkIntegrityProgram({
          aria2,
          gameDir: _gameInstallDir(),
          remoteDir: decompressed_path,
          downloadKey: storage.namespace,
          storage,
        });
      }
    },
    async createConfig(locale: Locale, config: Partial<Config>) {
      const [W4] = await createMhypBaseReplacement({
        locale,
        config,
        gameInstallDir: _gameInstallDir,
        storage,
      });
      const [PO] = await createPatchOff({ locale, config, storage });
      const blockUrl =
        server.id == "hkrpg_global" ? HKRPG_OS_BLOCK_URL : HKRPG_CN_BLOCK_URL;
      const defaultHosts = [{ domain: blockUrl, ip: "0.0.0.0" }];
      const [BN] = await createBlockNet({
        locale,
        config,
        defaultHostsText: getDefaultBlockHostsText(defaultHosts),
        storage,
      });

      return function () {
        return [<PO />, <Divider />, <BN />, <Divider />, <W4 />];
      };
    },
  };
}

async function checkGameState(locale: Locale, server: Server, storage: Storage) {
  let gameDir = "";
  try {
    gameDir = await storage.getKey("game_install_dir");
  } catch {
    return {
      gameInstalled: false,
    } as const;
  }
  try {
    return {
      gameInstalled: true,
      gameInstallDir: gameDir,
      gameVersion:
        (await getGameVersion2019(join(gameDir, server.dataDir))) || "0.0.0",
    } as const;
  } catch {
    return {
      gameInstalled: false,
    } as const;
  }
}
