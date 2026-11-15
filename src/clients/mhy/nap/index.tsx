import type { SophonInstallSelection } from "../../../integrations/sophon-install-options";
import { isWineRuntimeReady } from "@wine/distro";
import { batch, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { Divider } from "@hope-ui/solid";
import { type TaskProgram } from "@tasks/task-program";
import {
  ChannelClient,
  ChannelClientBackground,
  ChannelClientInstallState,
} from "../../../channel-client";
import { Server } from "../../../constants";
import { Locale } from "../../../locale";
import { md5 } from "@runtime/patching";
import { globalStorage, type Storage } from "@runtime/storage";
import { join } from "path-browserify";
import { isNewerGameVersion, readGameVersion } from "../../game-version";
import { Config } from "@config";
import { launchGameProgram } from "./program-launch-game";
import { patchRevertProgram } from "../patch";
import type { SophonOnlineGameInfo } from "@sophon";
import { createSophonGame, sophonPredownloadVersion } from "../sophon-game";
import { Aria2 } from "@aria2";
import { Wine } from "@wine";
import {
  checkAndDownloadDXMT,
  checkAndDownloadDXVK,
  checkAndDownloadReshade,
  isDXMTInstalled,
} from "@wine/runtime-resources";
import createPatchOff from "./config/patch-off";
import createResolution from "./config/resolution";
import createBlockNet from "./config/block-net";
import { getDefaultBlockHostsText } from "../block-hosts";
import { NAP_CN_BLOCK_URL, NAP_OS_BLOCK_URL } from "../../secret";
import createSteamPatch from "./config/steam-patch";
import createTimeoutFix from "./config/timeout-fix";
import createMetalFx from "./config/metalfx";
import createDirectX12 from "./config/directx12";
import createMhypBaseReplacement from "../hk4e/config/runtime-replacement";
import { getGameVersion as _getGameVersion } from "../unity";
import { HoyoConnectGameBackgroundType } from "../launcher-info";
import {
  getLatestLauncherContent,
  mapBackgroundsToUiContent,
} from "../hyp-connect";
import { NAP_GAME_LOG_LOCATIONS } from "../../game-log-paths";

// no need to check supported version
// const CURRENT_SUPPORTED_VERSION = "3.0.0";

export async function getGameVersion(gameDataDir: string, offset: number) {
  const ret = await _getGameVersion(gameDataDir, offset);
  const res = join(gameDataDir, "resources.assets");
  // dirty fix
  const md5sum = (await md5(res)).toLowerCase();
  if (md5sum == "9210cde58b1d5df1a3224c3786139e01") return "1.0.1";
  return ret;
}

export async function createNAPChannelClient({
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
  const fallbackBg = "linear-gradient(135deg, #fa709a 0%, #fee140 100%)";
  const sophon = createSophonGame(server, locale, storage, "nap");
  const readInstalledVersion = (directory: string) =>
    getGameVersion(join(directory, server.dataDir), 0xc4);
  const [gameInfo, setGameInfo] = createSignal<SophonOnlineGameInfo>();
  const latestVersion = () => gameInfo()?.version ?? "0.0.0";

  async function loadVersionInfo(directory?: string) {
    try {
      const info = await sophon.online(directory);
      setGameInfo(info);
      return info;
    } catch {
      await locale.alert(
        "CHECK_GAME_UPDATE_FAILED",
        "CHECK_GAME_UPDATE_FAILED_DESC"
      );
      return undefined;
    }
  }

  const localGameState = await checkGameState(locale, server, storage);
  if (localGameState.gameInstalled) {
    await loadVersionInfo(localGameState.gameInstallDir);
  }

  const { gameInstalled, gameInstallDir, gameVersion } = localGameState;
  const initialVersion = readGameVersion(gameVersion) ?? "0.0.0";
  if (gameInstalled && initialVersion === "0.0.0") {
    await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
  }

  const [installed, setInstalled] = createSignal<ChannelClientInstallState>(
    gameInstalled ? "INSTALLED" : "NOT_INSTALLED"
  );
  const [runtimeReady, setRuntimeReady] = createSignal(await isDXMTInstalled());
  const [_gameInstallDir, setGameInstallDir] = createSignal(
    gameInstallDir ?? ""
  );
  const [gameCurrentVersion, setGameVersion] = createSignal(initialVersion);
  const updateRequired = () =>
    Boolean(gameInfo()?.needs_resume) ||
    isNewerGameVersion(latestVersion(), gameCurrentVersion());
  const predownloadVersion = () =>
    sophonPredownloadVersion(gameInfo(), gameCurrentVersion());
  const [showPredownloadPrompt, setShowPredownloadPrompt] = createSignal(
    gameInstalled &&
      Boolean(predownloadVersion()) &&
      (await getKeyOrDefault("predownloaded_all", "NOTFOUND")) !==
        predownloadVersion()
  );

  async function refreshInstalledVersion(directory = _gameInstallDir()) {
    const version =
      readGameVersion(await readInstalledVersion(directory)) ?? "0.0.0";
    setGameVersion(version);
    setGameInfo(info => info && { ...info, needs_resume: false });
  }

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
    iconImage: icon,
    url: icon_link,
    channelName: isAdvFallback ? server.id : undefined,
    fallbackBackground: isAdvFallback ? fallbackBg : undefined,
  });
  return {
    installState: installed,
    showPredownloadPrompt,
    installDir: _gameInstallDir,
    gameExecutable: () => server.executable,
    gameLogLocations: NAP_GAME_LOG_LOCATIONS,
    gameVersion: gameCurrentVersion,
    latestVersion,
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
    predownloadVersion,
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
    installOptions: sophon.installOptions,
    async *install(
      selection: string,
      options?: SophonInstallSelection
    ): TaskProgram {
      const info = await loadVersionInfo(selection);
      if (!info) return;
      yield* sophon.install(selection, info, options);
      await refreshInstalledVersion(selection);
      batch(() => {
        setInstalled("INSTALLED");
        setGameInstallDir(selection);
      });
      await setKey("game_install_dir", selection);
      if (wine.attributes.renderBackend === "dxmt") {
        yield* checkAndDownloadDXMT(aria2, storage.namespace);
      }
      setRuntimeReady(true);
    },
    async *predownload() {
      setShowPredownloadPrompt(false);
      if (!(await loadVersionInfo(_gameInstallDir()))) return;
      const target = predownloadVersion();
      if (!target) return;
      yield* sophon.predownload(
        _gameInstallDir(),
        gameCurrentVersion(),
        target
      );
    },
    async *update() {
      const info = await loadVersionInfo(_gameInstallDir());
      if (!info) return;
      yield* sophon.update(
        _gameInstallDir(),
        gameCurrentVersion(),
        info.version
      );
      await refreshInstalledVersion();
    },
    async *launch(config: Config) {
      if (gameCurrentVersion() === "0.0.0") {
        await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
        return;
      }
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
      yield* sophon.repair(_gameInstallDir(), gameCurrentVersion());
      await refreshInstalledVersion();
    },
    async changeInstallDir(selection: string) {
      setGameInfo(info => info && { ...info, needs_resume: false });
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
          join(selection, server.dataDir),
          0xc4
        );
        batch(() => {
          setInstalled("INSTALLED");
          setGameInstallDir(selection);
          setGameVersion(readGameVersion(gameVersion) ?? "0.0.0");
        });
        if (gameCurrentVersion() === "0.0.0") {
          await locale.alert("GAME_VERSION_INVALID", "GAME_VERSION_UNREADABLE");
        }
      } catch {
        batch(() => {
          setInstalled("NOT_INSTALLED");
          setGameInstallDir(selection);
          setGameVersion("0.0.0");
        });
      }
      await setKey("game_install_dir", selection);
      if (installed() === "INSTALLED") await loadVersionInfo(selection);
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
        yield* sophon.repair(_gameInstallDir(), gameCurrentVersion());
        await refreshInstalledVersion();
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
      const [RES] = await createResolution({ locale, config, storage });
      const blockUrl =
        server.id == "nap_global" ? NAP_OS_BLOCK_URL : NAP_CN_BLOCK_URL;
      const defaultHosts =
        server.id == "nap_global"
          ? [{ domain: blockUrl, ip: "0.0.0.0" }]
          : [
              { domain: "globaldp-prod-cn01.juequling.com", ip: "0.0.0.0" },
              { domain: "globaldp-prod-cn02.juequling.com", ip: "0.0.0.0" },
            ];
      const [BN] = await createBlockNet({
        locale,
        config,
        defaultHostsText: getDefaultBlockHostsText(defaultHosts),
        storage,
      });
      const [SP] = await createSteamPatch({ locale, config, storage });
      const [TF] = await createTimeoutFix({ locale, config, storage });
      const [DX12] = await createDirectX12({
        locale,
        config,
        storage,
        supported: () => wine.attributes.supportsD3d12 === true,
      });
      const [MFX] = await createMetalFx({
        locale,
        config,
        storage,
      });

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
          return (
            <>
              <RES />
              <Divider />
              <DX12 />
              <Divider />
              <MFX />
            </>
          );
        },
        enableMetalFxUpscale: false,
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
        (await getGameVersion(join(gameDir, server.dataDir), 0xc4)) || "0.0.0",
    } as const;
  } catch {
    return {
      gameInstalled: false,
    } as const;
  }
}
