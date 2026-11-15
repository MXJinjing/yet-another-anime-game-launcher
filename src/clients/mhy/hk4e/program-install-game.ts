import type { SophonInstallSelection } from "../../../integrations/sophon-install-options";
import { processingProgressCommands } from "./processing-progress";
import { join, basename } from "path-browserify";
import { SophonClient, type SophonGameType } from "@sophon";
import type { TaskProgram } from "@tasks/task-program";
import { Server } from "@constants";
import { log } from "@logging/logger";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";
import { createTransferProgressTracker } from "./download-progress";
import { readSophonPredownloadDirectory } from "../../../integrations/sophon-settings";
import { globalStorage, type Storage } from "@runtime/storage";

export async function* downloadAndInstallGameProgram({
  sophonClient,
  gameDir,
  installReltype,
  selection,
  gameType = "hk4e",
  downloadKey,
  storage = globalStorage,
}: {
  sophonClient: SophonClient;
  gameDir: string;
  installReltype: string;
  selection?: SophonInstallSelection;
  gameType?: SophonGameType;
  /** Per-game download control key so the primary button can offer pause. */
  downloadKey?: string;
  storage?: Storage;
}): TaskProgram {
  yield ["setUndeterminedProgress"];
  log("Starting game installation process...");

  const taskId = await sophonClient.startInstallation(
    {
      gamedir: gameDir,
      game_type: gameType,
      install_reltype: installReltype,
      selection,
      predownloadRoot: await readSophonPredownloadDirectory(storage),
    },
    downloadKey
  );
  log(`Installation task started with ID: ${taskId}`);

  let currentFileIndex = 0;
  let totalFileCount = 0;
  const transferProgress = createTransferProgressTracker();
  for await (const progress of sophonClient.streamOperationProgress(taskId)) {
    switch (progress.type) {
      case "processing_progress":
        yield* processingProgressCommands(progress);
        break;

      case "job_start":
        yield ["setUndeterminedProgress"];
        yield ["setStateText", "ALLOCATING_FILE"];
        break;

      case "download_summary":
        totalFileCount = progress.download_file_count ?? 0;
        currentFileIndex = 0;
        break;

      case "file_download_start":
        currentFileIndex += 1;
        // Update the current file / file index immediately instead of waiting
        // for the next (throttled) chunk_progress broadcast, so the file row
        // and the counter always move together.
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          "",
          ...transferProgress.current(),
          String(progress.current_file_index ?? currentFileIndex),
          String(progress.total_file_count ?? totalFileCount),
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

      default:
        break;
    }
  }
}
