import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(),
  setKey: vi.fn(),
}));
vi.mock("@platform/neutralino", () => ({
  env: vi.fn(),
  removeFile: vi.fn(),
  resolve: (path: string) => path,
}));
vi.mock("@runtime/command-runner", () => ({
  exec: vi.fn(),
}));
vi.mock("@runtime/macos-filesystem", () => ({
  cp: vi.fn(),
  forceMove: vi.fn(),
  mkdirp: vi.fn(),
  rmrf_dangerously: vi.fn(),
}));
vi.mock("@runtime/archive", () => ({
  tar_extract: vi.fn(),
}));
vi.mock("@logging/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  logerror: vi.fn(),
}));

import { env } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import { cp, mkdirp, rmrf_dangerously } from "@runtime/macos-filesystem";
import { tar_extract } from "@runtime/archive";
import { applyReleaseApp } from "@src/update/updater";

const mockedEnv = vi.mocked(env);
const mockedExec = vi.mocked(exec);
const mockedCp = vi.mocked(cp);
const mockedMkdirp = vi.mocked(mkdirp);
const mockedRmrf = vi.mocked(rmrf_dangerously);
const mockedTarExtract = vi.mocked(tar_extract);

const OK_RESULT = { pid: 1, exitCode: 0, stdErr: "", stdOut: "" };

describe("update apply", () => {
  beforeEach(() => {
    mockedEnv.mockReset();
    mockedExec.mockReset();
    mockedCp.mockReset();
    mockedMkdirp.mockReset();
    mockedRmrf.mockReset();
    mockedTarExtract.mockReset();
    mockedExec.mockResolvedValue(OK_RESULT);
  });

  it("mirrors the release bundle into the running app with rsync --delete", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm GI CN.app");

    await applyReleaseApp("./sidecar.tar.gz", "Yaaglm GI CN.app");

    expect(mockedTarExtract).toHaveBeenCalledWith(
      "./sidecar.tar.gz",
      "./.update-app"
    );
    const commands = mockedExec.mock.calls.map(call => call[0]);
    expect(commands).toContainEqual([
      "test",
      "-f",
      "./.update-app/Yaaglm GI CN.app/Contents/Resources/build-manifest.json",
    ]);
    expect(commands).toContainEqual([
      "rsync",
      "-a",
      "--checksum",
      "--delete",
      "./.update-app/Yaaglm GI CN.app/",
      "/Applications/Yaaglm GI CN.app/",
    ]);
    expect(mockedRmrf).not.toHaveBeenCalledWith("./sidecar");
    expect(mockedCp).not.toHaveBeenCalled();
  });

  it("falls back to an administrator rsync when the bundle is not writable", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm.app");
    mockedExec.mockImplementation(async (segments, _env, sudo) => {
      if (segments.includes("--delete") && !sudo) {
        throw new Error("permission denied");
      }
      return OK_RESULT;
    });

    await applyReleaseApp("./sidecar.tar.gz", "Yaaglm.app");

    const bundleSyncCalls = mockedExec.mock.calls.filter(call =>
      call[0].includes("--delete")
    );
    expect(bundleSyncCalls).toHaveLength(2);
    expect(bundleSyncCalls[0][2]).toBeUndefined();
    expect(bundleSyncCalls[1][2]).toContain(
      "replace the launcher application bundle"
    );
  });

  it("skips bundle replacement when YAAGL_BUNDLE_PATH is unset", async () => {
    mockedEnv.mockResolvedValue("");

    await applyReleaseApp("./sidecar.tar.gz", "Yaaglm.app");

    const commands = mockedExec.mock.calls.map(call => call[0]);
    expect(commands).not.toContainEqual([
      "rsync",
      "-a",
      "--checksum",
      "--delete",
      "./.update-app/Yaaglm.app/",
      "/",
    ]);
    expect(mockedRmrf).not.toHaveBeenCalledWith("./sidecar");
    expect(mockedCp).not.toHaveBeenCalled();
  });

  it("aborts without touching the old sidecar when the archive layout is invalid", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm.app");
    mockedExec.mockRejectedValueOnce(
      new Error("test -f failed: missing manifest")
    );

    await expect(
      applyReleaseApp("./sidecar.tar.gz", "Yaaglm.app")
    ).rejects.toThrow("missing manifest");

    // rmrf("./sidecar") must NOT have been issued before the layout check.
    expect(mockedRmrf).not.toHaveBeenCalledWith("./sidecar");
  });

  it("reports a pre-rsync failure as a task failure without relaunching", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm.app");
    mockedExec.mockRejectedValueOnce(new Error("tar: not a gzip file"));
    const relaunch = vi.fn(async () => undefined);

    const failure = applyReleaseApp("./sidecar.tar.gz", "Yaaglm.app", {
      relaunch,
    });

    await expect(failure).rejects.toMatchObject({ name: "TaskFailedError" });
    await expect(failure).rejects.toThrow("not a gzip file");
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("relaunches into the repair path when rsync fails after touching the bundle", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm.app");
    mockedExec.mockImplementation(async (segments, _env, sudo) => {
      if (segments.includes("--delete") && sudo) {
        throw new Error("rsync: operation not permitted");
      }
      if (segments.includes("--delete")) {
        throw new Error("rsync: permission denied");
      }
      return OK_RESULT;
    });
    const relaunch = vi.fn(async () => undefined);

    await expect(
      applyReleaseApp("./sidecar.tar.gz", "Yaaglm.app", { relaunch })
    ).resolves.toBeUndefined();

    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("throws a fatal error only when a partially applied bundle cannot be relaunched", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm.app");
    mockedExec.mockImplementation(async (segments, _env, sudo) => {
      if (segments.includes("--delete") && sudo) {
        throw new Error("rsync: operation not permitted");
      }
      if (segments.includes("--delete")) {
        throw new Error("rsync: permission denied");
      }
      return OK_RESULT;
    });
    const relaunch = vi.fn(async () => {
      throw new Error("open failed");
    });

    await expect(
      applyReleaseApp("./sidecar.tar.gz", "Yaaglm.app", { relaunch })
    ).rejects.toMatchObject({ name: "FatalError" });
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("keeps a declined authorization prompt on the intact-version path", async () => {
    mockedEnv.mockResolvedValue("/Applications/Yaaglm.app");
    mockedExec.mockImplementation(async (segments, _env, sudo) => {
      if (segments.includes("--delete") && sudo) {
        throw new Error("User cancelled the authorization prompt");
      }
      if (segments.includes("--delete")) {
        throw new Error("rsync: permission denied");
      }
      return OK_RESULT;
    });
    const relaunch = vi.fn(async () => undefined);

    const failure = applyReleaseApp("./sidecar.tar.gz", "Yaaglm.app", {
      relaunch,
    });

    await expect(failure).rejects.toMatchObject({
      name: "Error",
      message: "User cancelled the authorization prompt",
    });
    expect(relaunch).not.toHaveBeenCalled();
  });
});
