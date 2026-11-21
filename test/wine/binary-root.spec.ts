import { describe, expect, it, vi } from "vitest";

vi.mock("@platform/neutralino", () => ({
  env: vi.fn(),
  fileOrDirExists: vi.fn(),
  resolve: (path: string) => path,
}));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));
vi.mock("@runtime/storage", () => ({
  getKeyOrDefault: vi.fn(),
  setKey: vi.fn(),
}));

import {
  parseWineBinaryRootMode,
  resolveWineBinaryRoot,
} from "@src/wine/binary-root";

describe("wine binary root", () => {
  const launcherDataDir = "/Users/test/Library/Application Support/Yaaglm CN";
  const homeDir = "/Users/test";

  it("keeps runtimes in the launcher data directory by default", () => {
    expect(
      resolveWineBinaryRoot({
        mode: "launcher",
        launcherDataDir,
        homeDir,
      })
    ).toBe(`${launcherDataDir}/wines`);
  });

  it("uses the shared home directory for every channel", () => {
    expect(
      resolveWineBinaryRoot({
        mode: "shared",
        launcherDataDir,
        homeDir,
      })
    ).toBe("/Users/test/.local/yaaglm-wines");
  });

  it("uses an absolute custom directory and rejects unsafe paths", () => {
    expect(
      resolveWineBinaryRoot({
        mode: "custom",
        launcherDataDir,
        homeDir,
        customDir: "/Volumes/Games/wine",
      })
    ).toBe("/Volumes/Games/wine");
    expect(
      resolveWineBinaryRoot({
        mode: "custom",
        launcherDataDir,
        homeDir,
        customDir: "relative/wine",
      })
    ).toBe(`${launcherDataDir}/wines`);
    expect(
      resolveWineBinaryRoot({
        mode: "custom",
        launcherDataDir,
        homeDir,
        customDir: "/",
      })
    ).toBe(`${launcherDataDir}/wines`);
  });

  it("falls back to the launcher directory for an unknown mode", () => {
    expect(parseWineBinaryRootMode("shared")).toBe("shared");
    expect(parseWineBinaryRootMode("elsewhere")).toBe("launcher");
  });
});
