import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@platform/neutralino", () => ({
  readAllLines: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@logging/logger", () => ({ warn: vi.fn() }));

import { readAllLines, writeFile } from "@platform/neutralino";
import { warn } from "@logging/logger";
import { addCertsToWine } from "@wine/cert";

const wineInfPath = "/wines/test/share/wine/wine.inf";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(writeFile).mockResolvedValue(undefined);
});

describe("Wine certificate injection", () => {
  it("skips injection when the URL Associations section is missing", async () => {
    vi.mocked(readAllLines).mockResolvedValue([
      "[Version]",
      'Signature = "$Chicago$"',
    ]);

    await expect(addCertsToWine("/wines/test")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("URL Associations")
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("skips injection when the section has no terminating blank line", async () => {
    vi.mocked(readAllLines).mockResolvedValue([
      "[Version]",
      "; URL Associations",
      "HKCU,Software\\\\Test",
    ]);

    await expect(addCertsToWine("/wines/test")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("end of URL Associations")
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("injects certificates when the section and its end are present", async () => {
    vi.mocked(readAllLines).mockResolvedValue([
      "[Version]",
      "; URL Associations",
      "HKCU,Software\\\\Test",
      "",
      "[Next Section]",
    ]);

    await addCertsToWine("/wines/test");

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, contents] = vi.mocked(writeFile).mock.calls[0];
    expect(path).toBe(wineInfPath);
    expect(contents).toContain("[Next Section]");
    expect(contents).toContain("HKCU,Software\\\\Test");
    expect(vi.mocked(writeFile).mock.calls[0][1].length).toBeGreaterThan(
      "HKCU,Software\\\\Test".length
    );
  });
});
