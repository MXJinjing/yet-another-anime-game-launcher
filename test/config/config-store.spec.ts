import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(),
  setKey: vi.fn(),
}));

import { getKey, setKey } from "@runtime/storage";
import { createConfigStore } from "@config/config-store";
import { configEntries } from "@config/shared-entries";

const mockedGetKey = vi.mocked(getKey);
const mockedSetKey = vi.mocked(setKey);

describe("ConfigStore", () => {
  beforeEach(() => {
    mockedGetKey.mockReset();
    mockedSetKey.mockReset();
  });

  it("decodes persisted values through their typed entries", async () => {
    mockedGetKey.mockResolvedValueOnce("true").mockResolvedValueOnce("120");
    const store = createConfigStore();

    await expect(store.read(configEntries.retina)).resolves.toBe(true);
    await expect(
      store.read(configEntries.downloadSpeedLimitValue)
    ).resolves.toBe(120);
  });

  it("uses an entry default for unavailable or malformed values", async () => {
    mockedGetKey
      .mockRejectedValueOnce(new Error("missing value"))
      .mockResolvedValueOnce("not-a-number");
    const store = createConfigStore();

    await expect(store.read(configEntries.proxyHost)).resolves.toBe(
      "127.0.0.1:8080"
    );
    await expect(
      store.read(configEntries.downloadSpeedLimitValue)
    ).resolves.toBe(1024);
  });

  it("serializes and removes values using the entry key", async () => {
    const store = createConfigStore();

    await store.write(configEntries.debugMode, true);
    await store.remove(configEntries.debugMode);

    expect(setKey).toHaveBeenNthCalledWith(1, "config_debug_mode", "true");
    expect(setKey).toHaveBeenNthCalledWith(2, "config_debug_mode", null);
  });
});
