import { afterEach, expect, it, vi } from "vitest";
import { readBinary, stats, writeBinary } from "@platform/neutralino";
import { exec2 } from "@runtime/command-runner";
import { readGachaArchive } from "../../src/pull-analysis/local";

vi.mock("@platform/neutralino", () => ({
  readBinary: vi.fn(),
  writeBinary: vi.fn(),
  stats: vi.fn(),
  removeFileIfExists: vi.fn(async () => undefined),
  resolve: (path: string) => path,
}));
vi.mock("@runtime/command-runner", () => ({ exec2: vi.fn() }));
vi.mock("../../src/pull-analysis/local", () => ({
  readGachaArchive: vi.fn(async () => ({})),
}));

vi.mock("../../src/pull-analysis/hk4e-catalog", () => ({
  hk4eIconFile: (icon: string) => icon,
  hk4eWikiPortraitUrl: (file: string) => "https://wiki.example.test/" + file,
  initialCatalog: {
    items: [
      { id: "1", icon: "UI_AvatarIcon_Valid.png" },
      { id: "2", icon: "UI_AvatarIcon_Damaged.png" },
      { id: "3", icon: "UI_EquipIcon_Missing.png" },
      { id: "4", icon: "UI_EquipIcon_Missing.png" },
    ],
  },
}));

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
const success = { pid: 1, exitCode: 0, stdErr: "", stdOut: "" };

function localCache(files = new Map<string, ArrayBuffer>()) {
  vi.mocked(readBinary).mockImplementation(async path => {
    const data = files.get(path);
    if (!data) throw new Error("Missing");
    return data;
  });
  vi.mocked(stats).mockImplementation(
    async path =>
      ({
        size: files.get(path)?.byteLength ?? 0,
      } as Awaited<ReturnType<typeof stats>>)
  );
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
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:portrait");
  return { files, moveFile };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

it("uses the Wiki image for a 404 and caches it beside regular images", async () => {
  const { files, moveFile } = localCache(
    new Map([
      [root + "UI_AvatarIcon_Valid.png", png],
      [root + "UI_AvatarIcon_Damaged.png", new ArrayBuffer(10)],
    ])
  );
  const fetch = vi.fn(async (url: URL, _options: RequestInit) =>
    url.pathname.endsWith("Damaged.png")
      ? new Response(null, { status: 404 })
      : new Response(png)
  );
  vi.stubGlobal("fetch", fetch);
  vi.mocked(exec2).mockImplementation(async parts => {
    const args = parts.map(String);
    files.set(args[args.indexOf("--output") + 1], png);
    return success;
  });
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
  expect(exec2).toHaveBeenCalledOnce();
  expect(vi.mocked(exec2).mock.calls[0][0]).toContain(
    "https://wiki.example.test/UI_AvatarIcon_Damaged.png"
  );
  expect(moveFile).toHaveBeenCalledTimes(2);
  await expect(
    readCachedHk4ePortrait("UI_AvatarIcon_Damaged.png")
  ).resolves.toBe("blob:portrait");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("starts archived items first and reserves capacity for the open report", async () => {
  localCache();
  vi.mocked(readGachaArchive).mockResolvedValueOnce({
    hk4e: [
      {
        uid: "100000001",
        timezone: 8,
        list: [
          {
            id: "1",
            gacha_type: "301",
            item_id: "3",
            time: "2026-11-25 00:00:00",
          },
        ],
      },
    ],
  });
  const pending: Array<() => void> = [];
  const requests: string[] = [];
  let ready = () => {};
  const backgroundStarted = new Promise<void>(done => {
    ready = done;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: URL) => {
      const file = url.pathname.split("/").pop() ?? "";
      requests.push(file);
      if (requests.length === 2) ready();
      if (file === "UI_AvatarIcon_Damaged.png")
        return Promise.resolve(new Response(png));
      return new Promise<Response>(done => {
        pending.push(() => done(new Response(png)));
      });
    })
  );
  const { maintainHk4ePortraits, readCachedHk4ePortrait } = await import(
    "../../src/pull-analysis/hk4e-portrait-cache"
  );

  const scan = maintainHk4ePortraits();
  await backgroundStarted;
  expect(requests).toEqual([
    "UI_EquipIcon_Missing.png",
    "UI_AvatarIcon_Valid.png",
  ]);
  const report = readCachedHk4ePortrait("UI_AvatarIcon_Damaged.png");
  try {
    await expect(report).resolves.toBe("blob:portrait");
    expect(requests[2]).toBe("UI_AvatarIcon_Damaged.png");
  } finally {
    pending.forEach(finish => finish());
  }
  await scan;
  expect(requests).toHaveLength(3);
});
