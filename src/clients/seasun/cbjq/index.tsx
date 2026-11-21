import { isWineRuntimeReady } from "@wine/distro";
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
import { exec } from "@runtime/command-runner";
import { getFreeSpace } from "@runtime/macos-filesystem";
import { globalStorage, type Storage } from "@runtime/storage";
import { join } from "path-browserify";
import {
  isNewerGameVersion,
  readGameVersion,
  readInstalledGameVersion,
  requireGameVersion,
} from "../../game-version";
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
import { GameVersionUnreadableError } from "../../launch-errors";

const getGameVersion = async (gameDir: string) => {
  const local_manifest = join(gameDir, "manifest.json");
  const content = await readFile(local_manifest);
  try {
    const localResourceData: LauncherResourceData = JSON.parse(content);
    return localResourceData.projectVersion;
  } catch {
    throw new GameVersionUnreadableError(
      `Failed to parse the local manifest: ${local_manifest}`
    );
  }
};

const CURRENT_SUPPORTED_VERSION = "2.0.0";

export async function createCBJQChannelClient({
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
  let resourceData: LauncherResourceData = {
    projectVersion: "0.0.0",
    hashList: [],
  } as unknown as LauncherResourceData;
  let isFallback = false;
  let versionLoaded = false;
  const loadVersionInfo = async () => {
    const latest = await getLatestVersionInfo(server);
    requireGameVersion(latest.projectVersion);
    resourceData = latest;
    versionLoaded = true;
  };
  const localGameState = await checkGameState(locale, server, storage);
  if (localGameState.gameInstalled)
    try {
      await loadVersionInfo();
    } catch {
      isFallback = true;
      resourceData = {
        projectVersion: "0.0.0",
        hashList: [],
      } as unknown as LauncherResourceData;
    }
  let GAME_LATEST_VERSION: string = resourceData.projectVersion || "0.0.0";

  const isUiFallback = isFallback;
  const fallbackBg = "linear-gradient(135deg, #0ba360 0%, #3cba92 100%)";

  const { gameInstalled, gameInstallDir, gameVersion } = localGameState;
  const initialVersion = readGameVersion(gameVersion) ?? "0.0.0";
  if (gameInstalled && initialVersion === "0.0.0") {
    await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
  }

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
  const [gameCurrentVersion, setGameVersion] = createSignal(initialVersion);
  const updateRequired = () =>
    isNewerGameVersion(GAME_LATEST_VERSION, gameCurrentVersion());
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
    runtimeReady: () => isWineRuntimeReady(wine.attributes, runtimeReady()),
    async refreshRuntimeReady() {
      setRuntimeReady(await isDXMTInstalled());
    },
    async *continueInstall(): TaskProgram {
      if (wine.attributes.renderBackend == "dxmt") {
        yield* checkAndDownloadDXMT(aria2, storage.namespace);
        setRuntimeReady(true);
      }
    },
    async *install(selection: string): TaskProgram {
      if (!versionLoaded) {
        try {
          await loadVersionInfo();
          GAME_LATEST_VERSION = resourceData.projectVersion || "0.0.0";
        } catch {
          await locale.alert(
            "CHECK_GAME_UPDATE_FAILED",
            "CHECK_GAME_UPDATE_FAILED_DESC"
          );
          return;
        }
      }
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
      const versionRead = await readInstalledGameVersion(() =>
        getGameVersion(selection)
      );
      if (versionRead.status === "missing") throw versionRead.error;
      if (versionRead.status === "unavailable") {
        await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
        return;
      }
      const gameVersion = versionRead.version;
      if (isNewerGameVersion(gameVersion, CURRENT_SUPPORTED_VERSION)) {
        await locale.alert(
          "UNSUPPORTED_VERSION",
          "PLEASE_WAIT_FOR_LAUNCHER_UPDATE",
          [gameVersion]
        );
        return;
      } else if (isNewerGameVersion(GAME_LATEST_VERSION, gameVersion)) {
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
      // IMPLEMENT ME
    },
    async *update() {
      if (gameCurrentVersion() === "0.0.0") {
        await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
        return;
      }
      if (!versionLoaded) {
        await locale.alert(
          "CHECK_GAME_UPDATE_FAILED",
          "CHECK_GAME_UPDATE_FAILED_DESC"
        );
        return;
      }
      yield* updateGameProgram({
        resourceData,
        aria2,
        gameDir: _gameInstallDir(),
        server,
        downloadKey: storage.namespace,
        storage,
      });
      batch(() => {
        setGameVersion(GAME_LATEST_VERSION);
      });
    },
    async *launch(config: Config) {
      if (gameCurrentVersion() === "0.0.0") {
        await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
        return;
      }
      if (
        isNewerGameVersion(gameCurrentVersion(), CURRENT_SUPPORTED_VERSION) &&
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
        gameExecutable: "Game/Binaries/Win64/Game.exe",
        config,
        server,
        storage,
      });
    },
    async *checkIntegrity() {
      if (!versionLoaded) {
        await locale.alert(
          "CHECK_GAME_UPDATE_FAILED",
          "CHECK_GAME_UPDATE_FAILED_DESC"
        );
        return;
      }
      yield* checkIntegrityProgram({
        resourceData,
        aria2,
        gameDir: _gameInstallDir(),
        server,
        downloadKey: storage.namespace,
        storage,
      });

      if (gameCurrentVersion() === "0.0.0") {
        const result = await readInstalledGameVersion(() =>
          getGameVersion(_gameInstallDir())
        );
        if (result.status === "missing") throw result.error;
        if (result.status === "version") setGameVersion(result.version);
        if (result.status === "unavailable") {
          await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
        }
      }
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
      const result = await readInstalledGameVersion(() =>
        getGameVersion(selection)
      );
      if (result.status === "missing") {
        batch(() => {
          setInstalled("NOT_INSTALLED");
          setGameInstallDir(selection);
          setGameVersion("0.0.0");
        });
        await setKey("game_install_dir", selection);
        return;
      }
      batch(() => {
        setInstalled("INSTALLED");
        setGameInstallDir(selection);
        setGameVersion(result.status === "version" ? result.version : "0.0.0");
      });
      await setKey("game_install_dir", selection);
      if (result.status === "unavailable") {
        await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
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
        yield* patchRevertProgram(_gameInstallDir(), wine, config, storage);
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
  const result = await readInstalledGameVersion(() => getGameVersion(gameDir));
  if (result.status === "missing") {
    return {
      gameInstalled: false,
    } as const;
  }
  return {
    gameInstalled: true,
    gameInstallDir: gameDir,
    gameVersion: result.status === "version" ? result.version : "0.0.0",
  } as const;
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
