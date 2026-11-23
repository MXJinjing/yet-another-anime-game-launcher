import { dxmtFrameRateOverride } from "@config/dxmt-refresh-rate";
import { join } from "path-browserify";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "@constants";
import { log } from "@logging/logger";
import {
  readBinary,
  removeFile,
  resolve,
  writeBinary,
  writeFile,
} from "@platform/neutralino";
import { utf16le } from "@runtime/binary";
import { mkdirp } from "@runtime/macos-filesystem";
import { getKeyOrDefault, globalStorage, type Storage } from "@runtime/storage";
import { Wine } from "@wine";
import { Config } from "@config";
import { getCustomEnvironmentVariables } from "@config";
import { normalizeHttpProxy } from "@config/proxy";
import {
  putLocal,
  patchProgram,
  patchRevertProgram,
  applyMhypBaseReplacement,
  isRuntimeReplacementError,
  revertMhypBaseReplacement,
} from "../patch";
import { GameAlreadyRunningError } from "../../launch-errors";
import {
  HKRPG_CN_BLOCK_URL,
  HKRPG_OS_BLOCK_URL,
  WEBVIEW_RENDER_METHOD_VALUE,
  WEBVIEW_RENDER_METHOD_ABTEST_PREFIX,
} from "../../secret";
import { getGameRegistryKey } from "../../game-data-paths";
import { buildBlockHosts } from "../block-hosts";
import {
  blockPrivilegedHosts,
  legacyBlockHosts,
} from "../../../system/privileged-hosts";
import { gt } from "semver";

export async function* launchGameProgram({
  gameDir,
  gameExecutable,
  wine,
  config,
  server,
  storage = globalStorage,
}: {
  gameDir: string;
  gameExecutable: string;
  wine: Wine;
  config: Config;
  server: Server;
  storage?: Storage;
}): TaskProgram {
  const blockUrl =
    server.id == "hkrpg_global" ? HKRPG_OS_BLOCK_URL : HKRPG_CN_BLOCK_URL;
  const blockHosts = config.blockNet
    ? buildBlockHosts(config, [{ domain: blockUrl, ip: "0.0.0.0" }])
    : [];
  const gameExecutablePath = join(gameDir, gameExecutable);
  const processMonitor = wine.createGameProcessMonitor(gameExecutablePath, {
    exitOnWindowClose: config.exitOnWindowClose === true,
  });
  if (await processMonitor.isRunning()) {
    throw new GameAlreadyRunningError(gameExecutablePath);
  }
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "PATCHING"];

  await fixWebview(wine, server);
  await wine.setProps(config);
  if (wine.attributes.renderBackend == "dxmt") await wine.setNVExtension();

  const cmd = `@echo off
cd "%~dp0"
cd /d "${wine.toWinePath(gameDir)}"
"${wine.toWinePath(resolve("./jadeite/jadeite.exe"))}" "${wine.toWinePath(
    join(gameDir, gameExecutable)
  )}"`;
  await writeFile(resolve("config.bat"), cmd);
  yield* patchProgram(gameDir, wine, server, config, undefined, storage);
  let mhypBaseReplaced = false;
  try {
    mhypBaseReplaced = await applyMhypBaseReplacement(gameDir, config);
  } catch (error) {
    if (!isRuntimeReplacementError(error)) throw error;
    await log(`Runtime replacement validation failed: ${String(error)}`);
    try {
      await removeFile(resolve("config.bat"));
      yield* patchRevertProgram(gameDir, wine, server, config, storage);
    } catch (cleanupError) {
      await log(
        `Runtime replacement failure cleanup failed: ${String(cleanupError)}`
      );
    }
    throw error;
  }
  await mkdirp(resolve("./logs"));
  const yaaglDir = resolve("./");
  let startupTimedOut = false;
  try {
    const logfile = resolve(`./logs/game_${Date.now()}.log`);

    if (config.blockNet) {
      await blockPrivilegedHosts(blockHosts, config.blockNetDuration, () =>
        legacyBlockHosts(blockHosts, config.blockNetDuration)
      );
    }

    yield ["setStateText", "GAME_STARTING"];
    let launchError: unknown;
    void wine
      .exec2(
        "cmd",
        ["/c", `${wine.toWinePath(resolve("./config.bat"))}`],
        {
          MTL_HUD_ENABLED: config.metalHud ? "1" : "",
          WINEDLLOVERRIDES: "",
          ...(wine.attributes.renderBackend == "dxmt"
            ? {
                WINEMSYNC: "1",
                DXMT_LOG_PATH: yaaglDir,
                DXMT_CONFIG: `${dxmtFrameRateOverride(config.dxmtRefreshRate)}${
                  config.vsyncDisable ? "dxgi.syncInterval=0;" : ""
                }${
                  config.metalFxEnable
                    ? `d3d11.metalSpatialUpscaleFactor=${config.metalFxFactor};`
                    : ""
                }dxgi.customVendorId=10de;dxgi.customDeviceId=2684`,
                DXMT_METALFX_SPATIAL_SWAPCHAIN: config.metalFxEnable ? "1" : "",
                DXMT_CONFIG_FILE: join(yaaglDir, "dxmt.conf"),
                DXMT_ENABLE_NVEXT: "1",
                GST_PLUGIN_FEATURE_RANK: "atdec:MAX,avdec_h264:MAX",
              }
            : {
                WINEESYNC: "1",
              }),
          ...(config.proxyEnabled
            ? {
                HTTP_PROXY: normalizeHttpProxy(config.proxyHost),
                HTTPS_PROXY: normalizeHttpProxy(config.proxyHost),
              }
            : {}),
          ...getCustomEnvironmentVariables(config),
        },
        logfile
      )
      .catch(error => {
        launchError = error;
      });

    const startState = await processMonitor.waitForStart();
    if (startState === "timed-out") {
      startupTimedOut = true;
      throw new Error(
        `The game process did not appear within the startup timeout (${gameExecutable})`
      );
    }
    yield ["setStateText", "GAME_RUNNING"];
    // The Jadeite wrapper is not the game lifetime. It may remain attached
    // after the real game process appears, so monitor the target independently
    // and only log a late wrapper failure.
    const exitState = await processMonitor.waitForExit();
    if (exitState === "unknown") {
      await wine.waitForWineServerExit({ timeoutMs: 0 });
    } else {
      await wine.waitForWineServerExit({ timeoutMs: 5_000 });
    }
    if (exitState === "crashed") {
      await log(`Game crash detected: ${gameExecutable}`);
      yield ["setStateText", "GAME_CRASHED"];
    }
    if (launchError !== undefined) await log(String(launchError));
  } catch (e: unknown) {
    // it seems game crashed?
    await log(String(e));
    if (startupTimedOut) await wine.killAll();
  }

  if (mhypBaseReplaced) await revertMhypBaseReplacement(gameDir);
  await removeFile(resolve("config.bat"));
  yield ["setStateText", "REVERT_PATCHING"];
  yield* patchRevertProgram(gameDir, wine, server, config, storage);
}

async function fixWebview(wine: Wine, server: Server) {
  const key = getGameRegistryKey(server.id);
  if (!key) return;

  const reg = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[${key}]`,
    `"${WEBVIEW_RENDER_METHOD_VALUE}"=-`,
  ];

  try {
    await wine.exec("reg", ["query", key], {}, resolve("fix_webview.log"));

    // the output contains malformed CJK characters
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const output = decoder.decode(await readBinary(resolve("fix_webview.log")));

    for (let line of output.split("\n")) {
      line = line.trim();
      if (line.startsWith(WEBVIEW_RENDER_METHOD_ABTEST_PREFIX)) {
        const abtest = line.split(" ", 2)[0];
        reg.push(`"${abtest}"=-`);
      }
    }
  } catch (e: unknown) {
    return;
  }

  await writeBinary(resolve("fix_webview.reg"), utf16le(reg.join("\r\n")));
  await wine.exec(
    "reg",
    ["import", `${wine.toWinePath(resolve("./fix_webview.reg"))}`],
    {},
    "/dev/null"
  );
}
