import type { SophonProgressEvent } from "@sophon";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";

export type TransferProgressArgs = [string, string, string, string];

export function createTransferProgressTracker() {
  let latest: TransferProgressArgs = ["", "", "", ""];

  return {
    current(): TransferProgressArgs {
      return latest;
    },
    update(progress: SophonProgressEvent): TransferProgressArgs {
      latest = [
        formatDownloadSpeed(progress.overall_progress.download_speed),
        humanFileSize(progress.overall_progress.downloaded_size),
        humanFileSize(progress.overall_progress.total_size),
        downloadPercent(
          progress.overall_progress.downloaded_size,
          progress.overall_progress.total_size
        ),
      ];
      return latest;
    },
  };
}
