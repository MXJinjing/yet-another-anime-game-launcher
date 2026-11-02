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
import { DownloadCancelledError } from "@download/control";

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
      "winecfg",
      ["-v", "win10"],
      {},
      "/dev/null"
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

  it("does not persist ready state if prefix configuration fails", async () => {
    vi.mocked(isWineDistroInstalled).mockResolvedValue(true);
    wine.exec.mockRejectedValueOnce(new Error("wineboot failed"));
    await expect(collect(createWineInstallProgram(options()))).rejects.toThrow(
      "wineboot failed"
    );
    expect(setKey).not.toHaveBeenCalled();
  });

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
