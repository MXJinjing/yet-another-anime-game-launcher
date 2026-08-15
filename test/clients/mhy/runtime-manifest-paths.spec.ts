import { describe, expect, it } from "vitest";
import {
  isSafeTargetRelativePath,
  resolveSafeRuntimeManifestRecords,
} from "@src/clients/mhy/patch";

const gameDir = "/Games/AnimeGame";

describe("runtime replacement manifest paths", () => {
  it("derives the backup from a validated nested target", () => {
    expect(
      resolveSafeRuntimeManifestRecords(gameDir, [
        {
          targetRelativePath: "subdir/runtime.dll",
          backupRelativePath: "../../Documents/ignored",
        },
      ])
    ).toEqual([
      {
        targetRelativePath: "subdir/runtime.dll",
        target: "/Games/AnimeGame/subdir/runtime.dll",
        backup: "/Games/AnimeGame/subdir/runtime.dll.yaagl-runtime.bak",
      },
    ]);
  });

  it.each([
    "../../Documents/file",
    "/tmp/file",
    "C:\\Users\\user\\file",
    "..\\..\\Documents\\file",
    ".",
    "",
    "subdir/\0file",
  ])("rejects unsafe target %s", targetRelativePath => {
    expect(isSafeTargetRelativePath(targetRelativePath, gameDir)).toBe(false);
    expect(
      resolveSafeRuntimeManifestRecords(gameDir, [{ targetRelativePath }])
    ).toBeNull();
  });

  it("rejects the entire manifest when any record is invalid", () => {
    expect(
      resolveSafeRuntimeManifestRecords(gameDir, [
        { targetRelativePath: "runtime.dll" },
        { targetRelativePath: "../../Documents/file" },
      ])
    ).toBeNull();
  });

  it("rejects duplicate normalized targets", () => {
    expect(
      resolveSafeRuntimeManifestRecords(gameDir, [
        { targetRelativePath: "subdir/runtime.dll" },
        { targetRelativePath: "subdir/./runtime.dll" },
      ])
    ).toBeNull();
  });
});
