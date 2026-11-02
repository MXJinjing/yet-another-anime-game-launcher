import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@platform/neutralino", () => ({
  stats: vi.fn(),
  fileOrDirExists: vi.fn(),
  resolve: (p: string) => p,
}));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));
vi.mock("@runtime/storage", () => ({ getKey: vi.fn(), setKey: vi.fn() }));
vi.mock("@wine/wine", () => ({
  ensureActiveWineCompatLink: vi.fn(),
  getWineInstallDir: (id: string) => `/wines/${id}`,
  isWineDistroInstalled: vi.fn(),
}));
vi.mock("@wine/system-wine", () => ({
  GPTK_WINE_ID: "gptk3-system",
  readCustomWineEntries: vi.fn(),
  findConfiguredWine: vi.fn(),
  getCustomWineId: (root: string) => root,
  registerSystemWineRoot: (_id: string, root: string) => root,
}));
import { stats, fileOrDirExists } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { getKey, setKey } from "@runtime/storage";
import { ensureActiveWineCompatLink, isWineDistroInstalled } from "@wine/wine";
import { readCustomWineEntries, findConfiguredWine } from "@wine/system-wine";
import { checkWine, getWineDistributions } from "@wine/distro";

const defaultId = "11.0-1-crossover-signed-experimental";
let values: Record<string, string>;
beforeEach(() => {
  vi.resetAllMocks();
  values = {};
  vi.mocked(getKey).mockImplementation(async key => {
    if (!(key in values)) throw new Error("missing");
    return values[key];
  });
  vi.mocked(stats).mockRejectedValue(new Error("not installed"));
  vi.mocked(fileOrDirExists).mockResolvedValue(false);
  vi.mocked(readCustomWineEntries).mockResolvedValue([]);
  vi.mocked(isWineDistroInstalled).mockResolvedValue(false);
});

describe("Wine distribution discovery and activation", () => {
  it("detects a system installation and its actual version", async () => {
    vi.mocked(stats).mockResolvedValue({} as never);
    vi.mocked(exec).mockResolvedValue({ stdOut: "3.1\n" } as never);
    expect((await getWineDistributions())[0]).toMatchObject({
      id: "gptk3-system",
      displayName: "Game Porting Toolkit 3.1",
      remoteUrl: "",
    });
  });
  it("ignores a system installation without a version", async () => {
    vi.mocked(stats).mockResolvedValue({} as never);
    vi.mocked(exec).mockResolvedValue({ stdOut: " \n" } as never);
    expect(
      (await getWineDistributions()).some(d => d.id === "gptk3-system")
    ).toBe(false);
  });
  it("offers each valid custom root only once", async () => {
    vi.mocked(readCustomWineEntries).mockResolvedValue([
      { name: "A", binary: "/a" },
      { name: "Alias", binary: "/alias" },
      { name: "Gone", binary: "/gone" },
    ]);
    vi.mocked(findConfiguredWine).mockImplementation(async binary =>
      binary === "/gone" ? undefined : { root: "/custom", binary }
    );
    const custom = (await getWineDistributions()).filter(d => d.customWine);
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({
      displayName: "A",
      systemWineRoot: "/custom",
    });
  });
  it("fails clearly for an unknown channel default", async () => {
    await expect(checkWine("unknown")).rejects.toThrow(
      "can not find default wine version"
    );
  });
  it("returns the default when state is missing or not ready", async () => {
    await expect(checkWine(defaultId)).resolves.toMatchObject({
      wineReady: false,
      wineDistribution: { id: defaultId },
    });
    values.wine_state = "installing";
    await expect(checkWine(defaultId)).resolves.toMatchObject({
      wineReady: false,
    });
  });
  it.each([defaultId, "removed-version"])(
    "resumes pending selection %s with a safe default",
    async tag => {
      values = { wine_state: "update", wine_update_tag: tag };
      await expect(checkWine(defaultId)).resolves.toMatchObject({
        wineReady: false,
        wineDistribution: { id: defaultId },
      });
    }
  );
  it("activates only an installed persisted selection", async () => {
    values = { wine_state: "ready", wine_tag: defaultId };
    vi.mocked(isWineDistroInstalled).mockResolvedValue(true);
    await expect(checkWine(defaultId)).resolves.toMatchObject({
      wineReady: true,
    });
    expect(ensureActiveWineCompatLink).toHaveBeenCalledWith(defaultId);
    vi.mocked(isWineDistroInstalled).mockResolvedValue(false);
    await expect(checkWine(defaultId)).resolves.toMatchObject({
      wineReady: false,
    });
  });
  it("falls back from an unrecognized persisted selection", async () => {
    values = { wine_state: "ready", wine_tag: "removed-version" };
    await expect(checkWine(defaultId)).resolves.toMatchObject({
      wineReady: false,
      wineDistribution: { id: defaultId },
    });
  });
  it("recovers an installed default when its persisted tag is missing", async () => {
    values.wine_state = "ready";
    vi.mocked(isWineDistroInstalled).mockResolvedValue(true);
    await expect(checkWine(defaultId)).resolves.toMatchObject({
      wineReady: true,
    });
    expect(setKey).toHaveBeenCalledWith("wine_tag", defaultId);
  });
  it("moves a legacy directory but preserves a compatibility symlink", async () => {
    values = { wine_state: "ready", wine_tag: defaultId };
    vi.mocked(fileOrDirExists).mockResolvedValue(true);
    vi.mocked(exec)
      .mockRejectedValueOnce(new Error("not a symlink"))
      .mockResolvedValue({} as never);
    await checkWine(defaultId);
    expect(exec).toHaveBeenCalledWith(["mv", "./wine", `/wines/${defaultId}`]);
    vi.mocked(exec)
      .mockClear()
      .mockResolvedValue({} as never);
    await checkWine(defaultId);
    expect(exec).not.toHaveBeenCalledWith([
      "mv",
      "./wine",
      `/wines/${defaultId}`,
    ]);
  });
});
