import { basename } from "path-browserify";
import type { SophonProgressEvent } from "@sophon";
import type { TaskProgressCommand } from "@tasks/task-program";
import { humanFileSize } from "@runtime/format";

/** Local file work has its own counters; it never reuses network statistics. */
export function* processingProgressCommands(
  event: SophonProgressEvent
): Generator<TaskProgressCommand> {
  const processed = Math.max(0, Number(event.processed_files) || 0);
  const total = Math.max(0, Number(event.total_files) || 0);
  const bytes = Math.max(0, Number(event.current_bytes) || 0);
  const fileBytes = Math.max(0, Number(event.file_bytes) || 0);
  yield [
    "setStateText",
    event.phase === "patching"
      ? "PATCHING_FILE_PROGRESS"
      : "CHECKING_DOWNLOAD_FILES",
    String(processed),
    String(total),
    basename(String(event.filename ?? "")),
    fileBytes > 0
      ? ` (${humanFileSize(bytes)}/${humanFileSize(fileBytes)})`
      : "",
    String(Math.max(0, Number(event.elapsed_seconds) || 0)),
  ];
  yield [
    "setProgress",
    total > 0 ? Math.min(100, (processed / total) * 100) : 100,
  ];
  yield ["setDownloadStats", { speed: 0, downloaded: 0, total: 0 }];
}
