import { describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  globalStorage: {
    getKey: vi.fn(async () => ""),
    setKey: vi.fn(async () => undefined),
  },
}));

import type { Storage } from "@runtime/storage";
import {
  NAP_METALFX_CONFIG_KEY,
  readNapMetalFxEnabled,
  writeNapMetalFxEnabled,
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
