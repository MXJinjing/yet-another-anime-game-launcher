import { describe, expect, it, vi } from "vitest";
import { createConfigStore } from "@config";
import {
  detectDisplayRefreshRate,
  dxmtFrameRateOverride,
  dxmtRefreshRateEntry,
  loadDxmtRefreshRate,
  parseRefreshRate,
} from "@config/dxmt-refresh-rate";

describe("DXMT refresh rate", () => {
  it("uses the first display with a valid refresh rate and rounds it", async () => {
    const getDisplays = async () =>
      [0, Infinity, 143.8, 60].map(refreshRate => ({ refreshRate }));

    await expect(detectDisplayRefreshRate(getDisplays)).resolves.toBe(144);
    await expect(detectDisplayRefreshRate(async () => [])).resolves.toBe(60);
    await expect(
      detectDisplayRefreshRate(async () => {
        throw new Error("unavailable");
      })
    ).resolves.toBe(60);
  });

  it.each([
    [59.6, 60],
    [119, 119],
    [120, 60],
    [143.8, 72],
    [165, 83],
    [240, 60],
  ])("folds %s Hz to a %s FPS override", (rate, fps) => {
    expect(
      dxmtFrameRateOverride({ enabled: true, rate, displayRate: 120 })
    ).toBe(`d3d11.preferredMaxFrameRate=${fps};`);
  });

  it("uses the detected refresh rate in automatic mode and omits custom zero", () => {
    expect(
      dxmtFrameRateOverride({ enabled: false, rate: 120, displayRate: 144 })
    ).toBe("d3d11.preferredMaxFrameRate=144;");
    expect(
      dxmtFrameRateOverride({ enabled: true, rate: 0, displayRate: 144 })
    ).toBe("");
  });

  it.each<[string | undefined, boolean, number]>([
    [undefined, false, 165],
    ["0", false, 165],
    ["auto", false, 165],
    ["144", true, 144],
  ])("migrates a legacy %s preference", async (legacy, enabled, rate) => {
    const values = new Map<string, string>();
    if (legacy !== undefined) values.set("config_preferred_max_fps", legacy);
    const store = createConfigStore({
      async getKey(key) {
        const value = values.get(key);
        if (value === undefined) throw new Error("missing key");
        return value;
      },
      async getKeyOrDefault(key, fallback) {
        return values.get(key) ?? fallback;
      },
      async setKey(key, value) {
        if (value === null) values.delete(key);
        else values.set(key, value);
      },
    });
    const detect = vi.fn(async () => 165);
    const migrated = await loadDxmtRefreshRate(store, detect);
    expect(migrated).toEqual({ enabled, rate, displayRate: 165 });
    expect(dxmtFrameRateOverride(migrated)).toBe(
      `d3d11.preferredMaxFrameRate=${enabled ? 72 : 165};`
    );
    const saved = { enabled: true, rate: 0 };
    await store.write(dxmtRefreshRateEntry, saved);
    await expect(loadDxmtRefreshRate(store, detect)).resolves.toEqual({
      ...saved,
      displayRate: 165,
    });

    await store.write(dxmtRefreshRateEntry, { enabled: false, rate: 120 });
    detect.mockResolvedValue(144);
    const reopened = await loadDxmtRefreshRate(store, detect);
    expect(reopened).toEqual({ enabled: false, rate: 120, displayRate: 144 });
    expect(dxmtFrameRateOverride(reopened)).toBe(
      "d3d11.preferredMaxFrameRate=144;"
    );
  });

  it("does not treat a blank or invalid edit as custom zero", () => {
    for (const input of ["", " ", "-1", "Infinity", "60Hz"]) {
      expect(parseRefreshRate(input)).toBeUndefined();
    }
    expect(parseRefreshRate("0")).toBe(0);
    expect(parseRefreshRate("143.8")).toBe(144);
  });
});
