import { join, basename, dirname } from "path-browserify";
import { Aria2, Aria2OverallProgress } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "../server";
import { log } from "@logging/logger";
import { removeFile, stats, writeFile } from "@platform/neutralino";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";
import { mkdirp } from "@runtime/macos-filesystem";
import { LauncherResourceData } from "./launcher-info";

export async function* downloadAndInstallGameProgram({
  aria2,
  resourceData,
  gameDir,
  server,
  totalBytes,
  downloadKey,
}: {
  resourceData: LauncherResourceData;
  gameDir: string;
  aria2: Aria2;
  server: Server;
  /** Grand total of all paks in bytes, from the launcher resource data. */
  totalBytes?: bigint;
  /** Per-game download control key so the primary button can offer pause. */
  downloadKey?: string;
}): TaskProgram {
  let index = 0;
  // Track overall progress so the button's percentage covers every pak.
  // The known grand total makes it accurate from the very first byte.
  const overall = new Aria2OverallProgress(totalBytes, downloadKey);
  for (const pak of resourceData.paks) {
    await mkdirp(join(gameDir, dirname(pak.name)));
    // TODO: change this to concurrent
    yield* downloadOrRecover(
      aria2,
      join(server.dlc, resourceData.pathOffset, pak.hash).replace(":/", "://"), //....join: wtf?
      join(gameDir, pak.name),
      index++,
      resourceData.paks.length,
      overall,
      downloadKey
    );
  }

  await writeFile(join(gameDir, "manifest.json"), JSON.stringify(resourceData));
}

async function* downloadOrRecover(
  aria2: Aria2,
  remoteUrl: string,
  localUrl: string,
  fileIndex: number,
  totalFileCount: number,
  overall: Aria2OverallProgress,
  downloadKey?: string
): TaskProgram<void> {
  try {
    await stats(localUrl);
  } catch (e) {
    yield ["setUndeterminedProgress"];
    yield ["setStateText", "ALLOCATING_FILE"];
    await log(remoteUrl);
    let gameFileStart = false;
    for await (const progress of aria2.doStreamingDownload({
      uri: remoteUrl,
      absDst: localUrl,
      downloadKey,
    })) {
      if (!gameFileStart && progress.downloadSpeed == BigInt(0)) {
        continue;
      }
      gameFileStart = true;
      const current = overall.current(progress);
      yield ["setProgress", overall.step(progress)];
      yield [
        "setStateText",
        "DOWNLOADING_FILE_PROGRESS",
        basename(remoteUrl),
        formatDownloadSpeed(Number(progress.downloadSpeed)),
        humanFileSize(Number(current.completed)),
        humanFileSize(Number(current.total)),
        downloadPercent(current.completed, current.total),
        String(fileIndex + 1),
        String(totalFileCount),
      ];
    }
    overall.finishFile();
  }
}
