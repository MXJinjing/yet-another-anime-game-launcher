import { describe, expect, it } from "vitest";
import { resolvePredownloadVisibility } from "@src/launcher/model/predownload-visibility";

describe("predownload visibility", () => {
  it("hides the cached version once the update installs it", () => {
    expect(
      resolvePredownloadVisibility("2.0.0", false, true, "2.0.0", "1.0.0")
    ).toBe("completed");
    expect(
      resolvePredownloadVisibility("2.0.0", false, true, "2.0.0", "2.0.0")
    ).toBe("hidden");
  });

  it("offers the next predownload after the previous cache was consumed", () => {
    expect(
      resolvePredownloadVisibility("2.0.0", false, true, "3.0.0", "2.0.0")
    ).toBe("available");
    expect(
      resolvePredownloadVisibility("", false, true, "3.0.0", "2.0.0")
    ).toBe("available");
  });

  it("restores the download entry after deleting the cache", () => {
    expect(
      resolvePredownloadVisibility("", false, true, "2.0.0", "1.0.0")
    ).toBe("available");
  });

  it("hides predownload when the game or target is unavailable", () => {
    expect(resolvePredownloadVisibility("", true, true, "2.0.0", "0.0.0")).toBe(
      "hidden"
    );
    expect(
      resolvePredownloadVisibility("2.0.0", true, false, "2.0.0", "1.0.0")
    ).toBe("hidden");
    expect(resolvePredownloadVisibility("", true, true, "", "1.0.0")).toBe(
      "hidden"
    );
    expect(
      resolvePredownloadVisibility(undefined, false, true, "2.0.0", "1.0.0")
    ).toBe("hidden");
  });
});
