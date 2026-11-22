import { describe, expect, it } from "vitest";
import { isMetalFxRuntimeUnavailable } from "@config/metalfx-runtime";

describe("MetalFX runtime availability", () => {
  it("keeps DXMT clients enabled on a DXMT runtime", () => {
    expect(isMetalFxRuntimeUnavailable(true, "dxmt")).toBe(false);
  });

  it("disables DXMT clients on another render backend", () => {
    expect(isMetalFxRuntimeUnavailable(true, "d3dmetal")).toBe(true);
  });

  it("keeps DXMT clients enabled while the backend is unknown", () => {
    expect(isMetalFxRuntimeUnavailable(true, undefined)).toBe(false);
  });

  it("never disables clients that implement MetalFX themselves", () => {
    expect(isMetalFxRuntimeUnavailable(false, "d3dmetal")).toBe(false);
  });
});
