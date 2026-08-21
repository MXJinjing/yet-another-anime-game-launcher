import { eq } from "semver";
import { Aria2, Aria2OverallProgress } from "@aria2";
import type { TaskProgram, TaskProgressCommand } from "@tasks/task-program";
import {
  doStreamUnzip,
  exec,
  forceMove,
  formatDownloadSpeed,
  humanFileSize,
  mkdirp,
  rmrf_dangerously,
} from "@runtime";
import { getKeyOrDefault, setKey } from "@runtime/storage";
import { downloadPercent } from "@runtime/format";
import {
  fileOrDirExists,
  readBinary,
  removeFile,
  writeBinary,
  writeFile,
} from "@platform/neutralino";
import { resolve } from "@platform/neutralino/path";
import type { Wine } from "./wine";
import { join } from "path-browserify";

const CURRENT_MVK_VERSION = "1.2.2";
const CURRENT_DXVK_VERSION = "1.10.4-alpha.20230402";
const CURRENT_JADEITE_VERSION = "4.1.0";
const CURRENT_DXMT_VERSION = "0.80.0";
const CURRENT_RESHADE_VERSION = "5.8.0";

export const DXVK_FILES = [
  "d3d9.dll",
  "d3d10core.dll",
  "d3d11.dll",
  "dxgi.dll",
];
export const DXMT_FILES = ["d3d10core.dll", "d3d11.dll", "dxgi.dll"];

export async function isDXMTInstalled(): Promise<boolean> {
  return eq(
    CURRENT_DXMT_VERSION,
    await getKeyOrDefault("installed_dxmt_version", "0.0.0")
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
    (await fileOrDirExists("./moltenvk/libMoltenVK.dylib")) &&
    eq(
      CURRENT_MVK_VERSION,
      await getKeyOrDefault("installed_moltenvk_version", "0.0.0")
    )
  )
    return;
  await mkdirp("./moltenvk");
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  for await (const progress of aria2.doStreamingDownload({
    uri: "https://github.com/3Shain/winecx/releases/download/gi-wine-1.0/libMoltenVK.dylib",
    absDst: resolve("./moltenvk/libMoltenVK.dylib"),
  })) {
    yield [
      "setProgress",
      Number((progress.completedLength * BigInt(100)) / progress.totalLength),
    ];
    yield downloadProgress(progress);
  }
  await setKey("installed_moltenvk_version", CURRENT_MVK_VERSION);
}

export async function* checkAndDownloadDXVK(aria2: Aria2): TaskProgram {
  if (
    eq(
      CURRENT_DXVK_VERSION,
      await getKeyOrDefault("installed_dxvk_version", "0.0.0")
    )
  )
    return;
  await mkdirp("./dxvk");
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  const overall = new Aria2OverallProgress();
  for (const [fileNumber, file] of DXVK_FILES.entries()) {
    for await (const progress of aria2.doStreamingDownload({
      uri: `https://github.com/3Shain/winecx/releases/download/gi-wine-1.0/${file}`,
      absDst: resolve(`./dxvk/${file}`),
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
    overall.finishFile();
  }
  await setKey("installed_dxvk_version", CURRENT_DXVK_VERSION);
}

export async function* checkAndDownloadJadeite(aria2: Aria2): TaskProgram {
  if (
    eq(
      CURRENT_JADEITE_VERSION,
      await getKeyOrDefault("installed_jadeite_version", "0.0.0")
    )
  )
    return;
  await rmrf_dangerously(resolve("./jadeite"));
  await mkdirp("./jadeite");
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  for await (const progress of aria2.doStreamingDownload({
    uri: "https://codeberg.org/mkrsym1/jadeite/releases/download/v4.1.0/v4.1.0.zip",
    absDst: resolve("./jadeite/archive.zip"),
  })) {
    yield [
      "setProgress",
      Number((progress.completedLength * BigInt(100)) / progress.totalLength),
    ];
    yield downloadProgress(progress);
  }
  for await (const [dec, total] of doStreamUnzip(
    resolve("./jadeite/archive.zip"),
    resolve("./jadeite")
  ))
    yield ["setProgress", (dec / total) * 100];
  await setKey("installed_jadeite_version", CURRENT_JADEITE_VERSION);
}

export async function* checkAndDownloadDXMT(aria2: Aria2): TaskProgram {
  if (
    eq(
      CURRENT_DXMT_VERSION,
      await getKeyOrDefault("installed_dxmt_version", "0.0.0")
    )
  )
    return;
  await rmrf_dangerously(resolve("./dxmt"));
  await mkdirp("./dxmt");
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  const archiveName = "dxmt-v0.80-builtin.tar.gz";
  for await (const progress of aria2.doStreamingDownload({
    uri: `https://github.com/3Shain/dxmt/releases/download/v0.80/${archiveName}`,
    absDst: resolve(`./dxmt/${archiveName}`),
  })) {
    yield [
      "setProgress",
      Number((progress.completedLength * BigInt(100)) / progress.totalLength),
    ];
    yield downloadProgress(progress);
  }
  yield ["setStateText", "EXTRACT_ENVIRONMENT"];
  yield ["setUndeterminedProgress"];
  await exec([
    "tar",
    "-xvf",
    resolve(`./dxmt/${archiveName}`),
    "-C",
    resolve("./dxmt"),
  ]);
  await exec([
    "sh",
    "-c",
    `mv "${resolve("./dxmt/v0.80/x86_64-windows/")}"* "${resolve("./dxmt/")}"`,
  ]);
  await exec([
    "sh",
    "-c",
    `mv "${resolve("./dxmt/v0.80/x86_64-unix/")}"* "${resolve("./dxmt/")}"`,
  ]);
  await rmrf_dangerously(resolve("./dxmt/v0.80"));
  await removeFile(resolve(`./dxmt/${archiveName}`));
  await setKey("installed_dxmt_version", CURRENT_DXMT_VERSION);
}

export async function* checkAndDownloadReshade(
  aria2: Aria2,
  wine: Wine,
  gameDir: string
): TaskProgram {
  const reshaderDir = resolve("./reshade");
  if (
    eq(
      CURRENT_RESHADE_VERSION,
      await getKeyOrDefault("installed_reshade", "0.0.0")
    )
  )
    return;
  await mkdirp(reshaderDir);
  await mkdirp(join(reshaderDir, "Shaders"));
  await mkdirp(join(reshaderDir, "Textures"));
  yield ["setStateText", "DOWNLOADING_ENVIRONMENT"];
  for (const [uri, absDst] of [
    [
      `https://reshade.me/downloads/ReShade_Setup_${CURRENT_RESHADE_VERSION}_Addon.exe`,
      join(reshaderDir, "install.exe"),
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
  const archive = await readBinary(join(reshaderDir, "install.exe"));
  const bytes = new Uint8Array(archive);
  const offset = bytes.findIndex(
    (value, index, all) =>
      value === 0x50 &&
      all[index + 1] === 0x4b &&
      all[index + 2] === 0x03 &&
      all[index + 3] === 0x04
  );
  await writeBinary(join(reshaderDir, "install.zip"), archive.slice(offset));
  for await (const [dec, total] of doStreamUnzip(
    join(reshaderDir, "install.zip"),
    reshaderDir
  ))
    yield ["setProgress", (dec / total) * 100];
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
}
