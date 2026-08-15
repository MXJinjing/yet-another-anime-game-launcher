import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(),
  setKey: vi.fn(),
}));

import { getKey } from "@runtime/storage";
import { createUpdater } from "@src/update/updater";

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

});
