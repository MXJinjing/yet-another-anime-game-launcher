// DXMT documents d3d11.metalSpatialUpscaleFactor as a 1.0-2.0 factor; values
// outside that window are not honored by the swapchain upscaler.
export const METALFX_FACTOR_MIN = 1.0;
export const METALFX_FACTOR_MAX = 2.0;
export const METALFX_FACTOR_DEFAULT = 2.0;
export const METALFX_FACTOR_STEP = 0.05;

/**
 * Keeps a stored factor inside the range DXMT honors.
 *
 * A missing or out-of-range value falls back to the default instead of being
 * clamped to the nearest bound, so a corrupted preference never silently
 * changes the upscale strength the user picked.
 */
export function normalizeMetalFxFactor(value: number): number {
  if (
    !Number.isFinite(value) ||
    value < METALFX_FACTOR_MIN ||
    value > METALFX_FACTOR_MAX
  ) {
    return METALFX_FACTOR_DEFAULT;
  }
  return value;
}
