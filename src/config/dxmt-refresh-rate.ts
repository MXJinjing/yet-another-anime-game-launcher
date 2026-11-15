import type { ConfigEntry } from "./config-entry";
import type { ConfigStore } from "./config-store";
import { configEntries } from "./shared-entries";

declare module "./config-def" {
  interface Config {
    dxmtRefreshRate: DxmtRefreshRate;
  }
}

const DEFAULT_REFRESH_RATE = 60;

export type DxmtRefreshRate = {
  enabled: boolean;
  rate: number;
};

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
): Promise<DxmtRefreshRate> {
  const saved = await store.read(dxmtRefreshRateEntry);
  if (saved) return saved;

  // The old 0 meant automatic detection, whereas the new custom 0 omits
  // the DXMT override. Positive presets become monitor Hz.
  const legacyRate = parseRefreshRate(
    (await store.read(configEntries.preferredMaxFps)) ?? ""
  );
  if (legacyRate) return { enabled: true, rate: legacyRate };
  return { enabled: false, rate: await detect() };
}

function getDefaultPreferredMaxFrameRate(refreshRate: number): number {
  const rate =
    Number.isFinite(refreshRate) && refreshRate > 0
      ? Math.round(refreshRate)
      : DEFAULT_REFRESH_RATE;
  return Math.ceil(rate / Math.max(1, Math.floor(rate / DEFAULT_REFRESH_RATE)));
}

export function dxmtFrameRateOverride(
  setting: DxmtRefreshRate | undefined,
  defaultFrameRate = DEFAULT_REFRESH_RATE
): string {
  const fps = setting?.enabled
    ? setting.rate <= 0
      ? 0
      : getDefaultPreferredMaxFrameRate(setting.rate)
    : defaultFrameRate;
  return fps > 0 ? `d3d11.preferredMaxFrameRate=${fps};` : "";
}
