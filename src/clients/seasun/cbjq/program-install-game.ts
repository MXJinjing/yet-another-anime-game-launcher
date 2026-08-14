import { join, basename, dirname } from "path-browserify";
import { Aria2, Aria2OverallProgress } from "@aria2";
import { CommonUpdateProgram } from "@common-update-ui";
import { Server } from "../server";
import {
  humanFileSize,
  formatDownloadSpeed,
  downloadPercent,
  log,
  mkdirp,
  removeFile,
  stats,
  writeFile,
} from "@utils";
import { LauncherResourceData } from "./launcher-info";

export async function* downloadAndInstallGameProgram({
  aria2,
  resourceData,
  gameDir,
  server,
  totalBytes,
}: {
  resourceData: LauncherResourceData;
  gameDir: string;
  aria2: Aria2;
  server: Server;
  /** Grand total of all paks in bytes, from the launcher resource data. */
  totalBytes?: bigint;
}): CommonUpdateProgram {
  let index = 0;
  // Track overall progress so the button's percentage covers every pak.
  // The known grand total makes it accurate from the very first byte.
  const overall = new Aria2OverallProgress(totalBytes);
  for (const pak of resourceData.paks) {
    await mkdirp(join(gameDir, dirname(pak.name)));
    // TODO: change this to concurrent
    yield* downloadOrRecover(
      aria2,
      join(server.dlc, resourceData.pathOffset, pak.hash).replace(":/", "://"), //....join: wtf?
      join(gameDir, pak.name),
      index++,
      resourceData.paks.length,
      overall
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
  overall: Aria2OverallProgress
): CommonUpdateProgram<void> {
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
