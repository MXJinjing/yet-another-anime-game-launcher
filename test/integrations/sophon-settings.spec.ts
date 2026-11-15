import { afterEach, describe, expect, it, vi } from "vitest";
import { getKeyOrDefault, setKey } from "@runtime/storage";
import {
  readSophonSettings,
  saveSophonSettings,
  sophonDefaults,
  sophonOperationSettings,
  sophonSettingsError,
  sophonPredownloadPath,
} from "@src/integrations/sophon-settings";

vi.mock("@runtime/storage", () => ({
  getKeyOrDefault: vi.fn(),
  setKey: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

describe("Sophon downloader settings", () => {
  it("validates interdependent limits and write policy", () => {
    expect(
      sophonSettingsError({
        ...sophonDefaults,
        writes: 4,
        maxCachedFileHandles: 2,
      })
    ).toContain("one handle");
    expect(
      sophonSettingsError({
        ...sophonDefaults,
        writes: 4,
        maxCachedFileHandles: 2,
        ioPolicy: "serialized",
      })
    ).toBe("");
    expect(
      sophonSettingsError({
        ...sophonDefaults,
        diskCacheEnabled: false,
        writeMode: "in-place",
      })
    ).toContain("require disk caching");
    expect(
      sophonSettingsError({
        ...sophonDefaults,
        diskCacheEnabled: false,
        memoryMiB: 0,
      })
    ).toContain("greater than zero");
    expect(
      sophonSettingsError({
        ...sophonDefaults,
        predownloadDirectory: "relative",
      })
    ).toContain("absolute path");
    expect(sophonSettingsError({ ...sophonDefaults, writes: 1.5 })).toContain(
      "whole number"
    );
  });

  it("normalizes older partial settings and recovers from corrupted values", async () => {
    vi.mocked(getKeyOrDefault).mockResolvedValueOnce(
      '{"writes": 20, "maxCachedFileHandles": 1, "memoryMiB": "unknown"}'
    );
    await expect(readSophonSettings()).resolves.toMatchObject({
      writes: 16,
      maxCachedFileHandles: 16,
      memoryMiB: sophonDefaults.memoryMiB,
    });
    vi.mocked(getKeyOrDefault).mockResolvedValueOnce("not-json");
    await expect(readSophonSettings()).resolves.toEqual(sophonDefaults);
  });

  it("only saves valid settings and encodes worker/cache budgets per operation", async () => {
    await expect(
      saveSophonSettings({ ...sophonDefaults, checks: 0 })
    ).rejects.toThrow("Verification workers");
    expect(setKey).not.toHaveBeenCalled();
    const settings = {
      ...sophonDefaults,
      checks: 3,
      writes: 1,
      diskGiB: 5,
      memoryMiB: 32,
      preserveState: false,
    };
    await saveSophonSettings(settings);
    expect(setKey).toHaveBeenCalledWith(
      "config_sophon",
      JSON.stringify(settings)
    );
    expect(sophonOperationSettings(settings)).toMatchObject({
      checks: 3,
      writes: 1,
      transfer: {
        memoryLimit: 32 * 1024 ** 2,
        diskLimit: 5 * 1024 ** 3,
        preserveState: false,
      },
    });
  });

  it("scopes predownload storage by normalized game directory", async () => {
    const path = await sophonPredownloadPath("/Volumes/Cache", "/games/one");
    expect(path).toMatch(/^\/Volumes\/Cache\/yaaglm-sophon-[0-9a-f]{64}$/);
    await expect(
      sophonPredownloadPath("/Volumes/Cache", "/games/./one/")
    ).resolves.toBe(path);
    await expect(
      sophonPredownloadPath("/Volumes/Cache", "/games/two")
    ).resolves.not.toBe(path);
    await expect(
      sophonPredownloadPath("relative", "/games/one")
    ).resolves.toBeUndefined();
  });
});
