import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { TaskFailedError, type TaskProgram } from "@tasks/task-program";
import {
  ChannelClient,
  ChannelClientBackground,
  ChannelClientInstallState,
} from "../../../channel-client";
import { Server } from "@constants";
import { Locale } from "@locale";
import { stats } from "@platform/neutralino";
import { assertValueDefined } from "@runtime/assertions";
import { exec } from "@runtime/command-runner";
import { getFreeSpace } from "@runtime/macos-filesystem";
import { log } from "@logging/logger";
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
import { getGameVersion } from "../unity";
import { BH3_GAME_LOG_LOCATIONS } from "../../game-log-paths";
import { LauncherResourceData, VoicePackNames } from "../launcher-info";
import {
  getLatestLauncherContent,
  mapBackgroundsToUiContent,
} from "../hyp-connect";

const CURRENT_SUPPORTED_VERSION = "7.5.0";

async function fetch(url: string) {
  const { stdOut } = await exec(["curl", url]);
  return {
    async json() {
      return JSON.parse(stdOut);
    },
  };
}

export async function createBH3ChannelClient({
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
  let url: string;
  let icon: string;
  let video_url: string;
  let theme_url: string;
  let backgrounds: ChannelClientBackground[] = [];
  let launcherIconButtons: NonNullable<
    ChannelClient["uiContent"]["launcherIconButtons"]
  > = [];
  const banners: NonNullable<ChannelClient["uiContent"]["banners"]> = [];
  const posts: NonNullable<ChannelClient["uiContent"]["posts"]> = [];
  const social_media_list: NonNullable<
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
    const advInfo = launcherContent.backgrounds[0];
    background = advInfo.background.url;
    url = advInfo.icon.link;
    icon = advInfo.icon.url;
    video_url = advInfo.video.url;
    theme_url = advInfo.theme.url;
    backgrounds = mapBackgroundsToUiContent(launcherContent.backgrounds);
    launcherIconButtons = launcherContent.launcherIconButtons;
    loadContent = launcherContent.loadContent;
  } catch {
    isAdvFallback = true;
    background = "";
    url = "";
    icon = "";
    video_url = "";
    theme_url = "";
  }
  const fallbackBg = "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)";
  // Uninstalled games skip the online version request during startup. Keep a
  // valid semver value so updateRequired() remains safe before installation.
  let GAME_LATEST_VERSION = "0.0.0";
  let diffs: LauncherResourceData["data"]["game"]["diffs"];
  let decompressed_path: string;
  let path: string;
  let pre_download_game: LauncherResourceData["data"]["pre_download_game"] =
    null;
  let hasPreDownload = false;
  let size: string;
  let versionLoaded = false;
  const loadVersionInfo = async () => {
    const versionInfo: LauncherResourceData = await getLatestVersionInfo(
      server
    );
    GAME_LATEST_VERSION = versionInfo.data.game.latest.version || "0.0.0";
    diffs = versionInfo.data.game.diffs;
    decompressed_path = versionInfo.data.game.latest.decompressed_path;
    path = versionInfo.data.game.latest.path;
    size = versionInfo.data.game.latest.size;
    pre_download_game = versionInfo.data.pre_download_game;
    hasPreDownload = pre_download_game != null;
    versionLoaded = true;
  };
  const localGameState = await checkGameState(locale, server, storage);
  if (localGameState.gameInstalled)
    try {
      await loadVersionInfo();
    } catch {
      await locale.alert(
        "CHECK_GAME_UPDATE_FAILED",
        "CHECK_GAME_UPDATE_FAILED_DESC"
      );
      GAME_LATEST_VERSION = "0.0.0";
      diffs = [];
      decompressed_path = "";
      path = "";
      size = "0";
      pre_download_game = null;
      hasPreDownload = false;
    }
  const { gameInstalled, gameInstallDir, gameVersion } = localGameState;

  const [installed, setInstalled] = createSignal<ChannelClientInstallState>(
    gameInstalled ? "INSTALLED" : "NOT_INSTALLED"
  );
  const [runtimeReady, setRuntimeReady] = createSignal(await isDXMTInstalled());
  const [showPredownloadPrompt, setShowPredownloadPrompt] =
    createSignal<boolean>(
      hasPreDownload && //exist pre_download_game data in server response
        (await getKeyOrDefault("predownloaded_all", "NOTFOUND")) ==
          "NOTFOUND" && // not downloaded yet
        gameInstalled && // game installed
        gt(pre_download_game!.latest.version || "0.0.0", gameVersion || "0.0.0") // predownload version is greater
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
    background_video: video_url || undefined,
    background_theme: theme_url || undefined,
    backgrounds,
    launcherIconButtons,
    banners,
    posts,
    social_media_list,
    launcherContentLoaded: !loadContent,
    iconImage: icon,
    url,
    channelName: isAdvFallback ? server.id : undefined,
    fallbackBackground: isAdvFallback ? fallbackBg : undefined,
  });
  return {
    installState: installed,
    showPredownloadPrompt,
    installDir: _gameInstallDir,
    gameLogLocations: BH3_GAME_LOG_LOCATIONS,
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
    predownloadVersion: () => pre_download_game?.latest.version ?? "",
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
          await locale.alert(
            "CHECK_GAME_UPDATE_FAILED",
            "CHECK_GAME_UPDATE_FAILED_DESC"
          );
          return;
        }
      }
      if (!path) {
        await locale.alert(
          "CHECK_GAME_UPDATE_FAILED",
          "CHECK_GAME_UPDATE_FAILED_DESC"
        );
        return;
      }
      try {
        await stats(join(selection, "pkg_version"));
      } catch {
        const freeSpaceGB = await getFreeSpace(selection, "g");
        const requiredSpaceGB =
          Math.ceil(parseInt(size) / Math.pow(1024, 3)) * 1.2;
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
          gameFileZip: path,
          // gameAudioZip: voice_packs.find((x) => x.language == "zh-cn")!
          //   .path,
          gameVersion: GAME_LATEST_VERSION,
          server,
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
      const gameVersion = await getGameVersion(join(selection, server.dataDir));
      if (gt(gameVersion, CURRENT_SUPPORTED_VERSION)) {
        await locale.alert(
          "UNSUPPORTED_VERSION",
          "PLEASE_WAIT_FOR_LAUNCHER_UPDATE",
          [gameVersion]
        );
        return;
      } else if (lt(gameVersion, GAME_LATEST_VERSION)) {
        const updateTarget = diffs.find(x => x.version == gameVersion);
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
      if (pre_download_game == null) return;
      const updateTarget = pre_download_game.diffs.find(
        x => x.version == gameCurrentVersion()
      );
      if (updateTarget == null) return;
      const voicePacks = (
        await Promise.all(
          updateTarget.voice_packs.map(async x => {
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
      yield* predownloadGameProgram({
        aria2,
        updateFileZip: updateTarget.path,
        gameDir: _gameInstallDir(),
        updateVoicePackZips: voicePacks.map(x => x.path),
        downloadKey: storage.namespace,
        storage,
      });
    },
    async *update() {
      if (diffs.length === 0) {
        await locale.alert(
          "CHECK_GAME_UPDATE_FAILED",
          "CHECK_GAME_UPDATE_FAILED_DESC"
        );
        return;
      }
      const updateTarget = diffs.find(x => x.version == gameCurrentVersion());
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
          updateTarget.voice_packs.map(async x => {
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
      yield* updateGameProgram({
        aria2,
        server,
        currentGameVersion: gameCurrentVersion(),
        updatedGameVersion: GAME_LATEST_VERSION,
        updateFileZip: updateTarget.path,
        gameDir: _gameInstallDir(),
        updateVoicePackZips: voicePacks.map(x => x.path),
        downloadKey: storage.namespace,
        storage,
      });
      batch(() => {
        setGameVersion(GAME_LATEST_VERSION);
      });
    },
    async *launch(config: Config) {
      if (
        gt(gameCurrentVersion(), CURRENT_SUPPORTED_VERSION) &&
        !config.patchOff
      ) {
        await locale.alert(
          "UNSUPPORTED_VERSION",
          "PLEASE_WAIT_FOR_LAUNCHER_UPDATE",
          [gameCurrentVersion()]
        );
        return;
      }
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
        const gameVersion = await getGameVersion(
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
    async createConfig() {
      return function () {
        return [];
      };
    },
  };
}

async function checkGameState(
  locale: Locale,
  server: Server,
  storage: Storage
) {
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
        (await getGameVersion(join(gameDir, server.dataDir))) || "0.0.0",
    } as const;
  } catch {
    return {
      gameInstalled: false,
    } as const;
  }
}

async function getLatestVersionInfo(
  server: Server
): Promise<LauncherResourceData> {
  const ret: LauncherResourceData = await (
    await fetch(server.update_url)
  ).json();
  return ret;
}
