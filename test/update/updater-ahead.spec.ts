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
  removeFile: vi.fn(),
  resolve: (path: string) => path,
}));
vi.mock("@logging/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  logerror: vi.fn(),
}));

import { getKey } from "@runtime/storage";
import { createUpdater } from "@src/update/updater";

const mockedGetKey = vi.mocked(getKey);

function releaseWithTag(tagName: string) {
  return {
    tag_name: tagName,
    body: "body",
    assets: [
      {
        name: "Yaaglm.GI.CN.app.tar.gz",
        browser_download_url: `https://github.com/example/download/${tagName}/Yaaglm.GI.CN.app.tar.gz`,
      },
    ],
  };
}

describe("createUpdater version comparison", () => {
  beforeEach(() => {
    mockedGetKey.mockReset();
    mockedGetKey.mockResolvedValue("true");
  });

  it("reports aheadOfLatest when the local version is newer than the latest release", async () => {
    const github = { api: vi.fn(async () => releaseWithTag("1.0.0")) };

    const result = await createUpdater({
      github: github as never,
      aria2: {} as never,
      automatic: false,
    });

    expect(result).toEqual({ latest: true, aheadOfLatest: true });
  });

  it("reports latest without aheadOfLatest when versions match", async () => {
    const github = { api: vi.fn(async () => releaseWithTag("1.1.0")) };

    const result = await createUpdater({
      github: github as never,
      aria2: {} as never,
      automatic: false,
    });

    expect(result).toEqual({ latest: true, aheadOfLatest: false });
  });

  it("reports an update when the latest release is newer", async () => {
    const github = { api: vi.fn(async () => releaseWithTag("1.2.0")) };

    const result = await createUpdater({
      github: github as never,
      aria2: {} as never,
      automatic: false,
    });

    expect(result.latest).toBe(false);
    if (result.latest === false) {
      expect(result.version).toBe("1.2.0");
    }
  });
});
