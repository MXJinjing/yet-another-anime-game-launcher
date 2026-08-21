import { batch, createSignal } from "solid-js";
import type { TaskProgram } from "@tasks/task-program";
import {
  ChannelClient,
  ChannelClientInstallState,
} from "../../../channel-client";
import { Server } from "../server";
import { Locale } from "@locale";
import { log } from "@logging/logger";
import { readFile, stats } from "@platform/neutralino";
import { assertValueDefined } from "@runtime/assertions";
import { waitImageReady } from "@runtime/async";
import { exec } from "@runtime/command-runner";
import { getFreeSpace } from "@runtime/macos-filesystem";
import { getKey, getKeyOrDefault, setKey } from "@runtime/storage";
import { join } from "path-browserify";
import { gt, lt } from "semver";
import { Config } from "@config";
// import { checkIntegrityProgram } from "../program-check-integrity";
// import {
//   predownloadGameProgram,
//   updateGameProgram,
// } from "./program-update-game";
import { downloadAndInstallGameProgram } from "./program-install-game";
import { launchGameProgram } from "./program-launch-game";
import { patchRevertProgram } from "./program-patch-game";
import { Aria2 } from "@aria2";
import { Wine } from "@wine";
import {
  checkAndDownloadDXMT,
  checkAndDownloadDXVK,
  checkAndDownloadJadeite,
  checkAndDownloadReshade,
  isDXMTInstalled,
} from "@wine/runtime-resources";
// import { getGameVersion } from "../unity";
import { LauncherResourceData } from "./launcher-info";
import { checkIntegrityProgram } from "./program-check-integrity";
import { updateGameProgram } from "./program-update-game";
import { CBJQ_GAME_LOG_LOCATIONS } from "../../game-log-paths";

const getGameVersion = async (gameDir: string) => {
  const local_manifest = join(gameDir, "manifest.json");
  const localResourceData: LauncherResourceData = await readFile(
    local_manifest
  ).then(content => {
    return JSON.parse(content);
  });
  return localResourceData.projectVersion;
};

const CURRENT_SUPPORTED_VERSION = "2.0.0";

export async function createCBJQChannelClient({
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
  let resourceData: LauncherResourceData;
  let isFallback = false;
  try {
    resourceData = await getLatestVersionInfo(server);
  } catch {
    isFallback = true;
    resourceData = {
      projectVersion: "0.0.0",
      hashList: [],
    } as unknown as LauncherResourceData;
  }
  const { projectVersion: GAME_LATEST_VERSION }: LauncherResourceData =
    resourceData;

  let isImageFallback = false;
  try {
    await waitImageReady(server.background_url);
  } catch {
    isImageFallback = true;
  }
  const isUiFallback = isFallback || isImageFallback;
  const fallbackBg = "linear-gradient(135deg, #0ba360 0%, #3cba92 100%)";

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
      false // TODO
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
    gameLogLocations: CBJQ_GAME_LOG_LOCATIONS,
    gameVersion: gameCurrentVersion,
    latestVersion: () => GAME_LATEST_VERSION,
    updateRequired,
    uiContent: {
      background: isUiFallback ? "" : server.background_url,
      iconImage: "",
      url: "",
      launchButtonLocation: "left",
      channelName: isUiFallback ? server.id : undefined,
      fallbackBackground: isUiFallback ? fallbackBg : undefined,
    },
    predownloadVersion: () => "", // TODO
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
      const local_manifest = join(selection, "manifest.json");
      try {
        await stats(local_manifest);
      } catch {
        const totalBytes = BigInt(
          resourceData.paks.reduce(
            (a, p) => a + Math.trunc(Number(p.sizeInBytes) || 0),
            0
          )
        );
        yield* downloadAndInstallGameProgram({
          aria2,
          gameDir: selection,
          resourceData,
          server,
          totalBytes,
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
      const gameVersion = await getGameVersion(selection);
      if (gt(gameVersion, CURRENT_SUPPORTED_VERSION)) {
        await locale.alert(
          "UNSUPPORTED_VERSION",
          "PLEASE_WAIT_FOR_LAUNCHER_UPDATE",
          [gameVersion]
        );
        return;
      } else if (lt(gameVersion, GAME_LATEST_VERSION)) {
        batch(() => {
          setInstalled("INSTALLED");
          setGameInstallDir(selection);
          setGameVersion(gameVersion);
        });
        await setKey("game_install_dir", selection);
        // FIXME: perform a integrity check?
      } else {
        yield* checkIntegrityProgram({
          resourceData,
          aria2,
          gameDir: selection,
          server,
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
      // IMPLEMENT ME
    },
    async *update() {
      yield* updateGameProgram({
        resourceData,
        aria2,
        gameDir: _gameInstallDir(),
        server,
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
        gameExecutable: "Game/Binaries/Win64/Game.exe",
        config,
        server,
      });
    },
    async *checkIntegrity() {
      yield* checkIntegrityProgram({
        resourceData,
        aria2,
        gameDir: _gameInstallDir(),
        server,
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
        yield* patchRevertProgram(_gameInstallDir(), wine, config);
      } catch {
        // yield* checkIntegrityProgram({
        //   aria2,
        //   gameDir: _gameInstallDir(),
        //   remoteDir: decompressed_path,
        // });
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
      gameVersion: await getGameVersion(gameDir),
    } as const;
  } catch {
    return {
      gameInstalled: false,
    } as const;
  }
}

async function fetch(url: string) {
  const { stdOut } = await exec(["curl", url]);
  await log(stdOut);
  return {
    async json() {
      return JSON.parse(stdOut);
    },
  };
}

async function getLatestVersionInfo(
  server: Server
): Promise<LauncherResourceData> {
  const ret: LauncherResourceData = await (await fetch(server.manifest)).json();
  return ret;
}
