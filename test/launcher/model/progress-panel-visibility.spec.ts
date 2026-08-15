import { describe, expect, it } from "vitest";
import { getProgressPanelVisibility } from "@src/launcher/model/progress-panel-visibility";

describe("progress panel visibility", () => {
  it("shows transfer totals, counters, and speed", () => {
    expect(
      getProgressPanelVisibility({
        isDownloadStatus: true,
        speed: "1 MB/s",
        downloaded: "10 MB",
        total: "20 MB",
        fileIndex: "2",
        fileCount: "5",
      })
    ).toEqual({
      showFileRow: false,
      showFileIndex: true,
      showDownloadedRow: true,
      showSpeedRow: true,
    });
  });
});
