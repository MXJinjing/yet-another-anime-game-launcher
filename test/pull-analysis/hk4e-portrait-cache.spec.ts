import { afterEach, expect, it, vi } from "vitest";
import { readBinary, writeBinary } from "@platform/neutralino";

vi.mock("@platform/neutralino", () => ({
  readBinary: vi.fn(),
  writeBinary: vi.fn(),
  removeFileIfExists: vi.fn(async () => undefined),
  resolve: (path: string) => path,
}));

vi.mock("../../src/pull-analysis/hk4e-catalog", () => ({
  hk4eIconFile: (icon: string) => icon,
  initialCatalog: {
    items: [
      { icon: "UI_AvatarIcon_Valid.png" },
      { icon: "UI_AvatarIcon_Damaged.png" },
      { icon: "UI_EquipIcon_Missing.png" },
      { icon: "UI_EquipIcon_Missing.png" },
    ],
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps valid portraits and replaces damaged or missing files in the background", async () => {
  const root = "pull-analysis-hk4e-portraits/";
  const png = new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...new Uint8Array(32),
    0,
    0,
    0,
    0,
    73,
    69,
    78,
    68,
    174,
    66,
    96,
    130,
  ]).buffer;
  const files = new Map([
    [root + "UI_AvatarIcon_Valid.png", png],
    [root + "UI_AvatarIcon_Damaged.png", new ArrayBuffer(10)],
  ]);
  vi.mocked(readBinary).mockImplementation(async path => {
    const data = files.get(path);
    if (!data) throw new Error("Missing");
    return data;
  });
  vi.mocked(writeBinary).mockImplementation(async (path, data) => {
    files.set(path, data);
  });
  const moveFile = vi.fn(async (from: string, to: string) => {
    const data = files.get(from);
    if (!data) throw new Error("Missing staged file");
    files.set(to, data);
    files.delete(from);
  });
  vi.stubGlobal("Neutralino", {
    filesystem: { moveFile, createDirectory: vi.fn(async () => undefined) },
  });
  const fetch = vi.fn(
    async (_url: URL, _options: RequestInit) => new Response(png)
  );
  vi.stubGlobal("fetch", fetch);
  const createObjectURL = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:portrait");
  const { maintainHk4ePortraits, readCachedHk4ePortrait } = await import(
    "../../src/pull-analysis/hk4e-portrait-cache"
  );

  await Promise.all([maintainHk4ePortraits(), maintainHk4ePortraits()]);
  expect(
    fetch.mock.calls
      .map(([url]) => url.pathname.split("/").slice(-2).join("/"))
      .sort()
  ).toEqual([
    "character_icon/UI_AvatarIcon_Damaged.png",
    "equip/UI_EquipIcon_Missing.png",
  ]);
  expect(
    fetch.mock.calls.every(([, options]) => options.credentials === "omit")
  ).toBe(true);
  expect(moveFile).toHaveBeenCalledTimes(2);
  await expect(
    readCachedHk4ePortrait("UI_AvatarIcon_Damaged.png")
  ).resolves.toBe("blob:portrait");
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
});
