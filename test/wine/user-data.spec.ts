import { describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: vi.fn(async () => true),
  resolve: (path: string) => path.replace(/^\.\//, "/launcher/"),
}));

vi.mock("@runtime/macos-filesystem", () => ({
  cp: vi.fn(async () => undefined),
  mkdirp: vi.fn(async () => undefined),
  rmrf_dangerously: vi.fn(async () => undefined),
}));

import { migrateWineUserData } from "@wine/user-data";

function fakeWine(prefix: string, exitCode = 0) {
  return {
    prefix,
    toWinePath: (path: string) => `Z:${path.replaceAll("/", "\\")}`,
    exec: vi.fn(
      async (
        _program: string,
        _args: string[],
        _env?: Record<string, string>,
        _logFile?: string
      ) => ({ exitCode, stdOut: "", stdErr: "" })
    ),
  };
}

describe("Wine user data migration", () => {
  it("exports/imports game registry keys and copies user directories", async () => {
    const sourceWine = fakeWine("/source/prefix");
    const targetWine = fakeWine("/target/prefix");
    const copyDir = vi.fn(async () => undefined);

    await migrateWineUserData({
      sourceWine: sourceWine as never,
      targetWine: targetWine as never,
      descriptor: {
        registryKeys: [
          "Software\\\\miHoYo\\u7edd\\u533a\\u96f6",
          "Software\\\\miHoYoSDK",
        ],
        prefixDirs: [
          "drive_c/users/*/AppData/LocalLow/miHoYo/\\u7edd\\u533a\\u96f6",
        ],
      },
      workDir: "/launcher/.tmp/wine-migration",
      listUsers: async () => ["wjj"],
      copyDir,
    });

    expect(sourceWine.exec).toHaveBeenCalledTimes(2);
    expect(sourceWine.exec.mock.calls[0]?.[1]?.[0]).toBe("export");
    expect(sourceWine.exec.mock.calls[0]?.[1]?.[1]).toBe(
      "Software\\\\miHoYo\\u7edd\\u533a\\u96f6"
    );
    expect(targetWine.exec).toHaveBeenCalledTimes(2);
    expect(targetWine.exec.mock.calls[0]?.[1]?.[0]).toBe("import");
    expect(copyDir).toHaveBeenCalledWith(
      "/source/prefix/drive_c/users/wjj/AppData/LocalLow/miHoYo/\\u7edd\\u533a\\u96f6",
      "/target/prefix/drive_c/users/wjj/AppData/LocalLow/miHoYo/\\u7edd\\u533a\\u96f6"
    );
  });

  it("skips registry keys that are not present in the source prefix", async () => {
    const sourceWine = fakeWine("/source/prefix", 1);
    const targetWine = fakeWine("/target/prefix");
    const copyDir = vi.fn(async () => undefined);

    await migrateWineUserData({
      sourceWine: sourceWine as never,
      targetWine: targetWine as never,
      descriptor: {
        registryKeys: ["Software\\\\miHoYo\\\\Missing"],
        prefixDirs: [],
      },
      workDir: "/launcher/.tmp/wine-migration",
      listUsers: async () => [],
      copyDir,
    });

    expect(targetWine.exec).not.toHaveBeenCalled();
    expect(copyDir).not.toHaveBeenCalled();
  });
});
