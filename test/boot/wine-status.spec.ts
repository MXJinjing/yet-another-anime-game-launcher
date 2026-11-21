import { describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({ log: vi.fn() }));

import { RECOMMENDED_WINE_DISTRO_ID, type WineStatus } from "@wine";
import { resolveWineStatus } from "@src/boot/wine-status";

describe("wine status boot fallback", () => {
  it("returns the checked status when the environment check succeeds", async () => {
    const status: WineStatus = {
      wineReady: true,
      wineDistribution: {
        id: "installed",
        displayName: "Installed",
        remoteUrl: "https://example.invalid/wine",
        attributes: {},
      },
    };
    const check = vi.fn(async () => status);
    await expect(resolveWineStatus("tag", { check })).resolves.toBe(status);
    expect(check).toHaveBeenCalledWith("tag");
  });

  it("falls back to the recommended Wine instead of aborting boot", async () => {
    const status = await resolveWineStatus("missing-tag", {
      check: vi.fn().mockRejectedValue(new Error("unknown default wine")),
    });
    expect(status.wineReady).toBe(false);
    expect(status.wineDistribution.id).toBe(RECOMMENDED_WINE_DISTRO_ID);
  });
});
