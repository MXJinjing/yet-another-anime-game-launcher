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
import { DownloadCancelledError, DownloadFailedError } from "@download/control";
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
  it("keeps a cancelled MoltenVK download cancellable", async () => {
    download.mockImplementation(async function* () {
      throw new DownloadCancelledError();
    });
    await expect(
      collect(checkAndDownloadMoltenVK(aria2))
    ).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(removeFileIfExists).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
  });
  it("cleans a partial DXVK library before reporting a typed failure", async () => {
    download.mockImplementation(async function* () {
      throw new Error("network");
    });
    await expect(collect(checkAndDownloadDXVK(aria2))).rejects.toBeInstanceOf(
      DownloadFailedError
    );
    expect(removeFileIfExists).toHaveBeenCalledWith("./dxvk/d3d9.dll");
    expect(setKey).not.toHaveBeenCalled();
  });
  it("keeps a cancelled DXVK download cancellable", async () => {
    download.mockImplementation(async function* () {
      throw new DownloadCancelledError();
    });
    await expect(collect(checkAndDownloadDXVK(aria2))).rejects.toBeInstanceOf(
      DownloadCancelledError
    );
    expect(removeFileIfExists).not.toHaveBeenCalled();
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
    await expect(
      collect(checkAndDownloadJadeite(aria2))
    ).rejects.toBeInstanceOf(DownloadFailedError);
    expect(setKey).not.toHaveBeenCalled();
    expect(removeFileIfExists).toHaveBeenCalledWith("./jadeite/archive.zip");
    expect(rmrf_dangerously).toHaveBeenCalledWith("./jadeite");
  });
  it("keeps a cancelled Jadeite extraction cancellable", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new DownloadCancelledError());
    await expect(
      collect(checkAndDownloadJadeite(aria2))
    ).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(removeFileIfExists).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
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
  it("preserves the old DXMT runtime after extraction keeps failing", async () => {
    vi.mocked(exec).mockImplementation(async command => {
      if (command[0] === "/usr/bin/unzip") throw new Error("corrupt archive");
      return { stdOut: checksum } as never;
    });
    await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toBeInstanceOf(
      DownloadFailedError
    );
    expect(download).toHaveBeenCalledTimes(2);
    expect(forceMove).not.toHaveBeenCalledWith("./dxmt", "./dxmt-backup");
    expect(setKey).not.toHaveBeenCalled();
    expect(rmrf_dangerously).toHaveBeenCalledWith("./dxmt-staging");
  });
  it("retries a corrupt DXMT download once and succeeds", async () => {
    vi.mocked(exec)
      .mockResolvedValueOnce({ stdOut: "wrong-hash" } as never)
      .mockResolvedValue({ stdOut: checksum } as never);
    await collect(checkAndDownloadDXMT(aria2));
    expect(download).toHaveBeenCalledTimes(2);
    expect(setKey).toHaveBeenCalledWith("installed_dxmt_version", "654f547");
  });
  it("restores the backup runtime and retries when swapping fails", async () => {
    vi.mocked(fileOrDirExists).mockResolvedValue(true);
    vi.mocked(forceMove).mockImplementation(async source => {
      if (source === "dxmt-staging/runtime") throw new Error("Swap failed");
      return {} as never;
    });
    try {
      await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toBeInstanceOf(
        DownloadFailedError
      );
      expect(forceMove).toHaveBeenCalledWith("./dxmt-backup", "./dxmt");
      expect(setKey).not.toHaveBeenCalled();
      expect(rmrf_dangerously).toHaveBeenCalledWith("./dxmt-staging");
    } finally {
      vi.mocked(forceMove).mockReset();
    }
  });
  it("cleans a corrupt DXMT download before reporting the final failure", async () => {
    vi.mocked(exec).mockResolvedValue({ stdOut: "wrong-hash" } as never);
    await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toBeInstanceOf(
      DownloadFailedError
    );
    expect(download).toHaveBeenCalledTimes(2);
    expect(setKey).not.toHaveBeenCalled();
    expect(rmrf_dangerously).toHaveBeenCalledWith("./dxmt-staging");
  });
  it("keeps a cancelled DXMT download cancellable", async () => {
    download.mockImplementation(async function* () {
      throw new DownloadCancelledError();
    });
    await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toBeInstanceOf(
      DownloadCancelledError
    );
    expect(setKey).not.toHaveBeenCalled();
    expect(rmrf_dangerously).toHaveBeenCalledWith("./dxmt-staging");
  });
  it("reports missing DXMT runtime files as a download failure", async () => {
    vi.mocked(stats).mockRejectedValue(new Error("Missing file"));
    await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toBeInstanceOf(
      DownloadFailedError
    );
    expect(download).toHaveBeenCalledTimes(2);
    expect(setKey).not.toHaveBeenCalled();
    expect(rmrf_dangerously).toHaveBeenCalledWith("./dxmt-staging");
  });
  it("does not leave a half-swapped runtime when no backup exists", async () => {
    vi.mocked(forceMove).mockImplementation(async source => {
      if (source === "dxmt-staging/runtime") throw new Error("Swap failed");
      return {} as never;
    });
    try {
      await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toBeInstanceOf(
        DownloadFailedError
      );
      expect(forceMove).not.toHaveBeenCalledWith("./dxmt-backup", "./dxmt");
      expect(setKey).not.toHaveBeenCalled();
    } finally {
      vi.mocked(forceMove).mockReset();
    }
  });
  it("restores an existing backup when the runtime directory is missing", async () => {
    vi.mocked(fileOrDirExists).mockImplementation(
      async path => path === "./dxmt-backup"
    );
    vi.mocked(forceMove).mockImplementation(async source => {
      if (source === "dxmt-staging/runtime") throw new Error("Swap failed");
      return {} as never;
    });
    try {
      await expect(collect(checkAndDownloadDXMT(aria2))).rejects.toBeInstanceOf(
        DownloadFailedError
      );
      expect(forceMove).toHaveBeenCalledWith("./dxmt-backup", "./dxmt");
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
    const program = collect(
      checkAndDownloadReshade(aria2, {} as never, "/game")
    );
    await expect(program).rejects.toBeInstanceOf(DownloadFailedError);
    await expect(program).rejects.toThrow("invalid archive");
    expect(forceMove).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
    expect(removeFileIfExists).toHaveBeenCalledWith("reshade/install.exe");
    expect(removeFileIfExists).toHaveBeenCalledTimes(1);
  });
  it("cleans a partial MoltenVK download before reporting a typed failure", async () => {
    download.mockImplementation(async function* () {
      throw new Error("network");
    });
    await expect(
      collect(checkAndDownloadMoltenVK(aria2))
    ).rejects.toBeInstanceOf(DownloadFailedError);
    expect(removeFileIfExists).toHaveBeenCalledWith(
      "./moltenvk/libMoltenVK.dylib"
    );
    expect(setKey).not.toHaveBeenCalled();
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
