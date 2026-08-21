import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(),
  setKey: vi.fn(),
}));

import { getKey } from "@runtime/storage";
import {
  createUpdater,
  downloadProgram,
  getSidecarAppBundleName,
  getSidecarTopLevelDir,
} from "@src/update/updater";

const mockedGetKey = vi.mocked(getKey);

describe("createUpdater", () => {
  beforeEach(() => {
    mockedGetKey.mockReset();
  });

  it("skips automatic release checks when the setting is disabled", async () => {
    mockedGetKey.mockResolvedValue("false");
    const github = { api: vi.fn() };

    await expect(
      createUpdater({
        github: github as never,
        aria2: {} as never,
        automatic: true,
      })
    ).resolves.toEqual({ latest: true, aheadOfLatest: false });
    expect(github.api).not.toHaveBeenCalled();
  });

  it.each([
    ["mhycn", "Yaaglm.CN.app.tar.gz", "Yaaglm CN.app"],
    ["mhyos", "Yaaglm.OS.app.tar.gz", "Yaaglm OS.app"],
    ["cbjq", "Yaaglm.SCZ.OS.app.tar.gz", "Yaaglm SCZ OS.app"],
    ["cbjqcn", "Yaaglm.SCZ.app.tar.gz", "Yaaglm SCZ.app"],
  ])(
    "maps %s to its sidecar archive and top-level directory",
    (channel, archive, topLevelDir) => {
      expect(getSidecarAppBundleName(channel)).toBe(archive);
      expect(
        getSidecarTopLevelDir(`https://github.com/example/download/${archive}`)
      ).toBe(topLevelDir);
    }
  );

  // CURRENT_YAAGL_VERSION is "development" in the vitest environment.
  it("does not report an automatic update in development", async () => {
    mockedGetKey.mockResolvedValue("true");
    const github = { api: vi.fn() };

    const result = await createUpdater({
      github: github as never,
      aria2: {} as never,
      automatic: true,
    });

    expect(github.api).not.toHaveBeenCalled();
    expect(result.latest).toBe(true);
  });

  it("returns fixed update info for a manual check in development without hitting GitHub", async () => {
    mockedGetKey.mockResolvedValue("true");
    const github = { api: vi.fn() };

    const result = await createUpdater({
      github: github as never,
      aria2: {} as never,
      automatic: false,
    });

    expect(github.api).not.toHaveBeenCalled();
    expect(result.latest).toBe(false);
    if (result.latest === false) {
      expect(result.version).toBe("9.9.9-dev");
      expect(result.downloadUrl).toBe("development://mock-update");
    }
  });

  it("simulates update progress in development without downloading", async () => {
    const aria2 = { doStreamingDownload: vi.fn() };
    const commands: unknown[] = [];
    for await (const command of downloadProgram(
      aria2 as never,
      "development://mock-update",
      undefined
    )) {
      commands.push(command);
    }

    expect(aria2.doStreamingDownload).not.toHaveBeenCalled();
    expect(commands).toContainEqual([
      "setStateText",
      "DOWNLOADING_UPDATE_FILE",
    ]);
    expect(commands).toContainEqual(["setProgress", 100]);
    expect(commands).toContainEqual(["setUndeterminedProgress"]);
  });
});
