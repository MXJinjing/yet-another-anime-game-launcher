import { describe, expect, it } from "vitest";
import {
  METALFX_FACTOR_DEFAULT,
  normalizeMetalFxFactor,
} from "@src/config/metalfx-factor";

describe("MetalFX upscale factor", () => {
  it("keeps values inside the DXMT window", () => {
    expect(normalizeMetalFxFactor(1)).toBe(1);
    expect(normalizeMetalFxFactor(1.35)).toBe(1.35);
    expect(normalizeMetalFxFactor(2)).toBe(2);
  });

  it("falls back to the default for out-of-range values", () => {
    expect(normalizeMetalFxFactor(0.5)).toBe(METALFX_FACTOR_DEFAULT);
    expect(normalizeMetalFxFactor(2.4)).toBe(METALFX_FACTOR_DEFAULT);
    expect(normalizeMetalFxFactor(0)).toBe(METALFX_FACTOR_DEFAULT);
  });

  it("falls back to the default for non-finite values", () => {
    expect(normalizeMetalFxFactor(Number.NaN)).toBe(METALFX_FACTOR_DEFAULT);
    expect(normalizeMetalFxFactor(Number.POSITIVE_INFINITY)).toBe(
      METALFX_FACTOR_DEFAULT
    );
  });
});
