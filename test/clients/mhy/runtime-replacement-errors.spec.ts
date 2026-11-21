import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({ log: vi.fn(async () => undefined) }));
vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: vi.fn(async () => false),
  readFile: vi.fn(async () => ""),
  removeFile: vi.fn(async () => undefined),
  removeFileIfExists: vi.fn(async () => undefined),
  resolve: (path: string) => `/launcher/${path.replace(/^\.\//, "")}`,
  resolveResource: (path: string) => `/resources/${path}`,
  writeBinary: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));
vi.mock("@runtime/macos-filesystem", () => ({
  cp: vi.fn(async () => undefined),
  forceMove: vi.fn(async () => undefined),
  mkdirp: vi.fn(async () => undefined),
}));
vi.mock("@runtime/patching", () => ({
  md5: vi.fn(async () => ""),
  xdelta3: vi.fn(async () => undefined),
}));

import { fileOrDirExists } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import {
  applyMhypBaseReplacement,
  RuntimeReplacementConfigInvalidError,
  RuntimeReplacementFileMissingError,
  RuntimeReplacementImpossibleError,
  RuntimeReplacementVerificationError,
  withoutRuntimeReplacements,
} from "@src/clients/mhy/patch";
import type { Config } from "@config";

const gameDir = "/Games/AnimeGame";
const source = "/tmp/replacement.dll";

function configWith(entries: Array<Record<string, unknown>>): Config {
  return {
    runtimeReplacementsEnabled: true,
    runtimeReplacements: entries,
  } as unknown as Config;
}

const fileOrDirExistsMock = vi.mocked(fileOrDirExists);
const execMock = vi.mocked(exec);

beforeEach(() => {
  vi.clearAllMocks();
  fileOrDirExistsMock.mockImplementation(
    async path =>
      path === source ||
      (path.startsWith(gameDir) && !path.includes(".yaagl-runtime"))
  );
  execMock.mockImplementation(async command => {
    // Both the source and the target "exist" unless a row is unsafe.
    if (command[0] === "test") {
      return { exitCode: 0, stdOut: "", stdErr: "" } as never;
    }
    if (command[0] === "cmp") {
      // Source and target differ; the temporary copy also differs so the
      // verification path can be exercised.
      throw new Error("files differ");
    }
    return { exitCode: 0, stdOut: "", stdErr: "" } as never;
  });
});

describe("runtime replacement failures", () => {
  it("asks before skipping when an enabled row has no source path", async () => {
    await expect(
      applyMhypBaseReplacement(
        gameDir,
        configWith([
          {
            enabled: true,
            targetRelativePath: "runtime.dll",
            replacementPath: "",
          },
        ])
      )
    ).rejects.toBeInstanceOf(RuntimeReplacementConfigInvalidError);
  });

  it("keeps the missing-source modal for a source file that is not there", async () => {
    execMock.mockImplementation(async command => {
      if (command[0] === "test") throw new Error("missing");
      return { exitCode: 0, stdOut: "", stdErr: "" } as never;
    });

    await expect(
      applyMhypBaseReplacement(
        gameDir,
        configWith([
          {
            enabled: true,
            targetRelativePath: "runtime.dll",
            replacementPath: "/tmp/absent.dll",
          },
        ])
      )
    ).rejects.toBeInstanceOf(RuntimeReplacementFileMissingError);
  });

  it("skips a structurally unsafe target without asking", async () => {
    await expect(
      applyMhypBaseReplacement(
        gameDir,
        configWith([
          {
            enabled: true,
            targetRelativePath: "../../Documents/runtime.dll",
            replacementPath: source,
          },
        ])
      )
    ).rejects.toBeInstanceOf(RuntimeReplacementImpossibleError);
  });

  it("skips duplicate targets without asking", async () => {
    await expect(
      applyMhypBaseReplacement(
        gameDir,
        configWith([
          {
            enabled: true,
            targetRelativePath: "runtime.dll",
            replacementPath: source,
          },
          {
            enabled: true,
            targetRelativePath: "runtime.dll",
            replacementPath: source,
          },
        ])
      )
    ).rejects.toBeInstanceOf(RuntimeReplacementImpossibleError);
  });

  it("asks when the temporary copy fails verification", async () => {
    await expect(
      applyMhypBaseReplacement(
        gameDir,
        configWith([
          {
            enabled: true,
            targetRelativePath: "runtime.dll",
            replacementPath: source,
          },
        ])
      )
    ).rejects.toBeInstanceOf(RuntimeReplacementVerificationError);
  });

  it("disables every replacement source for a skip-and-launch retry", () => {
    const disabled = withoutRuntimeReplacements({
      runtimeReplacementsEnabled: true,
      runtimeReplacements: [{ enabled: true }],
      workaround4: true,
      mhypBaseReplacementPath: "/tmp/file",
    });

    expect(disabled.runtimeReplacementsEnabled).toBe(false);
    expect(disabled.runtimeReplacements).toEqual([]);
    expect(disabled.workaround4).toBe(false);
    expect(disabled.mhypBaseReplacementPath).toBe("");
  });
});
