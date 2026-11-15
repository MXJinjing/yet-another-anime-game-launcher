import type { ConfigEntry } from "./config-entry";
import type { ConfigStore } from "./config-store";
import { configEntries } from "./shared-entries";

declare module "./config-def" {
  interface Config {
    dxmtRefreshRate: DetectedDxmtRefreshRate;
  }
}

const DEFAULT_REFRESH_RATE = 60;

export type DxmtRefreshRate = {
  enabled: boolean;
  rate: number;
};

type DetectedDxmtRefreshRate = DxmtRefreshRate & { displayRate: number };

export function parseRefreshRate(value: string): number | undefined {
  const rate = Number(value);
  if (value.trim() && Number.isFinite(rate) && rate >= 0) {
    return Math.round(rate);
  }
}

export const dxmtRefreshRateEntry: ConfigEntry<DxmtRefreshRate> = {
  key: "config_dxmt_refresh_rate",
  parse(value) {
    const { enabled, rate } = JSON.parse(value);
    if (
      typeof enabled !== "boolean" ||
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate < 0
    ) {
      throw new Error("Invalid DXMT refresh rate configuration");
    }
    return { enabled, rate: Math.round(rate) };
  },
  serialize: value => JSON.stringify(value),
};

export async function detectDisplayRefreshRate(
  getDisplays: () => Promise<readonly { refreshRate: number }[]> = () =>
    Neutralino.computer.getDisplays()
): Promise<number> {
  try {
    const display = (await getDisplays()).find(
      ({ refreshRate }) => Number.isFinite(refreshRate) && refreshRate > 0
    );
    if (display) return Math.max(1, Math.round(display.refreshRate));
  } catch {
    // Some display drivers do not report a refresh rate.
  }
  return DEFAULT_REFRESH_RATE;
}

export async function loadDxmtRefreshRate(
  store: ConfigStore,
  detect = detectDisplayRefreshRate
): Promise<DetectedDxmtRefreshRate> {
  const displayRate = await detect();
  const saved = await store.read(dxmtRefreshRateEntry);
  if (saved) return { ...saved, displayRate };

  // The old 0 meant automatic detection, whereas the new custom 0 omits
  // the DXMT override. Positive presets become monitor Hz.
  const legacyRate = parseRefreshRate(
    (await store.read(configEntries.preferredMaxFps)) ?? ""
  );
  if (legacyRate) return { enabled: true, rate: legacyRate, displayRate };
  return { enabled: false, rate: displayRate, displayRate };
}

function getDefaultPreferredMaxFrameRate(refreshRate: number): number {
  const rate =
    Number.isFinite(refreshRate) && refreshRate > 0
      ? Math.round(refreshRate)
      : DEFAULT_REFRESH_RATE;
  return Math.ceil(rate / Math.max(1, Math.floor(rate / DEFAULT_REFRESH_RATE)));
}

export function dxmtFrameRateOverride(
  setting: DetectedDxmtRefreshRate
): string {
  const fps = setting.enabled
    ? setting.rate === 0
      ? 0
      : getDefaultPreferredMaxFrameRate(setting.rate)
    : setting.displayRate;
  return fps > 0 ? `d3d11.preferredMaxFrameRate=${fps};` : "";
}
