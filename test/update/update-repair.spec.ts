import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@constants", () => ({
  CURRENT_YAAGL_VERSION: "1.1.0",
}));
vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(),
  setKey: vi.fn(),
}));
vi.mock("@platform/neutralino", () => ({
  env: vi.fn(async () => ""),
  readFile: vi.fn(async () => ""),
  removeFile: vi.fn(),
  resolve: (path: string) => path,
}));
vi.mock("@runtime/command-runner", () => ({
  exec: vi.fn(),
}));
vi.mock("@runtime/macos-filesystem", () => ({
  cp: vi.fn(),
  forceMove: vi.fn(),
  mkdirp: vi.fn(),
  rmrf_dangerously: vi.fn(),
}));
vi.mock("@runtime/archive", () => ({
  tar_extract: vi.fn(),
}));
vi.mock("@logging/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  logerror: vi.fn(),
}));

import { env, readFile } from "@platform/neutralino";
import {
  getReleaseAssetsForVersion,
  isUpdateHalfApplied,
} from "@src/update/updater";

const mockedEnv = vi.mocked(env);
const mockedReadFile = vi.mocked(readFile);

const BUNDLE_MANIFEST =
  "/Applications/Yaaglm.app/Contents/Resources/build-manifest.json";

function manifest(version: string) {
  return JSON.stringify({
    bundleId: "com.3shain.yaaglm",
    version,
    appName: "Yaaglm",
  });
}

function releaseWithAssets(tagName: string, withSidecar = true) {
  return {
    tag_name: tagName,
    body: "body",
    assets: [
      {
        name: "resources_hk4ecn.neu",
        browser_download_url: `https://github.com/example/download/${tagName}/resources_hk4ecn.neu`,
      },
      ...(withSidecar
        ? [
            {
              name: "Yaaglm.app.tar.gz",
              browser_download_url: `https://github.com/example/download/${tagName}/Yaaglm.app.tar.gz`,
            },
          ]
        : []),
    ],
  };
}

describe("half-applied update detection", () => {
  beforeEach(() => {
    mockedEnv.mockReset();
    mockedReadFile.mockReset();
    mockedReadFile.mockResolvedValue(manifest("1.1.0"));
  });

  it("detects a stale working-dir manifest (old broken hot update)", async () => {
    mockedReadFile.mockResolvedValueOnce(manifest("1.0.0"));
    await expect(isUpdateHalfApplied()).resolves.toBe(true);
  });

  it("detects a stale bundle manifest even when the working dir is current", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm.app");
    mockedReadFile
      .mockResolvedValueOnce(manifest("1.1.0")) // working dir
      .mockResolvedValueOnce(manifest("1.0.0")); // bundle
    await expect(isUpdateHalfApplied()).resolves.toBe(true);
    expect(mockedReadFile).toHaveBeenCalledWith(BUNDLE_MANIFEST);
  });

  it("is a no-op when both manifests match the running version", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm.app");
    await expect(isUpdateHalfApplied()).resolves.toBe(false);
  });

  it("does not repair when the manifest is NEWER than the running frontend", async () => {
    // A partial apply of a newer release (bundle/manifest already newer, neu
    // not yet swapped) must be left to the normal update flow, not downgraded.
    mockedReadFile.mockResolvedValueOnce(manifest("1.2.0")); // working dir
    await expect(isUpdateHalfApplied()).resolves.toBe(false);
  });

  it("is a no-op when the manifest is unreadable", async () => {
    mockedReadFile.mockRejectedValue(new Error("ENOENT"));
    await expect(isUpdateHalfApplied()).resolves.toBe(false);
  });
});

describe("release assets for a pinned version", () => {
  beforeEach(() => {
    mockedEnv.mockReset();
  });

  it("returns the neu + sidecar archive URLs for the release tag", async () => {
    const github = { api: vi.fn(async () => releaseWithAssets("1.1.0")) };
    await expect(
      getReleaseAssetsForVersion(github as never, "1.1.0")
    ).resolves.toEqual({
      downloadUrl:
        "https://github.com/example/download/1.1.0/resources_hk4ecn.neu",
      sidecarDownloadUrl:
        "https://github.com/example/download/1.1.0/Yaaglm.app.tar.gz",
    });
    expect(github.api).toHaveBeenCalledWith(
      "/repos/MXJinjing/yet-another-anime-game-launcher/releases/tags/1.1.0"
    );
  });

  it("omits the sidecar URL when the release has no app bundle asset", async () => {
    const github = {
      api: vi.fn(async () => releaseWithAssets("1.1.0", false)),
    };
    await expect(
      getReleaseAssetsForVersion(github as never, "1.1.0")
    ).resolves.toEqual({
      downloadUrl:
        "https://github.com/example/download/1.1.0/resources_hk4ecn.neu",
      sidecarDownloadUrl: undefined,
    });
  });

  it("returns undefined when the release is missing the neu asset or the API fails", async () => {
    const noNeu = {
      api: vi.fn(async () => ({ tag_name: "1.1.0", assets: [] })),
    };
    await expect(
      getReleaseAssetsForVersion(noNeu as never, "1.1.0")
    ).resolves.toBeUndefined();

    const failing = {
      api: vi.fn(async () => Promise.reject(new Error("404"))),
    };
    await expect(
      getReleaseAssetsForVersion(failing as never, "1.1.0")
    ).resolves.toBeUndefined();
  });
});
