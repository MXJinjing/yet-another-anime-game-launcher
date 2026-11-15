import { afterEach, describe, expect, it, vi } from "vitest";
import { getKeyOrDefault, setKey, type Storage } from "@runtime/storage";
import { sophonDownloaderText } from "@locale/sophon-downloader";
import {
  readSophonPredownloadDirectory,
  saveSophonPredownloadDirectory,
  SOPHON_PREDOWNLOAD_DIRECTORY_KEY,
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

afterEach(() => {
  vi.resetAllMocks();
});

describe("Sophon downloader settings", () => {
  it("formats an invalid number with the selected language and limits", () => {
    const settings = { ...sophonDefaults, downloads: 17 };
    expect(sophonSettingsError(settings, sophonDownloaderText("zh_cn"))).toBe(
      "并发下载数必须是 1 到 16 之间的整数。"
    );
    expect(sophonSettingsError(settings, sophonDownloaderText("fr_fr"))).toBe(
      "Saisissez un entier entre 1 et 16 pour « Téléchargements simultanés »."
    );
  });

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

  it("keeps old directories available to unconfigured games after saving global settings", async () => {
    vi.mocked(getKeyOrDefault).mockResolvedValue(
      '{"predownloadDirectory":"/Volumes/Legacy","writes":4}'
    );
    const storage: Storage = {
      getKey: vi.fn().mockRejectedValue(new Error("missing preference")),
      getKeyOrDefault: vi.fn(),
      setKey: vi.fn(),
    };
    await expect(readSophonSettings()).resolves.not.toHaveProperty(
      "predownloadDirectory"
    );
    await saveSophonSettings({ ...sophonDefaults, writes: 5 });
    const stored = vi.mocked(setKey).mock.calls[0][1];
    expect(JSON.parse(stored ?? "{}")).toMatchObject({
      predownloadDirectory: "/Volumes/Legacy",
      writes: 5,
    });
    vi.mocked(getKeyOrDefault).mockResolvedValue(stored ?? "{}");
    await expect(readSophonPredownloadDirectory(storage)).resolves.toBe(
      "/Volumes/Legacy"
    );

    vi.mocked(storage.getKey).mockResolvedValueOnce("/Volumes/Game");
    await expect(readSophonPredownloadDirectory(storage)).resolves.toBe(
      "/Volumes/Game"
    );
    await saveSophonPredownloadDirectory(storage, "");
    expect(storage.setKey).toHaveBeenCalledWith(
      SOPHON_PREDOWNLOAD_DIRECTORY_KEY,
      ""
    );
    vi.mocked(storage.getKey).mockResolvedValueOnce("");
    await expect(readSophonPredownloadDirectory(storage)).resolves.toBe("");
    await expect(
      saveSophonPredownloadDirectory(storage, "relative")
    ).rejects.toThrow("absolute path");
    expect(storage.setKey).toHaveBeenCalledTimes(1);
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
