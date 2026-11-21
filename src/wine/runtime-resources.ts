import { Aria2, Aria2OverallProgress } from "@aria2";
import type { TaskProgram, TaskProgressCommand } from "@tasks/task-program";
import {
  exec,
  forceMove,
  formatDownloadSpeed,
  humanFileSize,
  mkdirp,
  rmrf_dangerously,
} from "@runtime";
import { getKeyOrDefault, setKey } from "@runtime/storage";
import { downloadPercent } from "@runtime/format";
import { warn } from "@logging/logger";
import {
  DownloadFailedError,
  isDownloadCancelledError,
  isDownloadFailedError,
} from "../download/control";
import {
  fileOrDirExists,
  removeFileIfExists,
  stats,
  writeFile,
} from "@platform/neutralino";
import { resolve } from "@platform/neutralino/path";
import type { Wine } from "./wine";
import { join } from "path-browserify";

const CURRENT_MVK_VERSION = "1.2.2";
const CURRENT_DXVK_VERSION = "1.10.4-alpha.20230402";
const CURRENT_JADEITE_VERSION = "4.1.0";
const CURRENT_DXMT_VERSION = "654f547";
const DXMT_BUILD = "654f547ffab4e0c395ee368aad52bb4586b04576";
const DXMT_CHECKSUM =
  "sha-256=fbc0721fb72ebafd2bad0dbdd3d13a52056fd10c4a9a699cee2689363823255b";
const CURRENT_RESHADE_VERSION = "5.8.0";

// Different games share runtime directories and can start in parallel.
const pendingArchiveInstalls = new Map<string, Promise<void>>();

async function* installRuntimeArchive(
  archive: string,
  program: TaskProgram
): TaskProgram {
  const previous = pendingArchiveInstalls.get(archive);
  let release!: () => void;
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  pendingArchiveInstalls.set(archive, pending);
  try {
    await previous;
    yield* program;
  } finally {
    release();
    if (pendingArchiveInstalls.get(archive) === pending) {
      pendingArchiveInstalls.delete(archive);
    }
  }
}

async function removeRuntimeInstaller(path: string) {
  try {
    await removeFileIfExists(path);
  } catch (error) {
    await warn(
      `Could not remove runtime installer ${path}: ${String(error)}`
    ).catch(() => undefined);
  }
}

export const DXVK_FILES = [
  "d3d9.dll",
  "d3d10core.dll",
  "d3d11.dll",
  "dxgi.dll",
];
export const DXMT_FILES = ["d3d10core.dll", "d3d11.dll", "dxgi.dll"];

const DXMT_WINDOWS_FILES = [
  ...DXMT_FILES,
  "nvapi64.dll",
  "nvngx.dll",
  "winemetal.dll",
];
const DXMT_RUNTIME_FILES = [...DXMT_WINDOWS_FILES, "winemetal.so"];

async function hasRuntimeFile(path: string): Promise<boolean> {
  try {
    const info = await stats(path);
    return info.isFile && info.size > 0;
  } catch {
    return false;
  }
}

async function hasRuntimeFiles(directory: string, files: string[]) {
  const present = await Promise.all(
    files.map(file => hasRuntimeFile(join(directory, file)))
  );
  return present.every(Boolean);
}

export async function isDXMTInstalled(): Promise<boolean> {
  return (
    CURRENT_DXMT_VERSION ===
      (await getKeyOrDefault("installed_dxmt_version", "")) &&
    (await hasRuntimeFiles("./dxmt", DXMT_RUNTIME_FILES))
  );
}

function downloadProgress(progress: {
  completedLength: bigint;
  totalLength: bigint;
  downloadSpeed: bigint;
}): TaskProgressCommand {
  return [
    "setStateText",
    "DOWNLOADING_ENVIRONMENT_SPEED",
    formatDownloadSpeed(Number(progress.downloadSpeed)),
    `${humanFileSize(Number(progress.completedLength))}`,
    `${humanFileSize(Number(progress.totalLength))}`,
    downloadPercent(progress.completedLength, progress.totalLength),
  ];
}

export async function* checkAndDownloadMoltenVK(aria2: Aria2): TaskProgram {
  if (
    CURRENT_MVK_VERSION ===
      (await getKeyOrDefault("installed_moltenvk_version", "")) &&
    (await hasRuntimeFile("./moltenvk/libMoltenVK.dylib"))
  )
    return;
  await mkdirp("./moltenvk");
  const target = resolve("./moltenvk/libMoltenVK.dylib");
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  try {
    for await (const progress of aria2.doStreamingDownload({
      uri: "https://github.com/3Shain/winecx/releases/download/gi-wine-1.0/libMoltenVK.dylib",
      absDst: target,
    })) {
      yield [
        "setProgress",
        Number((progress.completedLength * BigInt(100)) / progress.totalLength),
      ];
      yield downloadProgress(progress);
    }
  } catch (error) {
    if (isDownloadCancelledError(error)) throw error;
    // A partial dylib would otherwise be treated as installed next time.
    await removeRuntimeInstaller(target);
    throw new DownloadFailedError(`MoltenVK download failed: ${String(error)}`);
  }
  await setKey("installed_moltenvk_version", CURRENT_MVK_VERSION);
}

export async function* checkAndDownloadDXVK(aria2: Aria2): TaskProgram {
  if (
    CURRENT_DXVK_VERSION ===
      (await getKeyOrDefault("installed_dxvk_version", "")) &&
    (await hasRuntimeFiles("./dxvk", DXVK_FILES))
  )
    return;
  await mkdirp("./dxvk");
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  const overall = new Aria2OverallProgress();
  for (const [fileNumber, file] of DXVK_FILES.entries()) {
    const target = resolve(`./dxvk/${file}`);
    try {
      for await (const progress of aria2.doStreamingDownload({
        uri: `https://github.com/3Shain/winecx/releases/download/gi-wine-1.0/${file}`,
        absDst: target,
      })) {
        const current = overall.current(progress);
        yield ["setProgress", overall.step(progress)];
        yield [
          "setStateText",
          "DOWNLOADING_ENVIRONMENT_SPEED",
          formatDownloadSpeed(Number(progress.downloadSpeed)),
          `${humanFileSize(Number(current.completed))}`,
          `${humanFileSize(Number(current.total))}`,
          downloadPercent(current.completed, current.total),
          String(fileNumber + 1),
          String(DXVK_FILES.length),
        ];
      }
    } catch (error) {
      if (isDownloadCancelledError(error)) throw error;
      // Drop the partial library; the version marker stays unset so the next
      // launch downloads the whole set again.
      await removeRuntimeInstaller(target);
      throw new DownloadFailedError(
        `DXVK download failed for ${file}: ${String(error)}`
      );
    }
    overall.finishFile();
  }
  await setKey("installed_dxvk_version", CURRENT_DXVK_VERSION);
}

export function checkAndDownloadJadeite(aria2: Aria2): TaskProgram {
  const archive = resolve("./jadeite/archive.zip");
  return installRuntimeArchive(archive, installJadeite(aria2, archive));
}

async function* installJadeite(aria2: Aria2, archive: string): TaskProgram {
  if (
    CURRENT_JADEITE_VERSION ===
      (await getKeyOrDefault("installed_jadeite_version", "")) &&
    (await hasRuntimeFile("./jadeite/jadeite.exe"))
  ) {
    await removeRuntimeInstaller(archive);
    return;
  }
  await rmrf_dangerously(resolve("./jadeite"));
  await mkdirp("./jadeite");
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  for await (const progress of aria2.doStreamingDownload({
    uri: "https://codeberg.org/mkrsym1/jadeite/releases/download/v4.1.0/v4.1.0.zip",
    absDst: archive,
  })) {
    yield [
      "setProgress",
      Number((progress.completedLength * BigInt(100)) / progress.totalLength),
    ];
    yield downloadProgress(progress);
  }
  yield ["setStateText", "EXTRACT_ENVIRONMENT"];
  yield ["setUndeterminedProgress"];
  try {
    await exec(["/usr/bin/unzip", "-oq", archive, "-d", resolve("./jadeite")]);
  } catch (error) {
    if (isDownloadCancelledError(error)) throw error;
    // Remove both the installer and any partially extracted payload so a
    // retry starts from a clean directory.
    await removeRuntimeInstaller(archive);
    await rmrf_dangerously(resolve("./jadeite"));
    throw new DownloadFailedError(
      `Jadeite extraction failed: ${String(error)}`
    );
  }
  await setKey("installed_jadeite_version", CURRENT_JADEITE_VERSION);
  await removeRuntimeInstaller(archive);
}

export function checkAndDownloadDXMT(
  aria2: Aria2,
  downloadKey?: string
): TaskProgram {
  const directory = resolve("./dxmt");
  return installRuntimeArchive(
    directory,
    installDXMTWithRetry(aria2, directory, downloadKey)
  );
}

/**
 * A corrupt or incomplete DXMT payload must not leave a half-swapped runtime.
 * Clean up the staging area, restore the previous runtime when it was moved
 * aside, and try the download once more before reporting a download failure.
 */
async function* installDXMTWithRetry(
  aria2: Aria2,
  directory: string,
  downloadKey?: string
): TaskProgram {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      yield* installDXMT(aria2, directory, downloadKey);
      return;
    } catch (error) {
      if (isDownloadCancelledError(error)) throw error;
      await restoreDXMTRuntime(directory);
      if (attempt > 0) {
        throw isDownloadFailedError(error)
          ? error
          : new DownloadFailedError(
              `DXMT runtime installation failed: ${String(error)}`
            );
      }
    }
  }
}

async function restoreDXMTRuntime(directory: string) {
  const staging = resolve("./dxmt-staging");
  const backup = resolve("./dxmt-backup");
  await rmrf_dangerously(staging);
  if (!(await fileOrDirExists(directory)) && (await fileOrDirExists(backup))) {
    await forceMove(backup, directory);
  } else {
    await rmrf_dangerously(backup);
  }
}

async function* installDXMT(
  aria2: Aria2,
  directory: string,
  downloadKey?: string
): TaskProgram {
  const staging = resolve("./dxmt-staging");
  const backup = resolve("./dxmt-backup");
  const archiveName = `dxmt-${DXMT_BUILD}.zip`;
  const archive = join(staging, archiveName);
  const tarName = `dxmt-${DXMT_BUILD}.tar.gz`;
  const payload = join(staging, "runtime");

  // Recover an interrupted directory swap before deciding whether to download.
  if ((await fileOrDirExists(backup)) && !(await fileOrDirExists(directory))) {
    await forceMove(backup, directory);
  }
  await rmrf_dangerously(staging);
  if (await isDXMTInstalled()) {
    await rmrf_dangerously(backup);
    return;
  }

  try {
    await mkdirp(payload);
    yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
    for await (const progress of aria2.doStreamingDownload({
      uri: `https://github.com/yaagl/anime-game-wine/releases/download/dxmt-${CURRENT_DXMT_VERSION}/${archiveName}`,
      absDst: archive,
      checksum: DXMT_CHECKSUM,
      downloadKey,
    })) {
      yield [
        "setProgress",
        Number((progress.completedLength * BigInt(100)) / progress.totalLength),
      ];
      yield downloadProgress(progress);
    }
    yield ["setStateText", "EXTRACT_ENVIRONMENT"];
    yield ["setUndeterminedProgress"];
    const { stdOut } = await exec(["/usr/bin/shasum", "-a", "256", archive]);
    if (`sha-256=${stdOut.trim().split(/\s+/)[0]}` !== DXMT_CHECKSUM) {
      throw new Error("DXMT archive checksum mismatch");
    }
    await exec(["/usr/bin/unzip", "-oq", archive, tarName, "-d", staging]);
    await exec(["/usr/bin/tar", "-xf", join(staging, tarName), "-C", staging]);
    for (const file of DXMT_RUNTIME_FILES) {
      const architecture =
        file === "winemetal.so" ? "x86_64-unix" : "x86_64-windows";
      await forceMove(
        join(staging, DXMT_BUILD, architecture, file),
        join(payload, file)
      );
    }
    if (!(await hasRuntimeFiles(payload, DXMT_RUNTIME_FILES))) {
      throw new Error("DXMT archive is missing required runtime files");
    }

    await rmrf_dangerously(backup);
    if (await fileOrDirExists(directory)) await forceMove(directory, backup);
    try {
      await forceMove(payload, directory);
    } catch (error) {
      if (await fileOrDirExists(backup)) await forceMove(backup, directory);
      throw error;
    }
    await setKey("installed_dxmt_version", CURRENT_DXMT_VERSION);
    await rmrf_dangerously(backup);
  } finally {
    await rmrf_dangerously(staging);
  }
}

export function checkAndDownloadReshade(
  aria2: Aria2,
  wine: Wine,
  gameDir: string
): TaskProgram {
  const reshaderDir = resolve("./reshade");
  const installer = join(reshaderDir, "install.exe");
  return installRuntimeArchive(
    installer,
    installReshade(aria2, wine, gameDir, reshaderDir, installer)
  );
}

async function* installReshade(
  aria2: Aria2,
  wine: Wine,
  gameDir: string,
  reshaderDir: string,
  installer: string
): TaskProgram {
  const legacyArchive = join(reshaderDir, "install.zip");
  if (
    CURRENT_RESHADE_VERSION ===
      (await getKeyOrDefault("installed_reshade", "")) &&
    (await hasRuntimeFiles(reshaderDir, ["dxgi.dll", "d3dcompiler_47.dll"]))
  ) {
    await removeRuntimeInstaller(legacyArchive);
    await removeRuntimeInstaller(installer);
    return;
  }
  await mkdirp(reshaderDir);
  await mkdirp(join(reshaderDir, "Shaders"));
  await mkdirp(join(reshaderDir, "Textures"));
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  for (const [uri, absDst] of [
    [
      `https://reshade.me/downloads/ReShade_Setup_${CURRENT_RESHADE_VERSION}_Addon.exe`,
      installer,
    ],
    [
      "https://lutris.net/files/tools/dll/d3dcompiler_47.dll",
      join(reshaderDir, "d3dcompiler_47.dll"),
    ],
  ]) {
    for await (const progress of aria2.doStreamingDownload({ uri, absDst })) {
      yield [
        "setProgress",
        Number((progress.completedLength * BigInt(100)) / progress.totalLength),
      ];
      yield downloadProgress(progress);
    }
  }
  yield ["setStateText", "EXTRACT_ENVIRONMENT"];
  yield ["setUndeterminedProgress"];
  // macOS tar reads the ZIP payload directly from the self-extracting EXE.
  try {
    await exec(["/usr/bin/tar", "-xf", installer, "-C", reshaderDir]);
  } catch (error) {
    if (isDownloadCancelledError(error)) throw error;
    await removeRuntimeInstaller(installer);
    throw new DownloadFailedError(
      `ReShade extraction failed: ${String(error)}`
    );
  }
  await forceMove(
    join(reshaderDir, "ReShade64.dll"),
    join(reshaderDir, "dxgi.dll")
  );
  await writeFile(
    join(gameDir, "ReShade.ini"),
    `[GENERAL]\nEffectSearchPaths=${wine.toWinePath(
      resolve("./reshade/Shaders")
    )}\nTextureSearchPaths=${wine.toWinePath(resolve("./reshade/Textures"))}`
  );
  await setKey("installed_reshade", CURRENT_RESHADE_VERSION);
  await removeRuntimeInstaller(legacyArchive);
  await removeRuntimeInstaller(installer);
}
