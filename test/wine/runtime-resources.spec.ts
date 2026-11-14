import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@runtime", () => ({
  exec: vi.fn(),
  forceMove: vi.fn(),
  mkdirp: vi.fn(),
  rmrf_dangerously: vi.fn(),
  formatDownloadSpeed: (n: number) => `${n} B/s`,
  humanFileSize: (n: number) => `${n} B`,
}));
vi.mock("@runtime/storage", () => ({
  getKeyOrDefault: vi.fn(),
  setKey: vi.fn(),
}));
vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: vi.fn(),
  readBinary: vi.fn(),
  removeFile: vi.fn(),
  removeFileIfExists: vi.fn(),
  writeBinary: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@logging/logger", () => ({ warn: vi.fn() }));
vi.mock("@platform/neutralino/path", () => ({ resolve: (p: string) => p }));
import { exec, forceMove } from "@runtime";
import { warn } from "@logging/logger";
import {
  fileOrDirExists,
  readBinary,
  removeFile,
  removeFileIfExists,
  writeBinary,
  writeFile,
} from "@platform/neutralino";
import { getKeyOrDefault, setKey } from "@runtime/storage";
import {
  checkAndDownloadDXMT,
  checkAndDownloadDXVK,
  checkAndDownloadJadeite,
  checkAndDownloadMoltenVK,
  checkAndDownloadReshade,
  isDXMTInstalled,
} from "@wine/runtime-resources";
const download = vi.fn();
const aria2 = { doStreamingDownload: download } as never;
async function collect(program: AsyncGenerator<unknown>) {
  const commands: unknown[] = [];
  for await (const command of program) commands.push(command);
  return commands;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getKeyOrDefault).mockResolvedValue("0.0.0");
  vi.mocked(fileOrDirExists).mockResolvedValue(false);
  vi.mocked(exec)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(readBinary).mockResolvedValue(
    new Uint8Array([0, 80, 75, 3, 4, 1]).buffer
  );
  vi.mocked(setKey).mockReset();
  vi.mocked(removeFileIfExists).mockReset();
  download.mockReset().mockImplementation(async function* () {
    yield { completedLength: 50n, totalLength: 100n, downloadSpeed: 10n };
  });
});

describe("Wine runtime resource installation", () => {
  it("checks the installed DXMT version", async () => {
    await expect(isDXMTInstalled()).resolves.toBe(false);
    vi.mocked(getKeyOrDefault).mockResolvedValue("0.80.0");
    await expect(isDXMTInstalled()).resolves.toBe(true);
  });
  it("requires the MoltenVK file as well as the version marker", async () => {
    vi.mocked(getKeyOrDefault).mockResolvedValue("1.2.2");
    vi.mocked(fileOrDirExists).mockResolvedValue(true);
    await expect(collect(checkAndDownloadMoltenVK(aria2))).resolves.toEqual([]);
    vi.mocked(fileOrDirExists).mockResolvedValue(false);
    expect(await collect(checkAndDownloadMoltenVK(aria2))).toContainEqual([
      "setProgress",
      50,
    ]);
    expect(setKey).toHaveBeenCalledWith("installed_moltenvk_version", "1.2.2");
  });
  it("downloads all DXVK libraries before recording its installed version", async () => {
    const commands = await collect(checkAndDownloadDXVK(aria2));
    expect(download).toHaveBeenCalledTimes(4);
    expect(commands).toContainEqual(["setProgress", 50]);
    expect(setKey).toHaveBeenCalledWith(
      "installed_dxvk_version",
      expect.any(String)
    );
  });
  it("extracts Jadeite, records the version, then removes the installer ZIP", async () => {
    expect(await collect(checkAndDownloadJadeite(aria2))).toContainEqual([
      "setProgress",
      50,
    ]);
    expect(exec).toHaveBeenCalledWith([
      "/usr/bin/unzip",
      "-oq",
      "./jadeite/archive.zip",
      "-d",
      "./jadeite",
    ]);
    expect(setKey).toHaveBeenCalledWith("installed_jadeite_version", "4.1.0");
    expect(removeFileIfExists).toHaveBeenCalledWith("./jadeite/archive.zip");
    expect(vi.mocked(exec).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(setKey).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(setKey).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(removeFileIfExists).mock.invocationCallOrder[0]
    );
  });
  it("skips post-install cleanup if Jadeite extraction fails", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new Error("cannot unpack"));
    await expect(collect(checkAndDownloadJadeite(aria2))).rejects.toThrow(
      "cannot unpack"
    );
    expect(setKey).not.toHaveBeenCalled();
    expect(removeFileIfExists).not.toHaveBeenCalled();
  });
  it("waits for a shared Jadeite install before checking for a leftover ZIP", async () => {
    const first = checkAndDownloadJadeite(aria2);
    await first.next();
    const second = collect(checkAndDownloadJadeite(aria2));
    vi.mocked(setKey).mockImplementation(async (_key, version) => {
      vi.mocked(getKeyOrDefault).mockResolvedValue(version ?? "0.0.0");
    });

    await collect(first);
    await expect(second).resolves.toEqual([]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(removeFileIfExists).toHaveBeenCalledTimes(2);
  });
  it("logs cleanup failures without blocking use of installed Jadeite", async () => {
    vi.mocked(getKeyOrDefault).mockResolvedValue("4.1.0");
    vi.mocked(removeFileIfExists).mockRejectedValueOnce(new Error("denied"));
    vi.mocked(warn).mockResolvedValue(undefined);
    await expect(collect(checkAndDownloadJadeite(aria2))).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("denied"));
    expect(download).not.toHaveBeenCalled();
  });
  it("extracts DXMT and passes the per-game download key", async () => {
    await collect(checkAndDownloadDXMT(aria2, "game"));
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ downloadKey: "game" })
    );
    expect(exec).toHaveBeenCalledWith(expect.arrayContaining(["tar", "-xvf"]));
    expect(removeFile).toHaveBeenCalledWith("./dxmt/dxmt-v0.80-builtin.tar.gz");
    expect(setKey).toHaveBeenCalledWith("installed_dxmt_version", "0.80.0");
  });
  it("does not mark DXMT installed after extraction fails", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new Error("corrupt archive"));
    await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toThrow(
      "corrupt archive"
    );
    expect(setKey).not.toHaveBeenCalled();
  });
  it("unpacks ReShade's embedded zip and writes paths for the selected prefix", async () => {
    await collect(
      checkAndDownloadReshade(
        aria2,
        { toWinePath: (p: string) => `Z:${p}` } as never,
        "/game"
      )
    );
    expect(writeBinary).toHaveBeenCalledWith(
      "reshade/install.zip",
      new Uint8Array([80, 75, 3, 4, 1]).buffer
    );
    expect(forceMove).toHaveBeenCalledWith(
      "reshade/ReShade64.dll",
      "reshade/dxgi.dll"
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/game/ReShade.ini",
      expect.stringContaining("EffectSearchPaths=Z:")
    );
    expect(setKey).toHaveBeenCalledWith("installed_reshade", "5.8.0");
    expect(removeFileIfExists).toHaveBeenCalledWith("reshade/install.zip");
    expect(removeFileIfExists).toHaveBeenCalledWith("reshade/install.exe");
    expect(removeFileIfExists).toHaveBeenCalledTimes(2);
  });
  it("removes leftover ReShade installers from a previous successful install", async () => {
    vi.mocked(getKeyOrDefault).mockResolvedValue("5.8.0");
    await collect(checkAndDownloadReshade(aria2, {} as never, "/game"));
    expect(removeFileIfExists).toHaveBeenCalledWith("reshade/install.zip");
    expect(removeFileIfExists).toHaveBeenCalledWith("reshade/install.exe");
    expect(download).not.toHaveBeenCalled();
  });
  it("discards a ReShade installer without a ZIP payload so retry can download it", async () => {
    vi.mocked(readBinary).mockResolvedValue(new ArrayBuffer(0));
    await expect(
      collect(checkAndDownloadReshade(aria2, {} as never, "/game"))
    ).rejects.toThrow("ReShade installer has no ZIP payload");
    expect(writeBinary).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
    expect(removeFileIfExists).toHaveBeenCalledWith("reshade/install.exe");
    expect(removeFileIfExists).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["1.10.4-alpha.20230402", checkAndDownloadDXVK],
    ["4.1.0", checkAndDownloadJadeite],
    ["0.80.0", checkAndDownloadDXMT],
  ] as const)("skips an up-to-date runtime %s", async (version, install) => {
    vi.mocked(getKeyOrDefault).mockResolvedValue(version);
    await expect(collect(install(aria2))).resolves.toEqual([]);
    expect(download).not.toHaveBeenCalled();
  });
});
