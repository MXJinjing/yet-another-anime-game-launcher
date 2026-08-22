import type { Aria2 } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import {
  exec,
  exec2,
  formatDownloadSpeed,
  generateRandomString,
  humanFileSize,
  mkdirp,
  rmrf_dangerously,
  tar_extract,
  tar_extract_directory,
  xattrRemove,
} from "@runtime";
import { build } from "@platform/shell";
import { getKey, setKey } from "@runtime/storage";
import { removeFileIfExists, stats, writeFile } from "@platform/neutralino";
import { resolve } from "@platform/neutralino/path";
import { downloadPercent } from "@runtime/format";
import { dirname, join } from "path-browserify";
import { log } from "../logging/logger";
import { isDownloadCancelledError } from "../download/control";
import { addCertsToWine } from "./cert";
import { getWineDistributions } from "./distro";
import type { WineDistribution } from "./distro";
import { isWineDistroInstalled, type Wine } from "./wine";
import {
  createGameProcessMonitor,
  parseTasklistCsv,
  parseWinedbgProcesses,
  type WineProcess,
} from "./game-process-monitor";
import { createNativeGameWindowState } from "./native-window-state";

export const SHARED_WINE_TAG = "__shared__";
const MULTI_GAME_WINES_DIR = "./yaaglm-wines";

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
    openCmdWindow: (...args) => ref.current.openCmdWindow(...args),
    setProps: (...args) => ref.current.setProps(...args),
    setNVExtension: () => ref.current.setNVExtension(),
    setDistribution: (...args) => ref.current.setDistribution(...args),
    killAll: (...args) => ref.current.killAll(...args),
    get attributes() {
      return ref.current.attributes;
    },
  };
}

function gameWineKey(gameId: string) {
  return `yaaglm_${gameId}_wine_tag`;
}
export function getMultiGameWineRoot(gameId: string, distro: WineDistribution) {
  return resolve(join(MULTI_GAME_WINES_DIR, gameId, distro.id, "wine"));
}

export async function cleanupCancelledMultiGameWineDownload({
  wineTarPath,
  wineRoot,
  removeFile = removeFileIfExists,
  removeDirectory = rmrf_dangerously,
}: {
  wineTarPath: string;
  wineRoot: string;
  removeFile?: (path: string) => Promise<unknown>;
  removeDirectory?: (path: string) => Promise<unknown>;
}) {
  await removeFile(wineTarPath);
  await removeDirectory(wineRoot);
}

export async function getMultiGameGameWineTag(gameId: string) {
  try {
    return await getKey(gameWineKey(gameId));
  } catch {
    return SHARED_WINE_TAG;
  }
}

export function setMultiGameGameWineTag(gameId: string, wineTag: string) {
  return setKey(
    gameWineKey(gameId),
    wineTag === SHARED_WINE_TAG ? null : wineTag
  );
}

export async function getMultiGameWineOptions(currentTag: string) {
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
    ...(currentTag !== SHARED_WINE_TAG &&
    !versions.some(distro => distro.id === currentTag)
      ? [{ tag: currentTag, displayName: currentTag, url: "" }]
      : []),
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
    logFile?: string
  ) =>
    exec2(
      program === "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      { ...env(), ...(extra ?? {}) },
      false,
      logFile
    );
  const waitUntilServerOff = (_timeoutMs = 0) =>
    exec2([join(dirname(loaderBin), "wineserver"), "-w"], env());
  const waitForWineServerExit = async ({
    timeoutMs = 5_000,
  }: { timeoutMs?: number } = {}) => {
    const waitPromise = exec2(
      [join(dirname(loaderBin), "wineserver"), "-w"],
      env()
    );
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
  const listWineProcesses = async (): Promise<WineProcess[]> => {
    try {
      const result = await wineExec("tasklist", ["/fo", "csv", "/nh"]);
      const processes = parseTasklistCsv(result.stdOut);
      if (processes.length > 0) return processes;
      throw new Error("tasklist returned no parseable process rows");
    } catch (tasklistError) {
      // Wine builds differ in whether tasklist is available; winedbg is the
      // supported fallback and is still scoped by this Wine prefix.
      const result = await wineExec("winedbg", ["--command", "info proc"]);
      const processes = parseWinedbgProcesses(result.stdOut);
      if (processes.length > 0) return processes;
      throw new Error(
        `Wine process enumeration failed: ${String(tasklistError)}`
      );
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
        } /f\n`
      ),
    setNVExtension: () =>
      runConfig(
        `@echo off\ncd "%~dp0"\nreg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f\nreg add "HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Services\\nvlddmkm" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f\nreg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global\\NGXCore" /v FullPath /t REG_SZ /d "C:\\Windows\\System32" /f\n`
      ),
    setDistribution: async () => undefined,
    attributes: { ...distro.attributes },
  };
}

export async function* ensureMultiGameGameWine({
  aria2,
  baseWine,
  gameId,
  wineTag,
  downloadKey,
}: {
  aria2: Aria2;
  baseWine: Wine;
  gameId: string;
  wineTag: string;
  downloadKey?: string;
}): TaskProgram<Wine> {
  if (wineTag === SHARED_WINE_TAG) return baseWine;
  const distro = (await getWineDistributions()).find(
    candidate => candidate.id === wineTag
  );
  if (!distro) throw new Error(`Unknown Wine distribution: ${wineTag}`);
  const wineRoot = getMultiGameWineRoot(gameId, distro);
  try {
    await stats(join(wineRoot, "bin", "wine"));
    return await createMultiGameWineFromRoot({
      prefix: baseWine.prefix,
      distro,
      wineRoot,
    });
  } catch {
    /* download below */
  }
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  await mkdirp(wineRoot);
  const isXZ = distro.remoteUrl.endsWith(".xz");
  const wineTarPath = resolve(
    join(
      MULTI_GAME_WINES_DIR,
      gameId,
      distro.id,
      `wine.tar.${isXZ ? "xz" : "gz"}`
    )
  );
  try {
    for await (const progress of aria2.doStreamingDownload({
      uri: distro.remoteUrl,
      absDst: wineTarPath,
      downloadKey,
    })) {
      yield [
        "setProgress",
        Number((progress.completedLength * BigInt(100)) / progress.totalLength),
      ];
      yield [
        "setStateText",
        "DOWNLOADING_ENVIRONMENT_SPEED",
        formatDownloadSpeed(Number(progress.downloadSpeed)),
        `${humanFileSize(Number(progress.completedLength))}`,
        `${humanFileSize(Number(progress.totalLength))}`,
        downloadPercent(progress.completedLength, progress.totalLength),
      ];
    }
  } catch (error) {
    if (isDownloadCancelledError(error)) {
      await cleanupCancelledMultiGameWineDownload({ wineTarPath, wineRoot });
    }
    throw error;
  }
  yield ["setStateText", "EXTRACT_ENVIRONMENT"];
  yield ["setUndeterminedProgress"];
  await rmrf_dangerously(wineRoot);
  await mkdirp(wineRoot);
  if (distro.attributes.winePath)
    await tar_extract_directory(
      wineTarPath,
      wineRoot,
      distro.attributes.winePath,
      isXZ
    );
  else await tar_extract(wineTarPath, wineRoot);
  await rmrf_dangerously(wineTarPath);
  yield ["setStateText", "CONFIGURING_ENVIRONMENT"];
  await addCertsToWine(wineRoot);
  await xattrRemove("com.apple.quarantine", wineRoot);
  return await createMultiGameWineFromRoot({
    prefix: baseWine.prefix,
    distro,
    wineRoot,
  });
}
