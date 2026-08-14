import { join, basename } from "path-browserify";
import { Sophon } from "@sophon";
import { CommonUpdateProgram } from "@common-update-ui";
import { Server } from "@constants";
import {
  downloadPercent,
  formatDownloadSpeed,
  log,
  mkdirp,
  humanFileSize,
  setKey,
  exec,
  fileOrDirExists,
} from "@utils";
import { gte } from "semver";

//https://stackoverflow.com/a/69399958

async function* downloadAndPatch(
  sophon: Sophon,
  gameDir: string
): CommonUpdateProgram {
  // Predownload downloads diffs without applying,
  // doesn't delete any files, and download new files
  // We don't have to check about predownloads as the
  // update progress should skip already downloaded files
  // and delete, patch, and download necessary files.
  const downloadTmp = join(gameDir, ".tmp");
  const taskId = await sophon.startUpdate({
    gamedir: gameDir,
    game_type: "hk4e",
    tempdir: downloadTmp,
    predownload: false,
  });
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "ALLOCATING_FILE"];
  let currentFileIndex = 0;
  let totalFileCount = 0;
  for await (const progress of sophon.streamOperationProgress(taskId)) {
    switch (progress.type) {
      case "delete_file":
        yield ["setStateText", "PATCHING"];
        yield [
          "setProgress",
          Number(progress.overall_progress.overall_percent),
        ];
        break;

      case "download_summary":
        totalFileCount = progress.download_file_count ?? 0;
        currentFileIndex = 0;
        break;

      case "file_download_start":
        currentFileIndex += 1;
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          "",
          "",
          "",
          "",
          "",
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        break;

      case "ldiff_download_summary":
        totalFileCount = progress.ldiff_file_count ?? 0;
        currentFileIndex = 0;
        break;

      case "ldiff_download_start":
        currentFileIndex += 1;
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          basename(progress.filename),
          "",
          "",
          "",
          "",
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        break;

      case "ldiff_download_complete":
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          basename(progress.filename),
          formatDownloadSpeed(progress.overall_progress.download_speed),
          humanFileSize(progress.overall_progress.downloaded_size),
          humanFileSize(progress.overall_progress.total_size),
          downloadPercent(
            progress.overall_progress.downloaded_size,
            progress.overall_progress.total_size
          ),
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        yield [
          "setProgress",
          Number(progress.overall_progress.overall_percent),
        ];
        break;

      case "chunk_progress":
        log(
          `下载中 ${basename(progress.filename)}：${humanFileSize(
            progress.overall_progress.downloaded_size
          )}/${humanFileSize(
            progress.overall_progress.total_size
          )}（${downloadPercent(
            progress.overall_progress.downloaded_size,
            progress.overall_progress.total_size
          )}%），速度 ${formatDownloadSpeed(
            progress.overall_progress.download_speed
          )}，文件 ${progress.current_file_index ?? currentFileIndex}/${
            progress.total_file_count ?? totalFileCount
          }`
        );
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          "",
          formatDownloadSpeed(progress.overall_progress.download_speed),
          humanFileSize(progress.overall_progress.downloaded_size),
          humanFileSize(progress.overall_progress.total_size),
          downloadPercent(
            progress.overall_progress.downloaded_size,
            progress.overall_progress.total_size
          ),
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        yield [
          "setProgress",
          Number(progress.overall_progress.overall_percent),
        ];
        break;

      case "delete_ldiff_file":
        yield ["setStateText", "PATCHING"];
        yield [
          "setProgress",
          Number(progress.overall_progress.overall_percent),
        ];
        break;
    }
  }
  yield ["setUndeterminedProgress"];
}

export async function* updateGameProgram({
  sophon,
  gameDir,
  server,
  updatedGameVersion,
}: {
  sophon: Sophon;
  gameDir: string;
  server: Server;
  updatedGameVersion: string;
}): CommonUpdateProgram {
  yield ["setStateText", "UPDATING"];
  // 3.6.0
  if (gte(updatedGameVersion, "3.6.0")) {
    if (
      await fileOrDirExists(
        join(
          gameDir,
          server.dataDir,
          "StreamingAssets",
          "Audio",
          "GeneratedSoundBanks",
          "Windows"
        )
      )
    ) {
      await mkdirp(
        join(gameDir, server.dataDir, "StreamingAssets", "AudioAssets")
      );
      await exec([
        "/bin/cp",
        "-R",
        "-f",
        join(
          gameDir,
          server.dataDir,
          "StreamingAssets",
          "Audio",
          "GeneratedSoundBanks",
          "Windows"
        ) + "/.",
        join(gameDir, server.dataDir, "StreamingAssets", "AudioAssets"),
      ]);
      await exec([
        "rm",
        "-rf",
        join(
          gameDir,
          server.dataDir,
          "StreamingAssets",
          "Audio",
          "GeneratedSoundBanks",
          "Windows"
        ),
      ]);
    }
  }

  yield* downloadAndPatch(sophon, gameDir);
  await setKey(`predownloaded_all`, null);
  // Writing config.ini is done in python script
}

async function* predownload(
  sophon: Sophon,
  gameDir: string
): CommonUpdateProgram {
  const downloadTmp = join(gameDir, ".tmp");
  const taskId = await sophon.startUpdate({
    gamedir: gameDir,
    game_type: "hk4e",
    tempdir: downloadTmp,
    predownload: true,
  });
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "ALLOCATING_FILE"];
  let currentFileIndex = 0;
  let totalFileCount = 0;
  for await (const progress of sophon.streamOperationProgress(taskId)) {
    switch (progress.type) {
      case "ldiff_download_summary":
        totalFileCount = progress.ldiff_file_count ?? 0;
        currentFileIndex = 0;
        break;

      case "ldiff_download_start":
        currentFileIndex += 1;
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          basename(progress.filename),
          "",
          "",
          "",
          "",
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        break;

      case "ldiff_download_complete":
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          basename(progress.filename),
          formatDownloadSpeed(progress.overall_progress.download_speed),
          humanFileSize(progress.overall_progress.downloaded_size),
          humanFileSize(progress.overall_progress.total_size),
          downloadPercent(
            progress.overall_progress.downloaded_size,
            progress.overall_progress.total_size
          ),
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        yield [
          "setProgress",
          Number(progress.overall_progress.overall_percent),
        ];
        break;

      case "chunk_progress":
        log(
          `下载中 ${basename(progress.filename)}：${humanFileSize(
            progress.overall_progress.downloaded_size
          )}/${humanFileSize(
            progress.overall_progress.total_size
          )}（${downloadPercent(
            progress.overall_progress.downloaded_size,
            progress.overall_progress.total_size
          )}%），速度 ${formatDownloadSpeed(
            progress.overall_progress.download_speed
          )}，文件 ${progress.current_file_index ?? currentFileIndex}/${
            progress.total_file_count ?? totalFileCount
          }`
        );
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          "",
          formatDownloadSpeed(progress.overall_progress.download_speed),
          humanFileSize(progress.overall_progress.downloaded_size),
          humanFileSize(progress.overall_progress.total_size),
          downloadPercent(
            progress.overall_progress.downloaded_size,
            progress.overall_progress.total_size
          ),
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        yield [
          "setProgress",
          Number(progress.overall_progress.overall_percent),
        ];
        break;
    }
  }
}

export async function* predownloadGameProgram({
  sophon,
  gameDir,
  targetVersion,
}: {
  sophon: Sophon;
  gameDir: string;
  targetVersion: string;
}) {
  yield* predownload(sophon, gameDir);
  await setKey(`predownloaded_all`, targetVersion);
}
