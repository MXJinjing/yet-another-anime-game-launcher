import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@platform/neutralino", () => ({ stats: vi.fn() }));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));
vi.mock("@runtime/storage", () => ({ getKey: vi.fn(), setKey: vi.fn() }));

import { stats } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { getKey, setKey } from "@runtime/storage";
import {
  CUSTOM_WINE_BINARY_KEY,
  findConfiguredWine,
  getCustomWineId,
  getRegisteredSystemWineRoot,
  readCustomWineEntries,
  registerSystemWineRoot,
  writeCustomWineEntries,
} from "@wine/system-wine";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(stats).mockResolvedValue({} as never);
  vi.mocked(exec).mockResolvedValue({ stdOut: "/Wine/bin/wine64\n" } as never);
});

describe("custom Wine discovery", () => {
  it.each(["", "not json", "null", "{}", "42"])(
    "ignores invalid persisted entries: %s",
    async value => {
      vi.mocked(getKey).mockResolvedValue(value);
      await expect(readCustomWineEntries()).resolves.toEqual([]);
    }
  );

  it("recovers from unavailable storage", async () => {
    vi.mocked(getKey).mockRejectedValue(new Error("unavailable"));
    await expect(readCustomWineEntries()).resolves.toEqual([]);
  });

  it("keeps valid entries and the first entry for each binary", async () => {
    vi.mocked(getKey).mockResolvedValue(
      JSON.stringify([
        null,
        "wrong",
        { name: "broken", binary: 5 },
        { name: "A", binary: "/one/wine64" },
        { name: "duplicate", binary: "/one/wine64" },
        { name: "B", binary: "/two/wine64" },
      ])
    );
    await expect(readCustomWineEntries()).resolves.toEqual([
      { name: "A", binary: "/one/wine64" },
      { name: "B", binary: "/two/wine64" },
    ]);
  });

  it("persists names with spaces and Unicode without changing paths", async () => {
    const entries = [{ name: "本地 Wine", binary: "/My Wine/bin/wine64" }];
    await writeCustomWineEntries(entries);
    expect(setKey).toHaveBeenCalledWith(
      CUSTOM_WINE_BINARY_KEY,
      JSON.stringify(entries)
    );
  });

  it("resolves symlinks and requires both wine64 and wineserver", async () => {
    await expect(findConfiguredWine("/alias/wine64")).resolves.toEqual({
      binary: "/Wine/bin/wine64",
      root: "/Wine",
    });
    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining(["/alias/wine64"])
    );
    expect(vi.mocked(stats).mock.calls).toEqual([
      ["/Wine/bin/wine64"],
      ["/Wine/bin/wineserver"],
    ]);
  });

  it.each(["", "  "])("ignores an empty path", async path => {
    await expect(findConfiguredWine(path)).resolves.toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });

  it("does not offer an incomplete Wine installation", async () => {
    vi.mocked(stats).mockRejectedValueOnce(new Error("missing"));
    await expect(findConfiguredWine("/alias/wine64")).resolves.toBeUndefined();
    vi.mocked(exec).mockRejectedValueOnce(new Error("permission denied"));
    await expect(findConfiguredWine("/alias/wine64")).resolves.toBeUndefined();
  });

  it("generates stable identifiers per installation root", () => {
    expect(getCustomWineId("/Wine A")).toBe(getCustomWineId("/Wine A"));
    expect(getCustomWineId("/Wine A")).not.toBe(getCustomWineId("/Wine B"));
    expect(getCustomWineId("/Wine A")).toMatch(/^custom-wine-[a-z0-9]+$/);
  });

  it("remembers detected system roots for later activation", () => {
    expect(registerSystemWineRoot("test-discovery", "/Wine")).toBe("/Wine");
    expect(getRegisteredSystemWineRoot("test-discovery")).toBe("/Wine");
    expect(getRegisteredSystemWineRoot("unregistered")).toBeUndefined();
  });
});
