import { join } from "path-browserify";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "../server";
import { log } from "@logging/logger";
import { removeFile, resolve, writeFile } from "@platform/neutralino";
import { mkdirp } from "@runtime/macos-filesystem";
import { Wine } from "@wine";
import { Config } from "@config";
import { getCustomEnvironmentVariables } from "@config";
import { normalizeHttpProxy } from "@config/proxy";
import { patchProgram, patchRevertProgram } from "./program-patch-game";

export async function* launchGameProgram({
  gameDir,
  gameExecutable,
  wine,
  config,
  server,
}: {
  gameDir: string;
  gameExecutable: string;
  wine: Wine;
  config: Config;
  server: Server;
}): TaskProgram {
  const processMonitor = wine.createGameProcessMonitor(gameExecutable);
  if (await processMonitor.isRunning()) {
    throw new Error(
      `The game process is already running in Wine prefix ${wine.prefix}`
    );
  }
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "PATCHING"];

  await wine.setProps(config);

  const cmd = `@echo off
cd "%~dp0"
cd /d "${wine.toWinePath(gameDir)}"
"${wine.toWinePath(
    join(gameDir, gameExecutable)
  )}" -FeatureLevelES31 -ChannelID=${server.channel}`;
  await writeFile(resolve("config.bat"), cmd);
  yield* patchProgram(gameDir, wine, config);
  await mkdirp(resolve("./logs"));
  let startupTimedOut = false;
  try {
    yield ["setStateText", "GAME_STARTING"];
    const logfile = resolve(`./logs/game_${Date.now()}.log`);
    const yaaglDir = resolve("./");
    let launchError: unknown;
    void wine
      .exec2(
        "cmd",
        ["/c", `${wine.toWinePath(resolve("./config.bat"))}`],
        {
          MTL_HUD_ENABLED: config.metalHud ? "1" : "",
          MVK_ALLOW_METAL_FENCES: "1",
          WINEDLLOVERRIDES: "d3d11,dxgi=n,b",
          ...(wine.attributes.renderBackend == "dxmt"
            ? {
                WINEMSYNC: "1",
                DXMT_LOG_PATH: yaaglDir,
                DXMT_CONFIG: `d3d11.preferredMaxFrameRate=${
                  config.preferredMaxFps
                };${config.vsyncDisable ? "dxgi.syncInterval=0;" : ""}${
                  config.metalFxEnable
                    ? `d3d11.metalSpatialUpscaleFactor=${config.metalFxFactor};`
                    : ""
                }`,
                DXMT_METALFX_SPATIAL_SWAPCHAIN: config.metalFxEnable ? "1" : "",
                DXMT_CONFIG_FILE: join(yaaglDir, "dxmt.conf"),
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

  await removeFile(resolve("config.bat"));
  yield ["setStateText", "REVERT_PATCHING"];
  yield* patchRevertProgram(gameDir, wine, config);
}
