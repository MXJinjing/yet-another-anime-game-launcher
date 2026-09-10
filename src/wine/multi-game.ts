import type { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import {
  exec,
  exec2,
  generateRandomString,
  mkdirp,
  rmrf_dangerously,
} from "@runtime";
import { build } from "@platform/shell";
import { getKey, setKey } from "@runtime/storage";
import { fileOrDirExists, stats, writeFile } from "@platform/neutralino";
import { resolve } from "@platform/neutralino/path";
import { dirname, join } from "path-browserify";
import { log } from "../logging/logger";
import { getWineDistributions } from "./distro";
import type { WineDistribution } from "./distro";
import { installWineEnvironmentProgram } from "./wine-install-program";
import {
  getWineDistroRoot,
  isWineDistroInstalled,
  isWineserverUnavailableError,
  type Wine,
} from "./wine";
import {
  createGameProcessMonitor,
  parseMacWineProcesses,
  parseTasklistCsv,
  parseWinedbgProcesses,
  type WineProcess,
} from "./game-process-monitor";
import { createNativeGameWindowState } from "./native-window-state";
import { migrateWineUserData, type WineUserDataDescriptor } from "./user-data";

export const SHARED_WINE_TAG = "__shared__";
export const AUTO_WINE_TAG = "__auto__";

/**
 * Wine prefixes are coupled to the Wine build that created them (Wine runs a
 * prefix update whenever another version opens them). Games that pin their own
 * Wine therefore get their own prefix, kept next to the global one, instead of
 * sharing the global prefix.
 */
export function getMultiGamePrefix(basePrefix: string, gameId: string) {
  return join(dirname(basePrefix), "wineprefixes", gameId);
}

export async function isMultiGamePrefixReady(prefix: string) {
  return await fileOrDirExists(join(prefix, "drive_c", "windows"));
}

/**
 * Copy an existing prefix into the per-game prefix location so the user keeps
 * their in-game settings, SDK device data and Wine registry entries instead of
 * starting over. Never overwrites an existing per-game prefix.
 */
export async function copyMultiGamePrefix({
  sourcePrefix,
  targetPrefix,
  exists = fileOrDirExists,
  makeDir = mkdirp,
  removeDirectory = rmrf_dangerously,
  copy = (source: string, target: string) => exec(["cp", "-a", source, target]),
}: {
  sourcePrefix: string;
  targetPrefix: string;
  exists?: (path: string) => Promise<boolean>;
  makeDir?: (path: string) => Promise<unknown>;
  removeDirectory?: (path: string) => Promise<unknown>;
  copy?: (source: string, target: string) => Promise<unknown>;
}): Promise<boolean> {
  if (sourcePrefix == targetPrefix) return false;
  if (!(await exists(sourcePrefix))) return false;
  if (await exists(targetPrefix)) return false;
  await makeDir(dirname(targetPrefix));
  await removeDirectory(targetPrefix);
  await copy(sourcePrefix, targetPrefix);
  return true;
}

export type MultiGameWineRef = { current: Wine };

export function createMultiGameWineProxy(ref: MultiGameWineRef): Wine {
  return {
    exec: (...args) => ref.current.exec(...args),
    exec2: (...args) => ref.current.exec2(...args),
    waitUntilServerOff: (...args) => ref.current.waitUntilServerOff(...args),
    waitForWineServerExit: (...args) =>
      ref.current.waitForWineServerExit(...args),
    createGameProcessMonitor: (...args) =>
      ref.current.createGameProcessMonitor(...args),
    cmd: (...args) => ref.current.cmd(...args),
    toWinePath: path => ref.current.toWinePath(path),
    get prefix() {
      return ref.current.prefix;
    },
    get wineRoot() {
      return ref.current.wineRoot;
    },
    openCmdWindow: (...args) => ref.current.openCmdWindow(...args),
    setProps: (...args) => ref.current.setProps(...args),
    setNVExtension: () => ref.current.setNVExtension(),
    clearNVExtension: () => ref.current.clearNVExtension(),
    setDistribution: (...args) => ref.current.setDistribution(...args),
    killAll: (...args) => ref.current.killAll(...args),
    get attributes() {
      return ref.current.attributes;
    },
  };
}

function legacyGameWineKey(gameId: string) {
  return `yaaglm_${gameId}_wine_tag`;
}

function legacyGameWineEnabledKey(gameId: string) {
  return `yaaglm_${gameId}_wine_enabled`;
}

/**
 * Keep the multi-game Wine selection in versioned keys. Older launchers only
 * know the legacy keys above, so they fall back to the shared Wine instead of
 * reading an unsupported tag (for example a system or custom Wine).
 */
function gameWineKey(gameId: string) {
  return `yaaglm_v2_${gameId}_wine_tag`;
}

function gameWineEnabledKey(gameId: string) {
  return `yaaglm_v2_${gameId}_wine_enabled`;
}

async function readOptionalKey(key: string) {
  try {
    return await getKey(key);
  } catch {
    return undefined;
  }
}

async function migrateMultiGameGameWineState(gameId: string) {
  const [versionedEnabled, versionedTag, legacyEnabled, legacyTag] =
    await Promise.all([
      readOptionalKey(gameWineEnabledKey(gameId)),
      readOptionalKey(gameWineKey(gameId)),
      readOptionalKey(legacyGameWineEnabledKey(gameId)),
      readOptionalKey(legacyGameWineKey(gameId)),
    ]);

  if (
    versionedEnabled == undefined &&
    versionedTag == undefined &&
    legacyEnabled == undefined &&
    legacyTag == undefined
  ) {
    return;
  }
  if (
    (versionedEnabled != undefined || versionedTag != undefined) &&
    legacyEnabled == undefined &&
    legacyTag == undefined
  ) {
    return;
  }

  const enabled =
    versionedEnabled != undefined
      ? versionedEnabled == "true"
      : legacyEnabled != undefined
      ? legacyEnabled == "true"
      : (legacyTag ?? versionedTag) != undefined &&
        (legacyTag ?? versionedTag) != SHARED_WINE_TAG;
  const tag = enabled
    ? legacyTag ?? versionedTag ?? AUTO_WINE_TAG
    : SHARED_WINE_TAG;

  try {
    if (versionedEnabled == undefined) {
      await setKey(gameWineEnabledKey(gameId), enabled ? "true" : "false");
    }
    if (versionedTag == undefined) {
      await setKey(
        gameWineKey(gameId),
        tag == SHARED_WINE_TAG || tag == AUTO_WINE_TAG ? null : tag
      );
    }
    // Once the legacy tag has been copied, remove it so downgrading to a
    // launcher that predates local Wine support cannot encounter this value.
    await setKey(legacyGameWineKey(gameId), null);
    await setKey(legacyGameWineEnabledKey(gameId), null);
  } catch (error) {
    await log(
      `[multi-game] Failed to migrate Wine state for ${gameId}: ${String(
        error
      )}`
    );
  }
}

/** Whether the game runs in its own Wine environment instead of the global one. */
export async function getMultiGameGameWineEnabled(gameId: string) {
  await migrateMultiGameGameWineState(gameId);
  try {
    return (await getKey(gameWineEnabledKey(gameId))) == "true";
  } catch {
    return false;
  }
}

export async function setMultiGameGameWineEnabled(
  gameId: string,
  enabled: boolean
) {
  await setKey(gameWineEnabledKey(gameId), enabled ? "true" : null);
  await setKey(legacyGameWineEnabledKey(gameId), null);
  if (!enabled) await setKey(legacyGameWineKey(gameId), null);
}
export async function getMultiGameGameWineTag(gameId: string) {
  if (!(await getMultiGameGameWineEnabled(gameId))) return SHARED_WINE_TAG;
  try {
    return (await getKey(gameWineKey(gameId))) ?? AUTO_WINE_TAG;
  } catch {
    return AUTO_WINE_TAG;
  }
}

export function setMultiGameGameWineTag(gameId: string, wineTag: string) {
  return Promise.all([
    setKey(
      gameWineKey(gameId),
      wineTag === SHARED_WINE_TAG || wineTag === AUTO_WINE_TAG ? null : wineTag
    ),
    setKey(legacyGameWineKey(gameId), null),
  ]);
}

export async function getMultiGameWineOptions(_currentTag: string) {
  const versions = await getWineDistributions();
  const installedVersions = (
    await Promise.all(
      versions.map(async distro =>
        (await isWineDistroInstalled(distro.id)) ? distro : null
      )
    )
  ).filter((distro): distro is WineDistribution => distro !== null);
  return [
    { tag: SHARED_WINE_TAG, displayName: "Shared launcher Wine", url: "" },
    ...installedVersions.map(distro => ({
      tag: distro.id,
      displayName: distro.displayName,
      url: distro.remoteUrl,
    })),
  ];
}

async function getCorrectWineBinaryFromRoot(wineRoot: string) {
  try {
    await stats(join(wineRoot, "bin", "wine64"));
    return join(wineRoot, "bin", "wine64");
  } catch {
    return join(wineRoot, "bin", "wine");
  }
}

export async function createMultiGameWineFromRoot({
  prefix,
  distro,
  wineRoot,
}: {
  prefix: string;
  distro: WineDistribution;
  wineRoot: string;
}): Promise<Wine> {
  const loaderBin = await getCorrectWineBinaryFromRoot(wineRoot);
  // Wine creates the prefix with a single mkdir; make sure the parent chain
  // (e.g. ./wineprefixes/napcn) exists before the first Wine command runs.
  await mkdirp(prefix);
  const env = () => ({
    WINEDEBUG: "fixme-all,err-unwind,+timestamp",
    WINEPREFIX: prefix,
  });
  const toWinePath = (path: string) => "Z:" + path.replaceAll("/", "\\");
  const wineExec = (
    program: string,
    args: string[],
    extra?: Record<string, string>,
    logFile?: string
  ) =>
    exec(
      program === "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      { ...env(), ...(extra ?? {}) },
      false,
      logFile
    );
  const wineExec2 = (
    program: string,
    args: string[],
    extra?: Record<string, string>,
    logFile?: string,
    options?: { timeoutMs?: number }
  ) =>
    exec2(
      program === "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      { ...env(), ...(extra ?? {}) },
      false,
      logFile,
      options
    );
  const waitUntilServerOff = (_timeoutMs = 0) =>
    exec2([join(dirname(loaderBin), "wineserver"), "-w"], env());
  const waitForWineServerExit = async ({
    timeoutMs = 5_000,
  }: { timeoutMs?: number } = {}) => {
    const wineserverBin = join(dirname(loaderBin), "wineserver");
    const waitPromise = exec2([wineserverBin, "-w"], env());
    if (timeoutMs <= 0) {
      await waitPromise;
      return true;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        waitPromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(`wineserver cleanup timed out after ${timeoutMs}ms`)
              ),
            timeoutMs
          );
        }),
      ]);
      return true;
    } catch (error) {
      if (isWineserverUnavailableError(error)) {
        await log(
          `Wine server binary is unavailable; treating the server as stopped: ${String(
            error
          )}`
        );
        waitPromise.catch(() => undefined);
        return true;
      }
      await log(
        `Wine server cleanup did not finish within the grace period: ${String(
          error
        )}`
      );
      waitPromise.catch(() => undefined);
      return false;
    } finally {
      if (timeout != undefined) clearTimeout(timeout);
    }
  };
  const useInWineEnumeration = distro.attributes.renderBackend == "dxmt";
  const listWineProcesses = async (): Promise<WineProcess[]> => {
    if (!useInWineEnumeration) {
      const result = await exec2(
        ["ps", "-axo", "pid=,command="],
        undefined,
        false,
        undefined,
        { timeoutMs: 3_000 }
      );
      return parseMacWineProcesses(result.stdOut, loaderBin);
    }
    try {
      const result = await exec2(
        [loaderBin, "tasklist", "/fo", "csv", "/nh"],
        env(),
        false,
        undefined,
        { timeoutMs: 10_000 }
      );
      const processes = parseTasklistCsv(result.stdOut);
      if (processes.length > 0) return processes;
      throw new Error("tasklist returned no parseable process rows");
    } catch (tasklistError) {
      await log(
        `tasklist process enumeration failed: ${String(tasklistError)}`
      );
      const result = await exec2(
        [loaderBin, "winedbg", "--command", "info proc"],
        env(),
        false,
        undefined,
        { timeoutMs: 10_000 }
      );
      const processes = parseWinedbgProcesses(result.stdOut);
      if (processes.length > 0) return processes;
      throw new Error("winedbg returned no parseable process rows");
    }
  };
  const killAll = async () => {
    try {
      await exec(
        [join(dirname(loaderBin), "wineserver"), "-k", "-9"],
        env(),
        false,
        "/dev/null"
      );
    } catch {
      /* best-effort cleanup */
    }
  };
  const createGameProcessMonitorFor = (executable: string) =>
    createGameProcessMonitor({
      executable,
      listProcesses: listWineProcesses,
      getWindowState: createNativeGameWindowState(executable),
      onWindowClosed: killAll,
    });
  let netbiosname: string;
  try {
    netbiosname = await getKey("wine_netbiosname");
  } catch {
    netbiosname = `DESKTOP-${generateRandomString(7)}`;
    await setKey("wine_netbiosname", netbiosname);
  }
  const runConfig = async (body: string) => {
    await writeFile(resolve("winedrv_config.bat"), body);
    await wineExec(
      "cmd",
      ["/c", toWinePath(resolve("./winedrv_config.bat"))],
      {},
      "/dev/null"
    );
    await waitUntilServerOff();
  };
  return {
    exec: wineExec,
    exec2: wineExec2,
    waitUntilServerOff,
    waitForWineServerExit,
    createGameProcessMonitor: createGameProcessMonitorFor,
    killAll,
    cmd: (command, args) => wineExec("cmd", [command, ...args]),
    toWinePath,
    prefix,
    wineRoot,
    openCmdWindow: ({ gameDir }) =>
      exec2(
        [
          "osascript",
          "-e",
          [
            "tell",
            "app",
            '"Terminal"',
            "to",
            "do",
            "script",
            `"${build([loaderBin, "cmd"], {
              ...env(),
              WINEPATH: toWinePath(gameDir),
            })
              .replaceAll("\\", "\\\\")
              .replaceAll('"', '\\"')}"`,
          ].join(" "),
          "-e",
          ["tell", "app", '"Terminal"', "to", "activate"].join(" "),
        ],
        {},
        false,
        "/dev/null"
      ),
    setProps: props =>
      runConfig(
        `@echo off\ncd "%~dp0"\nreg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v RetinaMode /t REG_SZ /d ${
          props.retina ? "y" : "n"
        } /f\nreg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v LeftCommandIsCtrl /t REG_SZ /d ${
          props.leftCmd ? "y" : "n"
        } /f\nexit /b 0\n`
      ),
    setNVExtension: () =>
      runConfig(
        `@echo off\ncd "%~dp0"\nreg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f\nreg add "HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Services\\nvlddmkm" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f\nreg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global\\NGXCore" /v FullPath /t REG_SZ /d "C:\\Windows\\System32" /f\nexit /b 0\n`
      ),
    clearNVExtension: () =>
      runConfig(
        `@echo off\ncd "%~dp0"\nreg delete "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /f >nul 2>nul\nreg delete "HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Services\\nvlddmkm" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /f >nul 2>nul\nreg delete "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global\\NGXCore" /v FullPath /f >nul 2>nul\nexit /b 0\n`
      ),
    setDistribution: async () => undefined,
    attributes: { ...distro.attributes },
  };
}

export async function* ensureMultiGameGameWine({
  aria2,
  baseWine,
  gameId,
  prefixId = gameId,
  wineTag,
  downloadKey,
}: {
  aria2: Aria2;
  baseWine: Wine;
  gameId: string;
  /** Channel client code name; selects the per-game Wine prefix path. */
  prefixId?: string;
  wineTag: string;
  downloadKey?: string;
}): TaskProgram<Wine> {
  if (wineTag === SHARED_WINE_TAG) return baseWine;
  if (wineTag === AUTO_WINE_TAG) {
    // "Auto" keeps the global Wine build but gives the game its own prefix.
    return await createMultiGameWineFromRoot({
      prefix: getMultiGamePrefix(baseWine.prefix, prefixId),
      distro: {
        id: AUTO_WINE_TAG,
        displayName: "Auto",
        remoteUrl: "",
        attributes: { ...baseWine.attributes },
      },
      wineRoot: baseWine.wineRoot,
    });
  }
  const distro = (await getWineDistributions()).find(
    candidate => candidate.id === wineTag
  );
  if (!distro) {
    await setMultiGameGameWineTag(gameId, SHARED_WINE_TAG);
    await log(
      `[multi-game] Unknown Wine distribution for ${gameId}: ${wineTag}; falling back to shared Wine`
    );
    return baseWine;
  }
  const prefix = getMultiGamePrefix(baseWine.prefix, prefixId);
  if (distro.systemWineRoot) {
    return await createMultiGameWineFromRoot({
      prefix,
      distro,
      wineRoot: getWineDistroRoot(distro.id),
    });
  }
  if (!(await isWineDistroInstalled(distro.id))) {
    // Wine binaries are shared across all games. If a persisted selection is
    // missing, install it once in ./wines instead of creating a game-local
    // copy under yaaglm-wines.
    yield* installWineEnvironmentProgram({
      aria2,
      wineAbsPrefix: prefix,
      wineDistro: distro,
      activate: false,
      finishMessage: false,
      downloadKey,
    });
  }
  return await createMultiGameWineFromRoot({
    prefix,
    distro,
    wineRoot: getWineDistroRoot(distro.id),
  });
}

/**
 * Prepare the shared prefix for a per-game Wine selection. The previous
 * distribution's Wine server is stopped first, then the newly selected Wine
 * updates the prefix (wineboot) right away, so the next game launch does not
 * have to do it while the startup detection timer is running.
 */
export async function* prepareMultiGameGameWine({
  aria2,
  baseWine,
  previousWine,
  gameId,
  prefixId = gameId,
  wineTag,
  migrate = false,
  descriptor,
  logFile = "/dev/null",
  downloadKey,
}: {
  aria2: Aria2;
  baseWine: Wine;
  previousWine?: Wine;
  gameId: string;
  /** Channel client code name; selects the per-game Wine prefix path. */
  prefixId?: string;
  wineTag: string;
  /** Carry the game's data over to the newly selected environment. */
  migrate?: boolean;
  /** Game data locations; without one a whole-prefix copy is used. */
  descriptor?: WineUserDataDescriptor;
  logFile?: string;
  /** Download-control namespace used if the selected shared Wine is missing. */
  downloadKey?: string;
}): TaskProgram<Wine> {
  const staleWine = previousWine ?? baseWine;
  await staleWine.killAll();
  await staleWine.waitForWineServerExit({ timeoutMs: 5_000 });

  let wine: Wine;
  if (wineTag === SHARED_WINE_TAG) {
    wine = baseWine;
    // Switching back to the global environment: push the game's data back so
    // the global prefix keeps the settings made with the per-game environment.
    if (migrate && descriptor && staleWine.prefix != baseWine.prefix) {
      yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
      yield ["setUndeterminedProgress"];
      await migrateWineUserData({
        sourceWine: staleWine,
        targetWine: baseWine,
        descriptor,
      });
    }
  } else {
    wine = yield* ensureMultiGameGameWine({
      aria2,
      baseWine,
      gameId,
      prefixId,
      wineTag,
      downloadKey,
    });
    yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    const needsMigration = migrate && staleWine.prefix != wine.prefix;
    if (needsMigration && descriptor) {
      // Prepare the target prefix first, then move this game's registry keys
      // and data directories into it.
      await warmUpWinePrefix(wine);
      await migrateWineUserData({
        sourceWine: staleWine,
        targetWine: wine,
        descriptor,
      });
    } else if (needsMigration) {
      // Games without a data descriptor keep the previous whole-prefix copy.
      await copyMultiGamePrefix({
        sourcePrefix: staleWine.prefix,
        targetPrefix: wine.prefix,
      });
    }
  }

  yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
  yield ["setUndeterminedProgress"];
  await warmUpWinePrefix(wine);
  await wine.exec2("winecfg", ["-v", "win10"], {}, logFile, {
    timeoutMs: 120_000,
  });
  yield ["setStateText", "INSTALL_DONE"];
  return wine;
}

/** Initialize a brand-new prefix or update an existing one. */
async function warmUpWinePrefix(wine: Wine) {
  const initialized = await fileOrDirExists(
    join(wine.prefix, "drive_c", "windows")
  );
  await wine.exec2("wineboot", initialized ? ["-u"] : [], {}, undefined, {
    timeoutMs: 300_000,
  });
}
