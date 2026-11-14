import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: vi.fn(),
  removeFileIfExists: vi.fn(),
  resolve: (path: string) => path,
}));
vi.mock("@runtime/binary", () => ({ generateRandomString: () => "temporary" }));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));
vi.mock("@runtime/macos-filesystem", () => ({ mkdirp: vi.fn() }));
vi.mock("@runtime/storage", () => ({
  getKeyOrDefault: vi.fn(),
  setKey: vi.fn(),
}));

import { exec } from "@runtime/command-runner";
import { fileOrDirExists, removeFileIfExists } from "@platform/neutralino";
import { getKeyOrDefault, setKey } from "@runtime/storage";
import {
  assertD3DMetalHostSupported,
  D3DMETAL_ARCHIVE_SHA256,
  isD3DMetalRuntimePrepared,
  prepareD3DMetalWine,
  requireD3DMetalLicense,
  setD3DMetalLicensePrompt,
  verifyD3DMetalArchive,
} from "@wine/d3dmetal";
import { DownloadCancelledError } from "@download/control";

const licenseHash =
  "5abb2d059be217663b00e8fd37e14411d374e11d17e3b744eebd49b8d17118c8";
const helperHash =
  "a21eb0f6de40d5a7f1c23f989644b0966b99c637a5d8f0d26b7b26a5fbffe00e";
const helper = "/staging/libexec/yaagl-d3dmetal/prepare-d3dmetal-runtime";
const result = (stdOut = "") => ({ stdOut, stdErr: "", pid: 1, exitCode: 0 });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getKeyOrDefault).mockResolvedValue("");
});

describe("D3DMetal artifacts and consent", () => {
  it("requires Apple silicon and macOS 26", async () => {
    vi.mocked(exec)
      .mockResolvedValueOnce(result("1\n"))
      .mockResolvedValueOnce(result("26.1\n"));
    await expect(assertD3DMetalHostSupported()).resolves.toBeUndefined();
    vi.mocked(exec)
      .mockResolvedValueOnce(result("1\n"))
      .mockResolvedValueOnce(result("15.7\n"));
    await expect(assertD3DMetalHostSupported()).rejects.toThrow("macOS 26");
  });

  it("rejects the wrong archive length or digest", async () => {
    vi.mocked(exec).mockResolvedValueOnce(result("612\n"));
    await expect(verifyD3DMetalArchive("/archive")).rejects.toThrow("size");
    expect(exec).toHaveBeenCalledTimes(1);

    vi.mocked(exec)
      .mockResolvedValueOnce(result("239444460\n"))
      .mockResolvedValueOnce(result(`${"a".repeat(64)}  /archive\n`));
    await expect(verifyD3DMetalArchive("/archive")).rejects.toThrow("SHA-256");

    vi.mocked(exec)
      .mockResolvedValueOnce(result("239444460\n"))
      .mockResolvedValueOnce(result(`${D3DMETAL_ARCHIVE_SHA256}  /archive\n`));
    await expect(verifyD3DMetalArchive("/archive")).resolves.toBeUndefined();
  });

  it("never persists a decision without displaying verified license text", async () => {
    setD3DMetalLicensePrompt(async () => true);
    await expect(requireD3DMetalLicense()).rejects.toThrow("not verified");
    expect(setKey).not.toHaveBeenCalled();
    setD3DMetalLicensePrompt(async () => false);
    await expect(requireD3DMetalLicense()).rejects.toBeInstanceOf(
      DownloadCancelledError
    );
    expect(setKey).not.toHaveBeenCalled();
  });

  it("downloads a verified replacement for a corrupt license and persists explicit acceptance", async () => {
    vi.mocked(exec).mockImplementation(async ([command, ...args]) => {
      if (command === "/usr/bin/shasum") {
        if (
          args[2] === "d3dmetal-license/License.rtf" &&
          !vi
            .mocked(exec)
            .mock.calls.some(([previous]) => previous[0] === "/bin/mv")
        ) {
          return result(`${"a".repeat(64)}  old\n`);
        }
        return result(`${licenseHash}  license\n`);
      }
      return result(command === "/usr/bin/textutil" ? "Verified license" : "");
    });
    setD3DMetalLicensePrompt(
      async load => (await load()) === "Verified license"
    );
    await requireD3DMetalLicense();
    expect(setKey).toHaveBeenCalledWith(
      "d3dmetal_apple_license_sha256",
      licenseHash
    );
    expect(removeFileIfExists).toHaveBeenCalledWith(
      "d3dmetal-license/License.temporary.rtf"
    );
    expect(exec).toHaveBeenCalledWith(
      expect.arrayContaining(["/usr/bin/curl", "--proto-redir", "=https"])
    );
  });

  it("does not launch an unverified helper or prepare without consent", async () => {
    await expect(prepareD3DMetalWine("/staging")).rejects.toThrow(
      "acknowledgement"
    );
    expect(exec).not.toHaveBeenCalled();
    vi.mocked(getKeyOrDefault).mockResolvedValue(licenseHash);
    vi.mocked(exec)
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(`${"a".repeat(64)}  helper\n`));
    await expect(prepareD3DMetalWine("/staging")).rejects.toThrow("SHA-256");
    expect(
      vi.mocked(exec).mock.calls.some(([command]) => command[0] === helper)
    ).toBe(false);
  });

  it("verifies the helper and native framework before adding files to staging", async () => {
    vi.mocked(getKeyOrDefault).mockResolvedValue(licenseHash);
    vi.mocked(exec).mockImplementation(async ([command, ...args]) =>
      result(
        command === "/usr/bin/shasum"
          ? `${args[2] === helper ? helperHash : licenseHash}  artifact\n`
          : ""
      )
    );
    await prepareD3DMetalWine("/staging");
    expect(exec).toHaveBeenNthCalledWith(3, [
      "/usr/bin/codesign",
      "--verify",
      "--strict",
      helper,
    ]);
    expect(exec).toHaveBeenNthCalledWith(
      4,
      expect.arrayContaining([helper, "--accept-apple-license"])
    );
    expect(exec).toHaveBeenNthCalledWith(5, [
      "/usr/bin/codesign",
      "--verify",
      "--deep",
      "--strict",
      "/staging/.prepared-d3dmetal/D3DMetal.framework",
    ]);
  });

  it("requires both the native framework binary and the preparation manifest", async () => {
    vi.mocked(fileOrDirExists)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(isD3DMetalRuntimePrepared("/wine")).resolves.toBe(false);
    vi.mocked(fileOrDirExists).mockResolvedValue(true);
    await expect(isD3DMetalRuntimePrepared("/wine")).resolves.toBe(true);
  });
});
