import { describe, expect, it, vi } from "vitest";
import {
  clearGameInstallDirectory,
  normalizeGameInstallDir,
} from "@services/game-uninstallation";

describe("game installation directory safety", () => {
  it.each(["", "relative/game", "/", "/Users/test", "/tmp/..", "/tmp/../"])(
    "rejects dangerous path %s",
    path => {
      expect(normalizeGameInstallDir(path, "/Users/test")).toBeNull();
    }
  );

  it("rejects paths containing NUL characters", () => {
    expect(normalizeGameInstallDir("/Games\0/Game", "/Users/test")).toBeNull();
  });

  it("normalizes and accepts a valid installation directory", () => {
    expect(normalizeGameInstallDir("/Games/Anime/../Game", "/Users/test")).toBe(
      "/Games/Game"
    );
  });
});

describe("game installation directory cleanup", () => {
  it("recursively removes children while preserving the root", async () => {
    const readDirectory = vi
      .fn()
      .mockResolvedValueOnce([
        { entry: "file.bin", type: "FILE" },
        { entry: "nested", type: "DIRECTORY" },
      ])
      .mockResolvedValueOnce([{ entry: "nested.bin", type: "FILE" }]);
    const removeDirectory = vi.fn(async () => undefined);
    const removeFile = vi.fn(async () => undefined);
    const stats = vi.fn(async () => ({
      size: 0,
      isFile: false,
      isDirectory: true,
    }));

    await clearGameInstallDirectory("/Games/Game", {
      readDirectory,
      removeDirectory,
      removeFile,
      stats,
    });

    expect(stats).toHaveBeenCalledWith("/Games/Game");
    expect(removeFile).toHaveBeenCalledWith("/Games/Game/file.bin");
    expect(removeFile).toHaveBeenCalledWith("/Games/Game/nested/nested.bin");
    expect(removeDirectory).toHaveBeenCalledWith("/Games/Game/nested");
  });

  it("does not remove anything when the target is not a directory", async () => {
    const readDirectory = vi.fn();
    const removeDirectory = vi.fn();
    const removeFile = vi.fn();
    await expect(
      clearGameInstallDirectory("/Games/Game", {
        readDirectory,
        removeDirectory,
        removeFile,
        stats: async () => ({
          size: 0,
          isFile: true,
          isDirectory: false,
        }),
      })
    ).rejects.toThrow("not a directory");
    expect(readDirectory).not.toHaveBeenCalled();
    expect(removeDirectory).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });
});
