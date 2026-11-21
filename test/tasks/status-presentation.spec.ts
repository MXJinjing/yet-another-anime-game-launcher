import { describe, expect, it } from "vitest";
import {
  fileProgressLabel,
  presentTaskStatus,
} from "@src/tasks/status-presentation";

describe("task status presentation", () => {
  it("keeps integrity, repair, patch, and download counts out of the title", () => {
    expect(presentTaskStatus("SCANNING_FILES", ["12", "40"])).toMatchObject({
      titleKey: "CHECKING_GAME_INTEGRITY",
      index: 12,
      count: 40,
    });
    expect(
      presentTaskStatus("CHECKING_DOWNLOAD_FILES", [
        "3",
        "9",
        "data.pck",
        " (1/2)",
        "5",
      ])
    ).toMatchObject({
      titleKey: "CHECKING_EXISTING_FILES",
      index: 3,
      count: 9,
      file: "data.pck",
    });
    expect(presentTaskStatus("FIXING_FILES", ["1", "4"])).toMatchObject({
      titleKey: "REPAIRING_FILES",
      index: 1,
      count: 4,
    });
    expect(
      presentTaskStatus("PATCHING_FILE_PROGRESS", ["2", "8", "a.bin", "", "1"])
    ).toMatchObject({
      titleKey: "PATCHING",
      index: 2,
      count: 8,
      file: "a.bin",
    });
    expect(
      presentTaskStatus("DOWNLOADING_FILE_PROGRESS", [
        "pkg",
        "8 MB/s",
        "1 MB",
        "4 MB",
        "25%",
        "2",
        "6",
      ])
    ).toMatchObject({
      titleKey: "DOWNLOAD_PROGRESS",
      speed: "8 MB/s",
      index: 2,
      count: 6,
    });
    expect(
      presentTaskStatus("DOWNLOADING_ENVIRONMENT_SPEED", [
        "1 MB/s",
        "2 MB",
        "8 MB",
        "25%",
      ])
    ).toMatchObject({ titleKey: "DOWNLOADING_ENVIRONMENT", speed: "1 MB/s" });
    expect(presentTaskStatus("REVERT_PATCHING", ["3", "10"])).toMatchObject({
      titleKey: "REVERT_PATCHING",
      index: 3,
      count: 10,
    });
  });

  it("formats a file counter only when the total is known", () => {
    expect(fileProgressLabel({ index: 0, count: 4 })).toBe("0 / 4");
    expect(fileProgressLabel({ index: 1, count: 0 })).toBeUndefined();
    expect(fileProgressLabel(undefined)).toBeUndefined();
  });
});
