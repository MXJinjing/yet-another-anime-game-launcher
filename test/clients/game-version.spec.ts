import { describe, expect, it } from "vitest";
import {
  isNewerGameVersion,
  readGameVersion,
  requireGameVersion,
} from "../../src/clients/game-version";

describe("game versions", () => {
  it.each([
    undefined,
    null,
    "",
    "corrupt",
    "1.2",
    "0.0.0",
    "v0.0.0",
    3,
    { version: "1.2.3" },
  ])("ignores unusable version %j without selecting a patch", value => {
    expect(readGameVersion(value)).toBeNull();
    expect(isNewerGameVersion("2.0.0", value)).toBe(false);
    expect(isNewerGameVersion(value, "1.0.0")).toBe(false);
    expect(() => requireGameVersion(value)).toThrow(
      "Invalid game version in online manifest"
    );
  });

  it("compares versions while preserving the ID used by patch manifests", () => {
    const version = "1.2.3+build.4";
    expect(requireGameVersion(version)).toBe(version);
    expect(isNewerGameVersion("1.2.4-beta.1", version)).toBe(true);
    expect(isNewerGameVersion("1.2.3", version)).toBe(false);
    expect(isNewerGameVersion("1.2.2", version)).toBe(false);
  });
});
