import { describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  globalStorage: {
    getKey: vi.fn(async () => ""),
    setKey: vi.fn(async () => undefined),
  },
}));

import type { Storage } from "@runtime/storage";
import { configEntries, createConfigStore } from "@config";
import { METALFX_FACTOR_DEFAULT } from "@src/config/metalfx-factor";
import {
  NAP_METALFX_CONFIG_KEY,
  readNapMetalFxEnabled,
  readNapMetalFxFactor,
  writeNapMetalFxEnabled,
  writeNapMetalFxFactor,
} from "@src/clients/mhy/nap/config/metalfx-storage";

function createFakeStorage(values: Record<string, string> = {}): Storage {
  return {
    async getKey(key: string) {
      const value = values[key];
      if (value == null) throw new Error(`Missing ${key}`);
      return value;
    },
    async getKeyOrDefault(key: string, defaultValue: string) {
      try {
        return await this.getKey(key);
      } catch {
        return defaultValue;
      }
    },
    async setKey(key: string, value: string | null) {
      if (value == null) delete values[key];
      else values[key] = value;
    },
  };
}

describe("ZZZ MetalFX switch storage", () => {
  it("reports off when the game scope has no value", async () => {
    await expect(readNapMetalFxEnabled(createFakeStorage())).resolves.toBe(
      false
    );
  });

  it("reads the value stored in the game scope", async () => {
    await expect(
      readNapMetalFxEnabled(
        createFakeStorage({ [NAP_METALFX_CONFIG_KEY]: "true" })
      )
    ).resolves.toBe(true);
    await expect(
      readNapMetalFxEnabled(
        createFakeStorage({ [NAP_METALFX_CONFIG_KEY]: "false" })
      )
    ).resolves.toBe(false);
  });

  it("writes the switch into the game scope it was given", async () => {
    const storage = createFakeStorage();

    await writeNapMetalFxEnabled(storage, true);
    await expect(readNapMetalFxEnabled(storage)).resolves.toBe(true);

    await writeNapMetalFxEnabled(storage, false);
    await expect(readNapMetalFxEnabled(storage)).resolves.toBe(false);
  });

  it("uses the launcher scope when no storage is passed", async () => {
    await expect(readNapMetalFxEnabled()).resolves.toBe(false);
  });
});

describe("ZZZ MetalFX factor storage", () => {
  const factorKey = configEntries.metalFxFactor.key;

  it("defaults to 2.0 when the game scope has no value", async () => {
    const store = createConfigStore(createFakeStorage());

    await expect(readNapMetalFxFactor(store)).resolves.toBe(
      METALFX_FACTOR_DEFAULT
    );
  });

  it("reads the factor stored in the game scope", async () => {
    const store = createConfigStore(createFakeStorage({ [factorKey]: "1.5" }));

    await expect(readNapMetalFxFactor(store)).resolves.toBe(1.5);
  });

  it("ignores a stored factor outside the DXMT window", async () => {
    const store = createConfigStore(createFakeStorage({ [factorKey]: "3" }));

    await expect(readNapMetalFxFactor(store)).resolves.toBe(
      METALFX_FACTOR_DEFAULT
    );
  });

  it("writes the factor into the game scope", async () => {
    const storage = createFakeStorage();
    const store = createConfigStore(storage);

    await writeNapMetalFxFactor(store, 1.25);

    await expect(storage.getKey(factorKey)).resolves.toBe("1.25");
  });

  it("normalizes an out-of-range factor before writing", async () => {
    const storage = createFakeStorage();
    const store = createConfigStore(storage);

    await writeNapMetalFxFactor(store, 3);

    await expect(storage.getKey(factorKey)).resolves.toBe(
      String(METALFX_FACTOR_DEFAULT)
    );
  });
});
