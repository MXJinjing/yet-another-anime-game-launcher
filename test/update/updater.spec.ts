import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(),
  setKey: vi.fn(),
}));

import { getKey } from "@runtime/storage";
import {
  createUpdater,
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
    ).resolves.toEqual({ latest: true });
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
});
