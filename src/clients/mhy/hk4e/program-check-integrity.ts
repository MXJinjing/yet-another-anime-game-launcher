import { basename, join } from "path-browserify";
import { Sophon } from "@sophon";
import { CommonUpdateProgram } from "@common-update-ui";
import {
  downloadPercent,
  formatDownloadSpeed,
  log,
  md5,
  stats,
  readAllLines,
  setKey,
  humanFileSize,
} from "@utils";

export async function* checkIntegrityProgram({
  sophon,
  gameDir,
}: {
  gameDir: string;
  sophon: Sophon;
}): CommonUpdateProgram {
  const taskId = await sophon.startRepair({
    gamedir: gameDir,
    game_type: "hk4e",
    repair_mode: "reliable",
  });

  yield ["setStateText", "SCANNING_FILES", "0", "0"];

  for await (const progress of sophon.streamOperationProgress(taskId)) {
    switch (progress.type) {
      case "auto_update_start":
        yield ["setStateText", "UPDATING"];
        yield ["setUndeterminedProgress"];
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
            formatDownloadSpeed(progress.overall_progress.download_speed),
            humanFileSize(progress.overall_progress.downloaded_size),
            humanFileSize(progress.overall_progress.total_size),
            downloadPercent(
              progress.overall_progress.downloaded_size,
              progress.overall_progress.total_size
            ),
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
        log(`Chunk progress: ${progress.chunk_size} bytes downloaded`);
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
