import { join } from "path-browserify";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "../../../constants";
import { log } from "@logging/logger";
import {
  fileOrDirExists,
  readBinary,
  removeFile,
  removeFileIfExists,
  resolve,
  writeBinary,
  writeFile,
} from "@platform/neutralino";
import { utf16le } from "@runtime/binary";
import { cp, mkdirp } from "@runtime/macos-filesystem";
import { getKeyOrDefault, globalStorage, type Storage } from "@runtime/storage";
import { Wine } from "../../../wine";
import { Config } from "@config";
import { getCustomEnvironmentVariables } from "@config";
import { normalizeHttpProxy } from "@config/proxy";
import {
  putLocal,
  patchProgram,
  patchRevertProgram,
  applyMhypBaseReplacement,
  isRuntimeReplacementFileMissingError,
  revertMhypBaseReplacement,
} from "../patch";
import { NAP_CN_BLOCK_URL, NAP_OS_BLOCK_URL } from "../../secret";
import { buildBlockHosts } from "../block-hosts";
import {
  blockPrivilegedHosts,
  legacyBlockHosts,
} from "../../../system/privileged-hosts";
import { gt } from "semver";
import { removeMetalFxGpuInfo, writeMetalFxGpuInfo } from "./config/metalfx";

async function logInternalProgress(program: TaskProgram) {
  for await (const command of program) {
    if (command[0] == "setRawStateText") await log(command[1]);
    if (command[0] == "setStateText") await log(command[1]);
  }
}

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
    server.id == "nap_global" ? NAP_OS_BLOCK_URL : NAP_CN_BLOCK_URL;
  const blockHosts = config.blockNet
    ? buildBlockHosts(config, [{ domain: blockUrl, ip: "0.0.0.0" }])
    : [];
  const processMonitor = wine.createGameProcessMonitor(gameExecutable);
  if (await processMonitor.isRunning()) {
    throw new Error(
      `The game process is already running in Wine prefix ${wine.prefix}`
    );
  }
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "GAME_STARTING"];

  // ZZZ exposes DLSS only through its NVIDIA path. "MetalFX" in the launcher
  // enables the DLSS-to-MetalFX replacement: the game is told it runs on an
  // NVIDIA card (gpuinfo + registry markers + nvngx bridge) and its DLSS
  // requests are translated to MetalFX by the patched DXMT runtime. When
  // MetalFX is off we stay on the plain DXMT D3D11 path and clean any NVIDIA
  // leftovers so a previous MetalFX run cannot influence device detection.
  const metalFxEnabled = config.napMetalFxEnable === true;
  // The NVIDIA vendor extension markers are needed by the DLSS runtime that
  // loads the bridge, on DXMT as well as on D3DMetal (Game Porting Toolkit).
  if (metalFxEnabled) {
    await wine.setNVExtension();
  } else {
    await wine.clearNVExtension();
  }

  await fixWebview(wine, server);
  await wine.setProps(config);

  const args = [];
  if (config.resolutionCustom) {
    args.push("-screen-width", config.resolutionWidth);
    args.push("-screen-height", config.resolutionHeight);
    args.push("-screen-fullscreen", "0");
  }
  if (config.useD3D12) args.push("-use-d3d12");
  const cmd = `@echo off
cd "%~dp0"
copy "${wine.toWinePath(
    join(gameDir, atob("SG9Zb0tQcm90ZWN0LnN5cw=="))
  )}" "%WINDIR%\\system32\\"
cd /d "${wine.toWinePath(gameDir)}"
"${wine.toWinePath(join(gameDir, gameExecutable))}" ${args.join(" ")}`;
  await writeFile(resolve("config.bat"), cmd);
  await logInternalProgress(
    patchProgram(gameDir, wine, server, config, undefined, storage)
  );
  if (!wine.wineRoot) {
    throw new Error(
      "Cannot install the NVIDIA bridge without a resolved Wine root"
    );
  }
  const wineLibNvngx = join(wine.wineRoot, "lib/wine/x86_64-windows/nvngx.dll");
  const system32Nvngx = join(
    wine.prefix,
    "drive_c",
    "windows",
    "system32",
    "nvngx.dll"
  );
  // The NVIDIA bridge only belongs to DXMT distributions. Other runtimes
  // (e.g. Game Porting Toolkit D3DMetal) ship their own nvngx-on-metalfx and
  // must never have it deleted here.
  if (wine.attributes.renderBackend == "dxmt") {
    if (metalFxEnabled) {
      // Keep the bridge in sync with the MetalFX switch on every launch: the
      // cached file patch is not re-applied once recorded, so toggling
      // MetalFX must install/remove nvngx.dll here instead of patchProgram.
      await cp(`./dxmt/nvngx.dll`, wineLibNvngx);
      await cp(`./dxmt/nvngx.dll`, system32Nvngx);
    } else {
      await removeFileIfExists(wineLibNvngx);
      await removeFileIfExists(system32Nvngx);
    }
  } else if (metalFxEnabled) {
    // Apple's Game Porting Toolkit ships the DLSS-to-MetalFX bridge itself
    // (nvngx-on-metalfx.dll + nvapi64.dll). The game loads nvngx.dll from
    // System32, so install the toolkit's bridge there under both names and
    // replace any DXMT bridge left over from an earlier DXMT run.
    const gptkWindowsDir = join(wine.wineRoot, "lib/wine/x86_64-windows");
    const system32Dir = join(wine.prefix, "drive_c", "windows", "system32");
    const metalfxBridge = join(gptkWindowsDir, "nvngx-on-metalfx.dll");
    try {
      if (await fileOrDirExists(metalfxBridge)) {
        await cp(metalfxBridge, join(system32Dir, "nvngx-on-metalfx.dll"));
        await cp(metalfxBridge, join(system32Dir, "nvngx.dll"));
      }
      const nvapi = join(gptkWindowsDir, "nvapi64.dll");
      if (await fileOrDirExists(nvapi)) {
        await cp(nvapi, join(system32Dir, "nvapi64.dll"));
      }
    } catch (error) {
      await log(
        `Failed to install the Game Porting Toolkit NV bridge: ${String(error)}`
      );
    }
  }
  let mhypBaseReplaced = false;
  try {
    mhypBaseReplaced = await applyMhypBaseReplacement(gameDir, config);
  } catch (error) {
    if (!isRuntimeReplacementFileMissingError(error)) throw error;
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
  await writeMetalFxGpuInfo(wine.prefix, config.napMetalFxEnable === true);
  try {
    const logfile = resolve(`./logs/game_${Date.now()}.log`);

    if (config.blockNet) {
      await blockPrivilegedHosts(blockHosts, config.blockNetDuration, () =>
        legacyBlockHosts(blockHosts, config.blockNetDuration)
      );
    }

    let launchError: unknown;
    void wine
      .exec2(
        config.steamPatch ? "C:\\windows\\system32\\steam.exe" : "cmd",
        config.steamPatch
          ? [
              wine.toWinePath(join(gameDir, gameExecutable)),
              ...(config.useD3D12 ? ["-use-d3d12"] : []),
            ]
          : ["/c", `${wine.toWinePath(resolve("./config.bat"))} `],
        {
          MTL_HUD_ENABLED: config.metalHud ? "1" : "",
          WINEDLLOVERRIDES: "",
          WINE_ENABLE_TIMEOUT_FIX: config.timeoutFix ? "1" : "0",
          ...(wine.attributes.renderBackend == "dxmt"
            ? {
                WINEMSYNC: "1",
                DXMT_LOG_PATH: yaaglDir,
                DXMT_CONFIG_FILE: join(yaaglDir, "dxmt.conf"),
                GST_PLUGIN_FEATURE_RANK: "atdec:MAX,avdec_h264:MAX",
                DXMT_CONFIG: `d3d11.preferredMaxFrameRate=${
                  config.preferredMaxFps
                };${config.vsyncDisable ? "dxgi.syncInterval=0;" : ""}${
                  metalFxEnabled
                    ? `d3d11.metalSpatialUpscaleFactor=${config.metalFxFactor};dxgi.customVendorId=10de;dxgi.customDeviceId=2684`
                    : ""
                }`,
                ...(metalFxEnabled
                  ? {
                      DXMT_METALFX_SPATIAL_SWAPCHAIN: "1",
                      DXMT_ENABLE_NVEXT: "1",
                    }
                  : {}),
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
    // A non-DXMT runtime (Game Porting Toolkit) may spend a long time on the
    // first launch while Wine updates the shared prefix, so allow more time.
    const startState = await processMonitor.waitForStart(
      wine.attributes.renderBackend == "dxmt"
        ? undefined
        : { timeoutMs: 180_000 }
    );
    if (startState === "timed-out") {
      startupTimedOut = true;
      throw new Error(
        `The game process did not appear within the startup timeout (${gameExecutable})`
      );
    }
    yield ["setStateText", "GAME_RUNNING"];
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

  await removeMetalFxGpuInfo(wine.prefix);

  if (mhypBaseReplaced) await revertMhypBaseReplacement(gameDir);
  if (config.resolutionCustom) {
    await revertResolutionRegistry(wine, server);
  }

  // await removeFile(resolve("bWh5cHJvdDJfcnVubmluZy5yZWcK.reg"));
  await removeFile(resolve("config.bat"));
  yield ["setStateText", "REVERT_PATCHING"];
  await logInternalProgress(
    patchRevertProgram(gameDir, wine, server, config, storage)
  );
}

async function fixWebview(wine: Wine, server: Server) {
  let key = "HKEY_CURRENT_USER\\Software\\\x6d\x69\x48\x6f\x59\x6f\\";
  if (server.id === "nap_cn") {
    key += "\u7edd\u533a\u96f6";
  } else if (server.id === "nap_global") {
    key += "\x5a\x65\x6e\x6c\x65\x73\x73\x5a\x6f\x6e\x65\x5a\x65\x72\x6f";
  } else {
    return;
  }

  const reg = [
    `Windows Registry Editor Version 5.00`,
    ``,
    `[${key}]`,
    `"MIHOYOSDK_WEBVIEW_RENDER_METHOD_h1573598267"=-`,
  ];

  try {
    await wine.exec("reg", ["query", key], {}, resolve("fix_webview.log"));

    // the output contains malformed CJK characters
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const output = decoder.decode(await readBinary(resolve("fix_webview.log")));

    for (let line of output.split("\n")) {
      line = line.trim();
      if (line.startsWith("HOYO_WEBVIEW_RENDER_METHOD_ABTEST_")) {
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

async function revertResolutionRegistry(wine: Wine, server: Server) {
  let key = "HKEY_CURRENT_USER\\Software\\\x6d\x69\x48\x6f\x59\x6f\\";
  if (server.id === "nap_cn") {
    key += "\u7edd\u533a\u96f6";
  } else if (server.id === "nap_global") {
    key += "\x5a\x65\x6e\x6c\x65\x73\x73\x5a\x6f\x6e\x65\x5a\x65\x72\x6f";
  } else {
    return;
  }

  try {
    const reg = [`Windows Registry Editor Version 5.00`, ``, `[${key}]`];
    await wine.exec("reg", ["query", key], {}, resolve("fix_resolution.log"));
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const output = decoder.decode(
      await readBinary(resolve("fix_resolution.log"))
    );

    for (let line of output.split("\r\n")) {
      line = line.trim();
      if (
        line.startsWith("Screenmanager Is Fullscreen mode_") ||
        line.startsWith("Screenmanager Resolution_")
      ) {
        const value = line.split(" ", 2)[0]; // FIXME: spaces in key?
        // It seems that unity didn't use spaces in keys
        reg.push(`"${value}"=-`);
      }
    }

    if (reg.length > 3) {
      await writeBinary(
        resolve("fix_resolution.reg"),
        utf16le(reg.join("\r\n"))
      );
      await wine.exec(
        "reg",
        ["import", `${wine.toWinePath(resolve("./fix_resolution.reg"))}`],
        {},
        "/dev/null"
      );
    }
  } catch {
    return;
  }
}
