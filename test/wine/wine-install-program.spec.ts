import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@platform/neutralino", () => ({
  removeFile: vi.fn(),
  removeFileIfExists: vi.fn(),
  resolve: (path: string) => path,
}));
vi.mock("@runtime/archive", () => ({
  tar_extract: vi.fn(),
  tar_extract_directory: vi.fn(),
}));
vi.mock("@runtime/binary", () => ({ generateRandomString: () => "1234567" }));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));
vi.mock("@runtime/macos-filesystem", () => ({
  rmrf_dangerously: vi.fn(),
  xattrRemove: vi.fn(),
}));
vi.mock("@runtime/storage", () => ({ setKey: vi.fn() }));
vi.mock("@src/system/hosts", () => ({ ensureHosts: vi.fn() }));
vi.mock("@locale/authorization", () => ({
  getAuthorizationPrompt: async () => "authorization",
}));
vi.mock("@wine/wine", () => ({
  createWine: vi.fn(),
  ensureActiveWineCompatLink: vi.fn(),
  getWineInstallDir: (id: string) => `/wines/${id}`,
  isWineDistroInstalled: vi.fn(),
}));
vi.mock("@wine/mf", () => ({ installMediaFoundation: vi.fn() }));
vi.mock("@wine/cert", () => ({ addCertsToWine: vi.fn() }));

import { removeFileIfExists } from "@platform/neutralino";
import { tar_extract, tar_extract_directory } from "@runtime/archive";
import { exec } from "@runtime/command-runner";
import { rmrf_dangerously, xattrRemove } from "@runtime/macos-filesystem";
import { setKey } from "@runtime/storage";
import { createWine, isWineDistroInstalled } from "@wine/wine";
import { addCertsToWine } from "@wine/cert";
import {
  createWineInstallProgram,
  installWineEnvironmentProgram,
} from "@wine/wine-install-program";
import { DownloadCancelledError, DownloadFailedError } from "@download/control";

const distro = {
  id: "test",
  displayName: "Test Wine",
  remoteUrl: "https://example.invalid/wine.tar.gz",
  attributes: {},
};
const wine = { exec: vi.fn(async () => undefined) };
const download = vi.fn();
const options = () => ({
  aria2: { doStreamingDownload: download } as never,
  wineAbsPrefix: "/prefix",
  wineDistro: distro,
});
async function collect(program: AsyncGenerator<unknown>) {
  const commands: unknown[] = [];
  for await (const command of program) commands.push(command);
  return commands;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exec).mockResolvedValue({
    stdOut: "logs/wine-initialization.test\n",
    stdErr: "",
    exitCode: 0,
    pid: 1,
  });
  vi.mocked(isWineDistroInstalled).mockResolvedValue(false);
  vi.mocked(createWine).mockResolvedValue(wine as never);
  vi.mocked(tar_extract).mockReset();
  wine.exec.mockReset().mockResolvedValue(undefined);
  download.mockReset().mockImplementation(async function* () {
    yield { completedLength: 50n, totalLength: 100n, downloadSpeed: 10n };
  });
});

describe("Wine environment installation", () => {
  it("downloads into a staging directory, then activates only after configuration", async () => {
    const commands = await collect(createWineInstallProgram(options()));
    expect(commands).toContainEqual(["setProgress", 50]);
    expect(tar_extract).toHaveBeenCalledWith(
      "./wine-test.tar.gz",
      "/wines/test.installing"
    );
    expect(exec).toHaveBeenCalledWith([
      "mv",
      "/wines/test.installing",
      "/wines/test",
    ]);
    expect(addCertsToWine).toHaveBeenCalledWith("/wines/test");
    expect(xattrRemove).toHaveBeenCalledWith(
      "com.apple.quarantine",
      "/wines/test",
      "authorization"
    );
    expect(wine.exec).toHaveBeenCalledWith(
      "wineboot",
      ["-u"],
      {},
      "logs/wine-initialization.test/1-wineboot.log"
    );
    expect(wine.exec).toHaveBeenCalledWith(
      "winecfg",
      ["-v", "win10"],
      {},
      "logs/wine-initialization.test/2-winecfg.log"
    );
    expect(setKey).toHaveBeenCalledWith("wine_state", "ready");
    expect(setKey).toHaveBeenCalledWith("wine_netbiosname", "DESKTOP-1234567");
    expect(wine.exec.mock.invocationCallOrder.at(-1)).toBeLessThan(
      vi.mocked(setKey).mock.invocationCallOrder[0]
    );
    expect(commands.at(-1)).toEqual(["setStateText", "INSTALL_DONE"]);
  });

  it("extracts the selected subtree of xz archives and preserves the download namespace", async () => {
    await collect(
      installWineEnvironmentProgram({
        ...options(),
        activate: false,
        downloadKey: "game",
        wineDistro: {
          ...distro,
          remoteUrl: "https://example.invalid/wine.tar.xz",
          attributes: { winePath: "bundle/wine" },
        },
      })
    );
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        absDst: "./wine-test.tar.xz",
        downloadKey: "game",
      })
    );
    expect(tar_extract_directory).toHaveBeenCalledWith(
      "./wine-test.tar.xz",
      "/wines/test.installing",
      "bundle/wine",
      true
    );
    expect(setKey).not.toHaveBeenCalled();
    expect(createWine).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "verifies a pinned archive when aria2 reuses a completed result: %s",
    async cached => {
      if (cached) download.mockImplementation(async function* () {});
      const hash = "a".repeat(64);
      const wineDistro = { ...distro, checksum: `sha-256=${hash}` as const };
      vi.mocked(exec).mockResolvedValueOnce({
        stdOut: `${hash}  ./wine-test.tar.gz\n`,
        stdErr: "",
        exitCode: 0,
        pid: 1,
      });

      await collect(createWineInstallProgram({ ...options(), wineDistro }));

      expect(download).toHaveBeenCalledWith(
        expect.objectContaining({ checksum: wineDistro.checksum })
      );
      expect(exec).toHaveBeenNthCalledWith(1, [
        "/usr/bin/shasum",
        "-a",
        "256",
        "./wine-test.tar.gz",
      ]);
      expect(vi.mocked(exec).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(tar_extract).mock.invocationCallOrder[0]
      );
    }
  );

  it("rejects an invalid cached archive and lets a retry download it again", async () => {
    download.mockImplementation(async function* () {});
    const wineDistro = {
      ...distro,
      checksum: `sha-256=${"a".repeat(64)}` as const,
    };
    vi.mocked(exec).mockResolvedValueOnce({
      stdOut: `${"b".repeat(64)}  ./wine-test.tar.gz\n`,
      stdErr: "",
      exitCode: 0,
      pid: 1,
    });

    await expect(
      collect(createWineInstallProgram({ ...options(), wineDistro }))
    ).rejects.toBeInstanceOf(DownloadFailedError);
    expect(removeFileIfExists).toHaveBeenCalledWith("./wine-test.tar.gz");
    expect(tar_extract).not.toHaveBeenCalled();
    expect(setKey).not.toHaveBeenCalled();
  });

  it("cleans partial downloads on cancellation and does not mark the environment ready", async () => {
    download.mockImplementation(async function* () {
      throw new DownloadCancelledError();
    });
    await expect(
      collect(createWineInstallProgram(options()))
    ).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(removeFileIfExists).toHaveBeenCalledWith("./wine-test.tar.gz");
    expect(rmrf_dangerously).toHaveBeenCalledWith("/wines/test.installing");
    expect(setKey).not.toHaveBeenCalled();
  });

  it("preserves failed transfers for retry without deleting an existing Wine", async () => {
    download.mockImplementation(async function* () {
      throw new Error("network");
    });
    await expect(collect(createWineInstallProgram(options()))).rejects.toThrow(
      "network"
    );
    expect(removeFileIfExists).not.toHaveBeenCalled();
    expect(rmrf_dangerously).not.toHaveBeenCalledWith("/wines/test");
    expect(setKey).not.toHaveBeenCalled();
  });

  it("does not replace the old installation when extraction fails", async () => {
    vi.mocked(tar_extract).mockRejectedValueOnce(new Error("corrupt archive"));
    await expect(collect(createWineInstallProgram(options()))).rejects.toThrow(
      "corrupt archive"
    );
    expect(exec).not.toHaveBeenCalledWith([
      "mv",
      "/wines/test.installing",
      "/wines/test",
    ]);
    expect(rmrf_dangerously).not.toHaveBeenCalledWith("/wines/test");
    expect(setKey).not.toHaveBeenCalled();
  });

  it.each([
    ["wineboot", "1-wineboot.log"],
    ["winecfg", "2-winecfg.log"],
  ])(
    "reports the %s log and leaves ready state unset on failure",
    async (program, file) => {
      vi.mocked(isWineDistroInstalled).mockResolvedValue(true);
      const cause = new Error(`${program} failed`);
      if (program === "winecfg") wine.exec.mockResolvedValueOnce(undefined);
      wine.exec.mockRejectedValueOnce(cause);
      await expect(
        collect(createWineInstallProgram(options()))
      ).rejects.toMatchObject({
        cause,
        message: expect.stringContaining(
          `logs/wine-initialization.test/${file}`
        ),
      });
      expect(wine.exec).toHaveBeenCalledTimes(program === "wineboot" ? 1 : 2);
      expect(setKey).not.toHaveBeenCalled();
    }
  );

  it("skips all work for an already downloaded inactive environment", async () => {
    vi.mocked(isWineDistroInstalled).mockResolvedValue(true);
    await expect(
      collect(
        installWineEnvironmentProgram({
          ...options(),
          activate: false,
          finishMessage: false,
        })
      )
    ).resolves.toEqual([]);
    expect(download).not.toHaveBeenCalled();
    expect(addCertsToWine).not.toHaveBeenCalled();
    expect(xattrRemove).not.toHaveBeenCalled();
  });

  it("requires a system installation to exist", async () => {
    await expect(
      collect(
        installWineEnvironmentProgram({
          ...options(),
          wineDistro: { ...distro, systemWineRoot: "/system/wine" },
        })
      )
    ).rejects.toThrow("System Wine is no longer available");
    expect(download).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "keeps system Wine untouched when activation is %s",
    async activate => {
      vi.mocked(isWineDistroInstalled).mockResolvedValue(true);
      const commands = await collect(
        installWineEnvironmentProgram({
          ...options(),
          activate,
          wineDistro: { ...distro, systemWineRoot: "/system/wine" },
        })
      );
      expect(download).not.toHaveBeenCalled();
      expect(addCertsToWine).not.toHaveBeenCalled();
      expect(xattrRemove).not.toHaveBeenCalled();
      expect(createWine).toHaveBeenCalledTimes(activate ? 1 : 0);
      expect(commands.at(-1)).toEqual(["setStateText", "INSTALL_DONE"]);
    }
  );
});
