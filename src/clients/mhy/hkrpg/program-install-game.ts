import { join, basename } from "path-browserify";
import { Aria2, Aria2OverallProgress } from "@aria2";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "@constants";
import { removeFile, writeFile } from "@platform/neutralino";
import { doStreamUn7z } from "@runtime/archive";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";
import { mkdirp } from "@runtime/macos-filesystem";

export async function* downloadAndInstallGameProgram({
  aria2,
  gameSegmentZips,
  gameDir,
  gameVersion,
  server,
  totalBytes,
  downloadKey,
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
}): TaskProgram {
  const downloadTmp = join(gameDir, ".ariatmp");
  const downloadedFiles: string[] = [];

  await mkdirp(downloadTmp);
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "ALLOCATING_FILE"];

  // Track overall progress so the button's percentage covers every segment
  // instead of resetting to 0 for each file. The grand total from the
  // version-info API makes it accurate from the very first byte.
  const overall = new Aria2OverallProgress(totalBytes, downloadKey);
  for (const [fileNumber, gameFile7z] of gameSegmentZips.entries()) {
    const localFile = join(downloadTmp, basename(gameFile7z));
    for await (const progress of aria2.doStreamingDownload({
      uri: gameFile7z,
      absDst: localFile,
      downloadKey,
    })) {
      const current = overall.current(progress);
      yield ["setProgress", overall.step(progress)];
      yield [
        "setStateText",
        "DOWNLOADING_FILE_PROGRESS",
        basename(gameFile7z),
        formatDownloadSpeed(Number(progress.downloadSpeed)),
        humanFileSize(Number(current.completed)),
        humanFileSize(Number(current.total)),
        downloadPercent(current.completed, current.total),
        String(fileNumber + 1),
        String(gameSegmentZips.length),
      ];
    }
    overall.finishFile();
    downloadedFiles.push(localFile); // Save the downloaded file path
  }

  yield ["setStateText", "DECOMPRESS_FILE_PROGRESS"];

  for await (const [dec, total] of doStreamUn7z(downloadedFiles, gameDir)) {
    yield ["setProgress", (dec / total) * 100];
  }

  await writeFile(
    join(gameDir, "config.ini"),
    `[General]
game_version=${gameVersion}
channel=${server.channel_id}
sub_channel=${server.subchannel_id}
cps=${server.cps}`
  );

  for (const file of downloadedFiles) {
    await removeFile(file);
  }
}
