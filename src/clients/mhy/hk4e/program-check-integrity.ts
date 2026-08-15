import { basename, join } from "path-browserify";
import { Sophon } from "@sophon";
import type { TaskProgram } from "@tasks/task-program";
import { log } from "@logging/logger";
import { readAllLines, stats } from "@platform/neutralino";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";
import { md5 } from "@runtime/patching";
import { setKey } from "@runtime/storage";
import { createTransferProgressTracker } from "./download-progress";

export async function* checkIntegrityProgram({
  sophon,
  gameDir,
}: {
  gameDir: string;
  sophon: Sophon;
}): TaskProgram {
  const taskId = await sophon.startRepair({
    gamedir: gameDir,
    game_type: "hk4e",
    repair_mode: "reliable",
  });

  yield ["setStateText", "SCANNING_FILES", "0", "0"];

  let currentFileIndex = 0;
  let totalFileCount = 0;
  const transferProgress = createTransferProgressTracker();
  for await (const progress of sophon.streamOperationProgress(taskId)) {
    switch (progress.type) {
      case "auto_update_start":
        yield ["setStateText", "UPDATING"];
        yield ["setUndeterminedProgress"];
        break;

      case "repair_summary":
        totalFileCount = progress.total_files ?? 0;
        currentFileIndex = 0;
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

      case "delete_file":
      case "delete_ldiff_file":
      case "ldiff_patch_start":
      case "ldiff_patch_complete":
        yield ["setStateText", "PATCHING"];
        if (progress.overall_progress) {
          yield [
            "setProgress",
            Number(progress.overall_progress.overall_percent),
          ];
        }
        break;

      case "ldiff_download_complete":
      case "check_file":
        if (progress.type === "ldiff_download_complete") {
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
        }
        yield [
          "setStateText",
          "SCANNING_FILES",
          String(progress.overall_progress.checked_files),
          String(progress.overall_progress.total_files),
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
