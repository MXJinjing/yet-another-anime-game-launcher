import { describe, expect, it } from "vitest";
import { speedLimitConfigToBps } from "@download/config";

describe("speedLimitConfigToBps", () => {
  it("converts K/M/G units to bytes per second", () => {
    expect(speedLimitConfigToBps(true, 1, "K")).toBe(1024);
    expect(speedLimitConfigToBps(true, 2, "M")).toBe(2 * 1024 * 1024);
    expect(speedLimitConfigToBps(true, 3, "G")).toBe(3 * 1024 * 1024 * 1024);
  });

  it("returns 0 when disabled", () => {
    expect(speedLimitConfigToBps(false, 1024, "K")).toBe(0);
    expect(speedLimitConfigToBps(false, 1, "M")).toBe(0);
  });

  it("returns 0 for zero or negative values", () => {
    expect(speedLimitConfigToBps(true, 0, "K")).toBe(0);
    expect(speedLimitConfigToBps(true, -5, "M")).toBe(0);
  });

  it("returns 0 for non-finite values", () => {
    expect(speedLimitConfigToBps(true, Number.NaN, "K")).toBe(0);
    expect(speedLimitConfigToBps(true, Number.POSITIVE_INFINITY, "K")).toBe(0);
  });

  it("returns 0 for unknown units", () => {
    expect(speedLimitConfigToBps(true, 1, "T")).toBe(0);
  });
});
