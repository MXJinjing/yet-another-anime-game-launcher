import { batch, createSignal } from "solid-js";
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
import { waitImageReady } from "@runtime/async";
import { exec } from "@runtime/command-runner";
import { getFreeSpace } from "@runtime/macos-filesystem";
import { getKey, getKeyOrDefault, setKey } from "@runtime/storage";
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
}: {
  server: Server;
  locale: Locale;
  aria2: Aria2;
  wine: Wine;
}): Promise<ChannelClient> {
  let background: string;
  let url: string;
  let icon: string;
  let video_url: string;
  let theme_url: string;
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
    const advInfo = launcherContent.backgrounds[0];
    background = advInfo.background.url;
    url = advInfo.icon.link;
    icon = advInfo.icon.url;
    video_url = advInfo.video.url;
    theme_url = advInfo.theme.url;
    backgrounds = mapBackgroundsToUiContent(launcherContent.backgrounds);
    launcherIconButtons = launcherContent.launcherIconButtons;
    banners = launcherContent.content.banners;
    posts = launcherContent.content.posts;
    social_media_list = launcherContent.content.social_media_list;
  } catch {
    isAdvFallback = true;
    background = "";
    url = "";
    icon = "";
    video_url = "";
    theme_url = "";
  }
  // Preload every background image so switching between the fetched
  // launcher backgrounds does not wait on the network.
  for (const bg of backgrounds) {
    if (bg.background) {
      waitImageReady(bg.background).catch(() => undefined);
    }
  }
  const fallbackBg = "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)";
  let GAME_LATEST_VERSION: string;
  let diffs: LauncherResourceData["data"]["game"]["diffs"];
  let decompressed_path: string;
  let path: string;
  let pre_download_game: LauncherResourceData["data"]["pre_download_game"];
  let size: string;
  try {
    const versionInfo: LauncherResourceData = await getLatestVersionInfo(
      server
    );
    GAME_LATEST_VERSION = versionInfo.data.game.latest.version;
    diffs = versionInfo.data.game.diffs;
    decompressed_path = versionInfo.data.game.latest.decompressed_path;
    path = versionInfo.data.game.latest.path;
    size = versionInfo.data.game.latest.size;
    pre_download_game = versionInfo.data.pre_download_game;
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
  }
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
      pre_download_game != null && //exist pre_download_game data in server response
        (await getKeyOrDefault("predownloaded_all", "NOTFOUND")) ==
          "NOTFOUND" && // not downloaded yet
        gameInstalled && // game installed
        gt(pre_download_game.latest.version, gameVersion) // predownload version is greater
    );
  const [_gameInstallDir, setGameInstallDir] = createSignal(
    gameInstallDir ?? ""
  );
  const [gameCurrentVersion, setGameVersion] = createSignal(
    gameVersion ?? "0.0.0"
  );
  const updateRequired = () => lt(gameCurrentVersion(), GAME_LATEST_VERSION);
  return {
    installState: installed,
    showPredownloadPrompt,
    installDir: _gameInstallDir,
    gameLogLocations: BH3_GAME_LOG_LOCATIONS,
    gameVersion: gameCurrentVersion,
    latestVersion: () => GAME_LATEST_VERSION,
    updateRequired,
    uiContent: {
      background,
      background_video: video_url || undefined,
      background_theme: theme_url || undefined,
      backgrounds,
      launcherIconButtons,
      banners,
      posts,
      social_media_list,
      iconImage: icon,
      url,
      channelName: isAdvFallback ? server.id : undefined,
      fallbackBackground: isAdvFallback ? fallbackBg : undefined,
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
        yield* checkAndDownloadDXMT(aria2);
      }
      setRuntimeReady(true);
    },
    async *install(selection: string): TaskProgram {
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
        });
        if (wine.attributes.renderBackend == "dxmt") {
          yield* checkAndDownloadDXMT(aria2);
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
        yield* checkAndDownloadDXMT(aria2);
      }
      yield* checkAndDownloadJadeite(aria2);
      yield* launchGameProgram({
        gameDir: _gameInstallDir(),
        wine,
        gameExecutable: server.executable,
        config,
        server,
      });
    },
    async *checkIntegrity() {
      yield* checkIntegrityProgram({
        aria2,
        gameDir: _gameInstallDir(),
        remoteDir: decompressed_path,
      });
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
          aria2,
          gameDir: _gameInstallDir(),
          remoteDir: decompressed_path,
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
      gameVersion: await getGameVersion(join(gameDir, server.dataDir)),
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
