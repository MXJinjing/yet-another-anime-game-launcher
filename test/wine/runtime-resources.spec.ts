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
  stats: vi.fn(),
  removeFileIfExists: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@logging/logger", () => ({ warn: vi.fn() }));
vi.mock("@platform/neutralino/path", () => ({ resolve: (p: string) => p }));
import { exec, forceMove, rmrf_dangerously } from "@runtime";
import { warn } from "@logging/logger";
import {
  fileOrDirExists,
  stats,
  removeFileIfExists,
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
const checksum =
  "fbc0721fb72ebafd2bad0dbdd3d13a52056fd10c4a9a699cee2689363823255b";
const validFile = { size: 1, isFile: true, isDirectory: false };
const build = "654f547ffab4e0c395ee368aad52bb4586b04576";
const archive = `dxmt-${build}.zip`;
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
  vi.mocked(stats).mockReset().mockResolvedValue(validFile);
  vi.mocked(exec)
    .mockReset()
    .mockResolvedValue({ stdOut: checksum } as never);
  vi.mocked(setKey).mockReset();
  vi.mocked(removeFileIfExists).mockReset();
  download.mockReset().mockImplementation(async function* () {
    yield { completedLength: 50n, totalLength: 100n, downloadSpeed: 10n };
  });
});

describe("Wine runtime resource installation", () => {
  it("checks the installed DXMT version", async () => {
    await expect(isDXMTInstalled()).resolves.toBe(false);
    for (const marker of ["0.80.0", "invalid"]) {
      vi.mocked(getKeyOrDefault).mockResolvedValue(marker);
      await expect(isDXMTInstalled()).resolves.toBe(false);
    }
    vi.mocked(getKeyOrDefault).mockResolvedValue("654f547");
    await expect(isDXMTInstalled()).resolves.toBe(true);
    for (const info of [
      { ...validFile, size: 0 },
      { ...validFile, isFile: false },
    ]) {
      vi.mocked(stats).mockResolvedValueOnce(info);
      await expect(isDXMTInstalled()).resolves.toBe(false);
    }
    vi.mocked(stats).mockRejectedValueOnce(new Error("Missing file"));
    await expect(isDXMTInstalled()).resolves.toBe(false);
  });
  it("requires the MoltenVK file as well as the version marker", async () => {
    vi.mocked(getKeyOrDefault).mockResolvedValue("1.2.2");
    await expect(collect(checkAndDownloadMoltenVK(aria2))).resolves.toEqual([]);
    vi.mocked(stats).mockRejectedValueOnce(new Error("Missing file"));
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
  it("discards a Jadeite ZIP that cannot be extracted without saving the version", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new Error("cannot unpack"));
    await expect(collect(checkAndDownloadJadeite(aria2))).rejects.toThrow(
      "cannot unpack"
    );
    expect(setKey).not.toHaveBeenCalled();
    expect(removeFileIfExists).toHaveBeenCalledWith("./jadeite/archive.zip");
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
    expect(download).toHaveBeenCalledWith({
      uri: `https://github.com/yaagl/anime-game-wine/releases/download/dxmt-654f547/${archive}`,
      absDst: `dxmt-staging/${archive}`,
      checksum: "sha-256=" + checksum,
      downloadKey: "game",
    });
    expect(exec).toHaveBeenCalledWith([
      "/usr/bin/unzip",
      "-oq",
      `dxmt-staging/${archive}`,
      `dxmt-${build}.tar.gz`,
      "-d",
      "./dxmt-staging",
    ]);
    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining(["/usr/bin/tar", "-xf"])
    );
    expect(forceMove).toHaveBeenCalledWith(
      `dxmt-staging/${build}/x86_64-unix/winemetal.so`,
      "dxmt-staging/runtime/winemetal.so"
    );
    expect(forceMove).toHaveBeenCalledWith(
      `dxmt-staging/${build}/x86_64-windows/nvngx.dll`,
      "dxmt-staging/runtime/nvngx.dll"
    );
    expect(setKey).toHaveBeenCalledWith("installed_dxmt_version", "654f547");
    expect(rmrf_dangerously).toHaveBeenLastCalledWith("./dxmt-staging");
  });
  it("preserves the old DXMT runtime after extraction or validation fails", async () => {
    vi.mocked(exec)
      .mockResolvedValueOnce({ stdOut: checksum } as never)
      .mockRejectedValueOnce(new Error("corrupt archive"));
    await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toThrow(
      "corrupt archive"
    );

    vi.mocked(stats).mockRejectedValueOnce(new Error("Missing file"));
    await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toThrow(
      "missing required"
    );
    expect(forceMove).not.toHaveBeenCalledWith("./dxmt", "./dxmt-backup");
    expect(setKey).not.toHaveBeenCalled();
    expect(rmrf_dangerously).toHaveBeenLastCalledWith("./dxmt-staging");
  });
  it("cleans up a corrupt DXMT download so a second attempt can succeed", async () => {
    vi.mocked(exec).mockResolvedValueOnce({ stdOut: "wrong-hash" } as never);
    await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toThrow(
      "checksum"
    );
    expect(setKey).not.toHaveBeenCalled();
    expect(rmrf_dangerously).toHaveBeenLastCalledWith("./dxmt-staging");
    await collect(checkAndDownloadDXMT(aria2));
    expect(download).toHaveBeenCalledTimes(2);
    expect(setKey).toHaveBeenCalledWith("installed_dxmt_version", "654f547");
  });
  it("recovers an interrupted DXMT swap and restores the backup if swapping fails", async () => {
    vi.mocked(fileOrDirExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    vi.mocked(forceMove).mockImplementationOnce(async () => ({} as never));
    vi.mocked(forceMove).mockImplementation(async source => {
      if (source === "dxmt-staging/runtime") throw new Error("Swap failed");
      return {} as never;
    });
    try {
      await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toThrow(
        "Swap failed"
      );
      expect(forceMove).toHaveBeenNthCalledWith(1, "./dxmt-backup", "./dxmt");
      expect(forceMove).toHaveBeenLastCalledWith("./dxmt-backup", "./dxmt");
      expect(setKey).not.toHaveBeenCalled();
    } finally {
      vi.mocked(forceMove).mockReset();
    }
  });
  it("downloads DXMT once across simultaneous game requests", async () => {
    vi.mocked(setKey).mockImplementation(async (_key, version) => {
      vi.mocked(getKeyOrDefault).mockResolvedValue(version ?? "");
    });
    await Promise.all([
      collect(checkAndDownloadDXMT(aria2)),
      collect(checkAndDownloadDXMT(aria2)),
    ]);
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("extracts the ReShade installer directly and writes paths for the selected prefix", async () => {
    await collect(
      checkAndDownloadReshade(
        aria2,
        { toWinePath: (p: string) => `Z:${p}` } as never,
        "/game"
      )
    );
    expect(exec).toHaveBeenCalledWith([
      "/usr/bin/tar",
      "-xf",
      "reshade/install.exe",
      "-C",
      "./reshade",
    ]);
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
  it("discards a ReShade installer that cannot be extracted so retry can download it", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new Error("invalid archive"));
    await expect(
      collect(checkAndDownloadReshade(aria2, {} as never, "/game"))
    ).rejects.toThrow("invalid archive");
    expect(forceMove).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
    expect(removeFileIfExists).toHaveBeenCalledWith("reshade/install.exe");
    expect(removeFileIfExists).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["1.10.4-alpha.20230402", checkAndDownloadDXVK],
    ["4.1.0", checkAndDownloadJadeite],
    ["654f547", checkAndDownloadDXMT],
  ] as const)("skips an up-to-date runtime %s", async (version, install) => {
    vi.mocked(getKeyOrDefault).mockResolvedValue(version);
    await expect(collect(install(aria2))).resolves.toEqual([]);
    expect(download).not.toHaveBeenCalled();
  });
  it.each([
    ["1.2.2", checkAndDownloadMoltenVK],
    ["1.10.4-alpha.20230402", checkAndDownloadDXVK],
    ["4.1.0", checkAndDownloadJadeite],
    [
      "5.8.0",
      (manager: typeof aria2) =>
        checkAndDownloadReshade(manager, {} as never, "/game"),
    ],
  ] as const)(
    "redownloads runtime %s for malformed markers or missing files",
    async (version, install) => {
      for (const marker of ["invalid", version]) {
        vi.mocked(getKeyOrDefault).mockResolvedValue(marker);
        vi.mocked(stats).mockRejectedValue(new Error("Missing file"));
        const program = install(aria2);
        try {
          expect(await program.next()).toMatchObject({
            value: ["setStateText", "DOWNLOADING_ENVIRONMENT"],
          });
        } finally {
          await program.return(undefined);
        }
      }
    }
  );
});
