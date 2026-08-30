import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(),
  setKey: vi.fn(),
  globalStorage: {
    namespace: undefined,
    getKey: vi.fn(),
    getKeyOrDefault: vi.fn(),
    setKey: vi.fn(),
  },
}));

import { globalStorage } from "@runtime/storage";
import { createConfigStore } from "@config/config-store";
import { configEntries } from "@config/shared-entries";

describe("ConfigStore", () => {
  beforeEach(() => {
    vi.mocked(globalStorage.getKey).mockReset();
    vi.mocked(globalStorage.setKey).mockReset();
  });

  it("decodes persisted values through their typed entries", async () => {
    vi.mocked(globalStorage.getKey)
      .mockResolvedValueOnce("true")
      .mockResolvedValueOnce("120");
    const store = createConfigStore();

    await expect(store.read(configEntries.retina)).resolves.toBe(true);
    await expect(
      store.read(configEntries.downloadSpeedLimitValue)
    ).resolves.toBe(120);
  });

  it("uses an entry default for unavailable or malformed values", async () => {
    vi.mocked(globalStorage.getKey)
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

    expect(globalStorage.setKey).toHaveBeenNthCalledWith(
      1,
      "config_debug_mode",
      "true"
    );
    expect(globalStorage.setKey).toHaveBeenNthCalledWith(
      2,
      "config_debug_mode",
      null
    );
  });
});
