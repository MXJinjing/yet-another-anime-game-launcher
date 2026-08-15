export const DOWNLOAD_SPEED_LIMIT_ENABLED_KEY =
  "config_downloadSpeedLimitEnabled";
export const DOWNLOAD_SPEED_LIMIT_VALUE_KEY = "config_downloadSpeedLimitValue";
export const DOWNLOAD_SPEED_LIMIT_UNIT_KEY = "config_downloadSpeedLimitUnit";
export const MAX_CONCURRENT_DOWNLOADS_KEY = "config_maxConcurrentDownloads";

const UNIT_MULTIPLIERS: Record<string, number> = {
  K: 1024,
  M: 1024 * 1024,
  G: 1024 * 1024 * 1024,
};

export function speedLimitConfigToBps(
  enabled: boolean,
  value: number,
  unit: string
): number {
  if (!enabled || value <= 0 || !Number.isFinite(value)) return 0;
  return value * (UNIT_MULTIPLIERS[unit] ?? 0);
}
