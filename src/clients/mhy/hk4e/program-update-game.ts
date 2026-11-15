import { removeExternalSophonPredownload } from "@download/sophon-predownload";
import {
  readSophonPredownloadDirectory,
  SOPHON_PREDOWNLOAD_ROOT_KEY,
  SOPHON_PREDOWNLOAD_TARGET_KEY,
} from "../../../integrations/sophon-settings";
import { processingProgressCommands } from "./processing-progress";
import { join, basename } from "path-browserify";
import { Sophon, type SophonGameType } from "@sophon";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "@constants";
import { log } from "@logging/logger";
import { fileOrDirExists } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";
import { mkdirp } from "@runtime/macos-filesystem";
import { globalStorage, type Storage } from "@runtime/storage";
import { gte } from "semver";
import { createTransferProgressTracker } from "./download-progress";
import { readGameVersion } from "../../game-version";

//https://stackoverflow.com/a/69399958

async function* downloadAndPatch(
  sophon: Sophon,
  gameDir: string,
  installedVersion: string | undefined,
  gameType: SophonGameType,
  downloadKey?: string,
  predownloadRoot?: string
): TaskProgram {
  // Predownload downloads diffs without applying,
  // doesn't delete any files, and download new files
  // We don't have to check about predownloads as the
  // update progress should skip already downloaded files
  // and delete, patch, and download necessary files.
  const downloadTmp = join(gameDir, ".tmp");
  const taskId = await sophon.startUpdate(
    {
      gamedir: gameDir,
      game_type: gameType,
      tempdir: downloadTmp,
      installedVersion,
      predownload: false,
      predownloadRoot,
    },
    downloadKey
  );
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "ALLOCATING_FILE"];
  let currentFileIndex = 0;
  let totalFileCount = 0;
  const transferProgress = createTransferProgressTracker();
  for await (const progress of sophon.streamOperationProgress(taskId)) {
    switch (progress.type) {
      case "processing_progress":
        yield* processingProgressCommands(progress);
        break;

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
          ...transferProgress.current(),
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
          ...transferProgress.current(),
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        break;

      case "ldiff_download_complete":
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          basename(progress.filename),
          ...transferProgress.update(progress),
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
          )}），速度 ${formatDownloadSpeed(
            progress.overall_progress.download_speed
          )}，文件 ${progress.current_file_index ?? currentFileIndex}/${
            progress.total_file_count ?? totalFileCount
          }`
        );
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          "",
          ...transferProgress.update(progress),
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
  installedVersion,
  gameType = "hk4e",
  downloadKey,
  storage = globalStorage,
}: {
  sophon: Sophon;
  gameDir: string;
  server: Server;
  updatedGameVersion: string;
  installedVersion?: string;
  gameType?: SophonGameType;
  /** Per-game download control key so the primary button can offer pause. */
  downloadKey?: string;
  storage?: Storage;
}): TaskProgram {
  yield ["setStateText", "UPDATING"];
  // 3.6.0
  if (gameType === "hk4e" && gte(updatedGameVersion, "3.6.0")) {
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

  const { root: savedRoot, target: savedTarget } = await readPredownloadCache(
    storage
  );
  const predownloadRoot =
    savedTarget === updatedGameVersion || (!savedTarget && savedRoot)
      ? savedRoot
      : await readSophonPredownloadDirectory(storage);
  yield* downloadAndPatch(
    sophon,
    gameDir,
    installedVersion,
    gameType,
    downloadKey,
    predownloadRoot
  );
  await storage.setKey(`predownloaded_all`, null);
  try {
    await removeExternalSophonPredownload(savedRoot, gameDir);
    await storage.setKey(SOPHON_PREDOWNLOAD_ROOT_KEY, null);
    await storage.setKey(SOPHON_PREDOWNLOAD_TARGET_KEY, null);
  } catch (error) {
    void log(`Could not remove the Sophon predownload cache: ${error}`);
  }
}

async function readPredownloadCache(storage: Storage) {
  const [root, target, completed] = await Promise.all([
    storage.getKeyOrDefault(SOPHON_PREDOWNLOAD_ROOT_KEY, ""),
    storage.getKeyOrDefault(SOPHON_PREDOWNLOAD_TARGET_KEY, ""),
    storage.getKeyOrDefault("predownloaded_all", ""),
  ]);
  return {
    root,
    target: readGameVersion(target) ?? readGameVersion(completed),
  };
}

async function* predownload(
  sophon: Sophon,
  gameDir: string,
  installedVersion: string | undefined,
  gameType: SophonGameType,
  targetVersion: string,
  downloadKey?: string,
  predownloadRoot?: string
): TaskProgram {
  const downloadTmp = join(gameDir, ".tmp");
  const taskId = await sophon.startUpdate(
    {
      gamedir: gameDir,
      game_type: gameType,
      tempdir: downloadTmp,
      installedVersion,
      predownload: true,
      predownloadRoot,
      targetVersion,
    },
    downloadKey
  );
  yield ["setUndeterminedProgress"];
  yield ["setStateText", "ALLOCATING_FILE"];
  let currentFileIndex = 0;
  let totalFileCount = 0;
  const transferProgress = createTransferProgressTracker();
  for await (const progress of sophon.streamOperationProgress(taskId)) {
    switch (progress.type) {
      case "processing_progress":
        yield* processingProgressCommands(progress);
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
          ...transferProgress.current(),
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
        ];
        break;

      case "ldiff_download_complete":
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          basename(progress.filename),
          ...transferProgress.update(progress),
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
          )}），速度 ${formatDownloadSpeed(
            progress.overall_progress.download_speed
          )}，文件 ${progress.current_file_index ?? currentFileIndex}/${
            progress.total_file_count ?? totalFileCount
          }`
        );
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          "",
          ...transferProgress.update(progress),
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
  installedVersion,
  gameType = "hk4e",
  downloadKey,
  storage = globalStorage,
}: {
  sophon: Sophon;
  gameDir: string;
  targetVersion: string;
  installedVersion?: string;
  gameType?: SophonGameType;
  /** Per-game download control key so the primary button can offer pause. */
  downloadKey?: string;
  storage?: Storage;
}) {
  const { root: savedRoot, target: savedTarget } = await readPredownloadCache(
    storage
  );
  const predownloadDirectory =
    savedTarget === targetVersion || (!savedTarget && savedRoot)
      ? savedRoot
      : await readSophonPredownloadDirectory(storage);
  if (savedRoot !== predownloadDirectory) {
    await removeExternalSophonPredownload(savedRoot, gameDir);
  }
  if (savedTarget !== targetVersion) {
    await storage.setKey("predownloaded_all", null);
    await storage.setKey(
      SOPHON_PREDOWNLOAD_ROOT_KEY,
      predownloadDirectory || null
    );
    await storage.setKey(SOPHON_PREDOWNLOAD_TARGET_KEY, targetVersion);
  }
  yield* predownload(
    sophon,
    gameDir,
    installedVersion,
    gameType,
    targetVersion,
    downloadKey,
    predownloadDirectory
  );
  await storage.setKey(`predownloaded_all`, targetVersion);
}
