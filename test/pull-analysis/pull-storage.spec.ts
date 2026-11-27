import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFile, removeFileIfExists, writeFile } from "@platform/neutralino";
import {
  mergeLocalArchive,
  readGachaArchive,
  removeLocalPullAccount,
} from "../../src/pull-analysis/local";
import {
  exportUigf,
  parseUigf,
  type GachaArchive,
} from "../../src/pull-analysis/uigf";

vi.mock("@platform/neutralino", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  removeFileIfExists: vi.fn(),
  resolve: (file: string) => `/profile/${file}`,
}));

const archiveFile = "pull-analysis-uigf-v4.2.json";
const disk = new Map<string, string>();
const first = { uid: "100000001", timezone: 8, list: [] };
const second = { uid: "100000002", timezone: 8, list: [] };
const execCommand = vi.fn(async (command: string) => {
  const [from, to] = command
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map(part => part.replace(/^['"]|['"]$/g, "").replace(/^\/profile\//, ""));
  disk.set(to, disk.get(from)!);
  disk.delete(from);
  return { exitCode: 0 };
});

beforeEach(() => {
  disk.clear();
  execCommand.mockClear();
  vi.mocked(readFile).mockImplementation(async file => {
    const contents = disk.get(file);
    if (contents === undefined) throw new Error("Missing fixture file");
    return contents;
  });
  vi.mocked(writeFile).mockImplementation(async (file, contents) => {
    disk.set(file, contents);
  });
  vi.mocked(removeFileIfExists).mockImplementation(async file => {
    disk.delete(file);
  });
  vi.stubGlobal("Neutralino", {
    filesystem: {
      readDirectory: async () => [...disk.keys()].map(entry => ({ entry })),
    },
    os: { execCommand },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function store(archive: GachaArchive) {
  disk.set(archiveFile, exportUigf(archive, true));
}

it("clears precisely the requested game and UID while preserving queued imports", async () => {
  store({ hk4e: [first], nap: [first] });
  const importing = mergeLocalArchive({ hk4e: [second] });
  const removing = removeLocalPullAccount("hk4e", first.uid);
  await importing;
  expect(await removing).toEqual({
    hk4e: [{ ...second, updatedAt: expect.any(Number) }],
    nap: [first],
  });
  expect(await readGachaArchive()).toEqual(await removing);
});

it("keeps the last UID on a failed write and can reopen an empty local archive after retry", async () => {
  store({ hk4e: [first] });
  execCommand.mockResolvedValueOnce({ exitCode: 1 });
  await expect(removeLocalPullAccount("hk4e", first.uid)).rejects.toThrow();
  expect(await readGachaArchive()).toEqual({ hk4e: [first] });

  expect(await removeLocalPullAccount("hk4e", first.uid)).toEqual({});
  expect(await readGachaArchive()).toEqual({});
  expect(() => parseUigf(disk.get(archiveFile)!)).toThrow();
  expect(await mergeLocalArchive({ hk4e: [first] })).toEqual({
    hk4e: [{ ...first, updatedAt: expect.any(Number) }],
  });
});
