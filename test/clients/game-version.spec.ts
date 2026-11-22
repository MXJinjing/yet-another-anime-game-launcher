import { describe, expect, it } from "vitest";
import {
  isNewerGameVersion,
  readGameVersion,
  readInstalledGameVersion,
  requireGameVersion,
} from "../../src/clients/game-version";
import { GameVersionUnreadableError } from "../../src/clients/launch-errors";

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

  it("reports a readable installed version", async () => {
    await expect(
      readInstalledGameVersion(async () => "1.2.3")
    ).resolves.toEqual({ status: "version", version: "1.2.3" });
  });

  it("reports an unusable version value as unavailable", async () => {
    await expect(
      readInstalledGameVersion(async () => "corrupt")
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("reports a typed read failure as unavailable", async () => {
    await expect(
      readInstalledGameVersion(async () => {
        throw new GameVersionUnreadableError("pattern not found");
      })
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("keeps other read failures as missing files", async () => {
    const error = new Error("ENOENT");
    await expect(
      readInstalledGameVersion(async () => {
        throw error;
      })
    ).resolves.toEqual({ status: "missing", error });
  });
});
