import { join } from "path-browserify";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "../../../constants";
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
import { Wine } from "../../../wine";
import { Config } from "@config";
import { getCustomEnvironmentVariables } from "@config";
import { normalizeHttpProxy } from "@config/proxy";
import { putLocal, patchProgram, patchRevertProgram } from "../patch";
import { NAP_CN_BLOCK_URL, NAP_OS_BLOCK_URL } from "../../secret";
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
  yield ["setStateText", "PATCHING"];

  await fixWebview(wine, server);
  await wine.setProps(config);

  const args = [];
  if (config.resolutionCustom) {
    args.push("-screen-width", config.resolutionWidth);
    args.push("-screen-height", config.resolutionHeight);
    args.push("-screen-fullscreen", "0");
  }
  const cmd = `@echo off
cd "%~dp0"
copy "${wine.toWinePath(
    join(gameDir, atob("SG9Zb0tQcm90ZWN0LnN5cw=="))
  )}" "%WINDIR%\\system32\\"
cd /d "${wine.toWinePath(gameDir)}"
"${wine.toWinePath(join(gameDir, gameExecutable))}" ${args.join(" ")}`;
  await writeFile(resolve("config.bat"), cmd);
  yield* patchProgram(gameDir, wine, server, config, undefined, storage);
  await mkdirp(resolve("./logs"));
  const yaaglDir = resolve("./");
  let startupTimedOut = false;
  try {
    const logfile = resolve(`./logs/game_${Date.now()}.log`);

    if (config.blockNet) {
      await blockPrivilegedHosts(blockHosts, 20, () =>
        legacyBlockHosts(blockHosts, 20)
      );
    }

    yield ["setStateText", "GAME_STARTING"];
    let launchError: unknown;
    void wine
      .exec2(
        config.steamPatch ? "C:\\windows\\system32\\steam.exe" : "cmd",
        config.steamPatch
          ? [wine.toWinePath(join(gameDir, gameExecutable))]
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
                  config.metalFxEnable
                    ? `d3d11.metalSpatialUpscaleFactor=${config.metalFxFactor};`
                    : ""
                }`,
                DXMT_METALFX_SPATIAL_SWAPCHAIN: config.metalFxEnable ? "1" : "",
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

  if (config.resolutionCustom) {
    await revertResolutionRegistry(wine, server);
  }

  // await removeFile(resolve("bWh5cHJvdDJfcnVubmluZy5yZWcK.reg"));
  await removeFile(resolve("config.bat"));
  yield ["setStateText", "REVERT_PATCHING"];
  yield* patchRevertProgram(gameDir, wine, server, config, storage);
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
