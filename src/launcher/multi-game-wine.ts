import type { CommonUpdateProgram } from "../common-update-ui";
import {
  build,
  downloadPercent,
  exec,
  exec2,
  formatDownloadSpeed,
  generateRandomString,
  getKey,
  humanFileSize,
  mkdirp,
  removeFileIfExists,
  resolve,
  rmrf_dangerously,
  setKey,
  stats,
  tar_extract,
  tar_extract_directory,
  writeFile,
  xattrRemove,
} from "@utils";
import type { Aria2 } from "@aria2";
import { isDownloadCancelledError } from "../download-control";
import {
  getWineDistributions,
  isWineDistroInstalled,
  type Wine,
  type WineDistribution,
} from "@wine";
import { addCertsToWine } from "../wine/cert";
import { dirname, join } from "path-browserify";

export const SHARED_WINE_TAG = "__shared__";
// Resolved through Neutralino's app path. In packaged builds this is
// ~/Library/Application Support/<AppName>/yaagl-wines/<gameId>/<distroId>.
const MULTI_GAME_WINES_DIR = "./yaagl-wines";

export type MultiGameWineRef = {
  current: Awaited<Wine>;
};

// Proxy that always points at the currently active Wine for a game. It starts
// as the shared launcher Wine and is swapped to a per-game Wine right before a
// namespaced program runs (install/update/launch/init/check-integrity).
export function createMultiGameWineProxy(ref: MultiGameWineRef): Awaited<Wine> {
  return {
    exec: (...args) => ref.current.exec(...args),
    exec2: (...args) => ref.current.exec2(...args),
    waitUntilServerOff: (...args) => ref.current.waitUntilServerOff(...args),
    cmd: (...args) => ref.current.cmd(...args),
    toWinePath: path => ref.current.toWinePath(path),
    prefix: ref.current.prefix,
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
  return `yaagl_${gameId}_wine_tag`;
}

function gameWineRoot(gameId: string, distro: WineDistribution) {
  return resolve(join(MULTI_GAME_WINES_DIR, gameId, distro.id, "wine"));
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
      versions.map(async x => ((await isWineDistroInstalled(x.id)) ? x : null))
    )
  ).filter((x): x is WineDistribution => x !== null);
  return [
    {
      tag: SHARED_WINE_TAG,
      displayName: "Shared launcher Wine",
      url: "",
    },
    ...installedVersions.map(x => ({
      tag: x.id,
      displayName: x.displayName,
      url: x.remoteUrl,
    })),
    ...(currentTag !== SHARED_WINE_TAG &&
    !versions.some(x => x.id === currentTag)
      ? [
          {
            tag: currentTag,
            displayName: currentTag,
            url: "",
          },
        ]
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
}): Promise<Awaited<Wine>> {
  const loaderBin = await getCorrectWineBinaryFromRoot(wineRoot);

  function getEnvironmentVariables() {
    return {
      WINEDEBUG: "fixme-all,err-unwind,+timestamp",
      WINEPREFIX: prefix,
    };
  }

  async function wineExec(
    program: string,
    args: string[],
    env?: { [key: string]: string },
    log_file: string | undefined = undefined
  ) {
    return await exec(
      program == "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      {
        ...getEnvironmentVariables(),
        ...(env ?? {}),
      },
      false,
      log_file
    );
  }

  async function wineExec2(
    program: string,
    args: string[],
    env?: { [key: string]: string },
    log_file: string | undefined = undefined
  ) {
    return await exec2(
      program == "copy"
        ? [loaderBin, "cmd", "/c", program, ...args]
        : [loaderBin, program, ...args],
      {
        ...getEnvironmentVariables(),
        ...(env ?? {}),
      },
      false,
      log_file
    );
  }

  async function waitUntilServerOff() {
    return await exec2([join(dirname(loaderBin), "wineserver"), "-w"], {
      ...getEnvironmentVariables(),
    });
  }

  async function killAll() {
    const wineserver = join(dirname(loaderBin), "wineserver");
    try {
      await exec(
        [wineserver, "-k", "-9"],
        { ...getEnvironmentVariables() },
        false,
        "/dev/null"
      );
    } catch {
      // ignore — best-effort cleanup; wineserver may be gone already
    }
  }

  function toWinePath(absPath: string) {
    return "Z:" + `${absPath}`.replaceAll("/", "\\");
  }

  async function openCmdWindow({ gameDir }: { gameDir: string }) {
    return await exec2(
      [
        `osascript`,
        "-e",
        [
          "tell",
          "app",
          '"Terminal"',
          "to",
          "do",
          "script",
          `"${build([loaderBin, "cmd"], {
            ...getEnvironmentVariables(),
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
    );
  }

  let netbiosname: string;
  try {
    netbiosname = await getKey("wine_netbiosname");
  } catch {
    netbiosname = `DESKTOP-${generateRandomString(7)}`;
    await setKey("wine_netbiosname", netbiosname);
  }

  async function setProps(props: { retina: boolean; leftCmd: boolean }) {
    const cmd = `@echo off
cd "%~dp0"
reg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v RetinaMode /t REG_SZ /d ${
      props.retina ? "y" : "n"
    } /f
reg add "HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver" /v LeftCommandIsCtrl /t REG_SZ /d ${
      props.leftCmd ? "y" : "n"
    } /f
`;
    await writeFile(resolve("winedrv_config.bat"), cmd);
    await wineExec(
      "cmd",
      ["/c", `${toWinePath(resolve("./winedrv_config.bat"))}`],
      {},
      "/dev/null"
    );
    await waitUntilServerOff();
  }

  async function setNVExtension() {
    const cmd = `@echo off
cd "%~dp0"
reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f
reg add "HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Services\\nvlddmkm" /v "{41FCC608-8496-4DEF-B43E-7D9BD675A6FF}" /t REG_BINARY /d 1 /f
reg add "HKEY_LOCAL_MACHINE\\SOFTWARE\\NVIDIA Corporation\\Global\\NGXCore" /v FullPath /t REG_SZ /d "C:\\Windows\\System32" /f
`;
    await writeFile(resolve("winedrv_config.bat"), cmd);
    await wineExec(
      "cmd",
      ["/c", `${toWinePath(resolve("./winedrv_config.bat"))}`],
      {},
      "/dev/null"
    );
    await waitUntilServerOff();
  }

  return {
    exec: wineExec,
    exec2: wineExec2,
    waitUntilServerOff,
    killAll,
    cmd: (command: string, args: string[]) =>
      wineExec("cmd", [command, ...args]),
    toWinePath,
    prefix,
    openCmdWindow,
    setProps,
    setNVExtension,
    // Per-game wines are immutable once selected; distribution changes go
    // through the shared launcher Wine instead.
    setDistribution: async () => undefined,
    attributes: {
      ...distro.attributes,
    },
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
  baseWine: Awaited<Wine>;
  gameId: string;
  wineTag: string;
  /** Download-control key used while fetching this game's Wine bundle. */
  downloadKey?: string;
}): CommonUpdateProgram<Awaited<Wine>> {
  if (wineTag === SHARED_WINE_TAG) return baseWine;

  const distro = (await getWineDistributions()).find(x => x.id === wineTag);
  if (!distro) throw new Error(`Unknown Wine distribution: ${wineTag}`);

  const wineRoot = gameWineRoot(gameId, distro);
  try {
    await stats(join(wineRoot, "bin", "wine"));
    return await createMultiGameWineFromRoot({
      prefix: baseWine.prefix,
      distro,
      wineRoot,
    });
  } catch {
    // Download below.
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
      // Restore the original per-game Wine state: drop the partial download
      // and the (possibly empty) Wine root so a retry starts clean.
      await removeFileIfExists(wineTarPath);
      await rmrf_dangerously(wineRoot);
    }
    throw error;
  }

  yield ["setStateText", "EXTRACT_ENVIRONMENT"];
  yield ["setUndeterminedProgress"];
  await rmrf_dangerously(wineRoot);
  await mkdirp(wineRoot);
  if (distro.attributes.winePath) {
    await tar_extract_directory(
      wineTarPath,
      wineRoot,
      distro.attributes.winePath,
      isXZ
    );
  } else {
    await tar_extract(wineTarPath, wineRoot);
  }
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
