import { join, basename } from "path-browserify";
import { Aria2, Aria2OverallProgress } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "@constants";
import { removeFile, stats, writeFile } from "@platform/neutralino";
import { rawString } from "@platform/shell";
import { doStreamUnzip } from "@runtime/archive";
import { sha1sum } from "@runtime/binary";
import { exec } from "@runtime/command-runner";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";
import { mkdirp } from "@runtime/macos-filesystem";
import { globalStorage, type Storage } from "@runtime/storage";

export async function* downloadAndInstallGameProgram({
  aria2,
  gameSegmentZips,
  gameDir,
  gameVersion,
  server,
  totalBytes,
  downloadKey,
  storage = globalStorage,
}: {
  gameSegmentZips: string[];
  gameDir: string;
  gameVersion: string;
  aria2: Aria2;
  server: Server;
  /** Grand total of all segments in bytes, from the version-info API. */
  totalBytes?: bigint;
  /** Per-game download control key so the primary button can offer pause. */
  downloadKey?: string;
  storage?: Storage;
}): TaskProgram {
  const downloadTmp = join(gameDir, ".ariatmp");

  await mkdirp(downloadTmp);

  const deferredCleanup: (() => Promise<void>)[] = [];

  // Track overall progress so the button's percentage covers every segment.
  // The grand total from the version-info API makes it accurate up front.
  const overall = new Aria2OverallProgress(totalBytes, downloadKey);
  for (const [fileNumber, segment] of gameSegmentZips.entries()) {
    deferredCleanup.push(
      yield* downloadOrRecover(
        aria2,
        segment,
        join(downloadTmp, basename(segment)),
        overall,
        fileNumber + 1,
        gameSegmentZips.length,
        downloadKey,
        storage
      )
    );
  }

  yield ["setUndeterminedProgress"];
  yield ["setStateText", "DECOMPRESS_FILE_PROGRESS"];
  const gameFileTmp = join(
    downloadTmp,
    basename(`${gameSegmentZips[0]}`.replace(".001", ""))
  );

  await exec([
    "cat",
    ...gameSegmentZips.map(x => join(downloadTmp, basename(x))),
    rawString(">"),
    gameFileTmp,
  ]);

  deferredCleanup.forEach(x => x());

  for await (const [dec, total] of doStreamUnzip(gameFileTmp, gameDir)) {
    yield ["setProgress", (dec / total) * 100];
  }
  await removeFile(gameFileTmp);

  await writeFile(
    join(gameDir, "config.ini"),
    `[General]
game_version=${gameVersion}
channel=${server.channel_id}
sub_channel=${server.subchannel_id}
cps=${server.cps}`
  );
}

async function* downloadOrRecover(
  aria2: Aria2,
  remoteUrl: string,
  localTempUrl: string,
  overall: Aria2OverallProgress,
  fileNumber: number,
  fileCount: number,
  downloadKey?: string,
  storage: Storage = globalStorage
): TaskProgram<() => Promise<void>> {
  try {
    await storage.getKey(
      `predownloaded_${(await sha1sum(basename(remoteUrl))).slice(0, 32)}`
    );
    await stats(localTempUrl);
  } catch (e) {
    yield ["setUndeterminedProgress"];
    yield ["setStateText", "ALLOCATING_FILE"];
    let gameFileStart = false;
    for await (const progress of aria2.doStreamingDownload({
      uri: remoteUrl,
      absDst: localTempUrl,
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
        String(fileNumber),
        String(fileCount),
      ];
    }
    overall.finishFile();
    await storage.setKey(
      `predownloaded_${(await sha1sum(basename(remoteUrl))).slice(0, 32)}`,
      "1"
    );
  }
  return async () => {
    await removeFile(localTempUrl);
    await storage.setKey(
      `predownloaded_${(await sha1sum(basename(remoteUrl))).slice(0, 32)}`,
      null
    );
  };
}
