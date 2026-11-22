import { describe, expect, it } from "vitest";
import {
  listInstalledWineDistributions,
  planWineRecovery,
} from "@src/wine/recovery";
import type { WineDistribution } from "@src/wine";

const distro = (id: string): WineDistribution =>
  ({
    id,
    displayName: id,
    remoteUrl: "",
    attributes: {},
  } as WineDistribution);

describe("listInstalledWineDistributions", () => {
  it("keeps only distributions whose files are present", async () => {
    const installed = await listInstalledWineDistributions(
      async () => [distro("a"), distro("b"), distro("c")],
      async id => id !== "b"
    );

    expect(installed.map(entry => entry.id)).toEqual(["a", "c"]);
  });

  it("treats a failed probe as not installed", async () => {
    const installed = await listInstalledWineDistributions(
      async () => [distro("a"), distro("b")],
      async id => {
        if (id === "b") throw new Error("stat failed");
        return true;
      }
    );

    expect(installed.map(entry => entry.id)).toEqual(["a"]);
  });

  it("returns an empty list when the distribution list cannot be read", async () => {
    const installed = await listInstalledWineDistributions(
      async () => {
        throw new Error("no wine dir");
      },
      async () => true
    );

    expect(installed).toEqual([]);
  });
});

describe("planWineRecovery", () => {
  it("does nothing while the selected Wine is ready", () => {
    expect(
      planWineRecovery({
        wineReady: true,
        currentDistroId: "a",
        installed: [distro("b")],
      })
    ).toEqual({ kind: "none" });
  });

  it("offers the other installed distributions when the selected one vanished", () => {
    const plan = planWineRecovery({
      wineReady: false,
      currentDistroId: "system",
      installed: [distro("builtin-1"), distro("builtin-2")],
    });

    expect(plan).toEqual({
      kind: "choose",
      missing: "system",
      installed: [distro("builtin-1"), distro("builtin-2")],
    });
  });

  it("keeps the ordinary flow when the selected Wine is still on disk", () => {
    // A pending update reports wineReady: false while the files are present;
    // that is not a vanished Wine and must not prompt.
    expect(
      planWineRecovery({
        wineReady: false,
        currentDistroId: "builtin-1",
        installed: [distro("builtin-1")],
      })
    ).toEqual({ kind: "none" });
  });

  it("keeps the ordinary flow when nothing else is installed", () => {
    expect(
      planWineRecovery({
        wineReady: false,
        currentDistroId: "system",
        installed: [],
      })
    ).toEqual({ kind: "none" });
  });
});
