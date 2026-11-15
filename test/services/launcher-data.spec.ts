import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeApp, env, resolve } from "@platform/neutralino";
import { rawString } from "@platform/shell";
import { exec } from "@runtime/command-runner";
import { shutdown } from "@runtime/lifecycle";
import {
  clearLauncherData,
  getLauncherDataDirectory,
  openLauncherDataDirectory,
} from "@services/launcher-data";

vi.mock("@platform/neutralino", () => ({
  closeApp: vi.fn(async () => undefined),
  env: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));
vi.mock("@runtime/lifecycle", () => ({
  shutdown: vi.fn(async () => undefined),
}));

const home = "/Users/Player";
const support = home + "/Library/Application Support";
const directory = support + "/Yaaglm OS";
const isIdle = () => false;
const commandResult = (stdOut = "") => ({
  pid: 1,
  exitCode: 0,
  stdOut,
  stdErr: "",
});

describe("launcher data directory", () => {
  let configuredDirectory: string;
  let workingDirectory: string;
  let realPaths: Record<string, string>;
  let trashError: Error | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    configuredDirectory = directory;
    workingDirectory = directory;
    realPaths = { [directory]: directory, [support]: support };
    trashError = undefined;
    vi.mocked(env).mockImplementation(async key =>
      key === "HOME" ? home : configuredDirectory
    );
    vi.mocked(resolve).mockImplementation(path =>
      path === "." ? workingDirectory : path
    );
    vi.mocked(exec).mockImplementation(async args => {
      if (args[0] === "/usr/bin/osascript" && trashError) throw trashError;
      if (args[0] !== "/usr/bin/perl") return commandResult();
      const target = args[4];
      if (typeof target !== "object" || Array.isArray(target)) {
        throw new Error("Expected a quoted path");
      }
      return commandResult(realPaths[target._rawString_.slice(1, -1)]);
    });
  });

  function trashCalls() {
    return vi
      .mocked(exec)
      .mock.calls.filter(([args]) => args[0] === "/usr/bin/osascript");
  }

  it("reports the packaged directory and opens it in Finder", async () => {
    expect(await getLauncherDataDirectory()).toBe(directory);
    await openLauncherDataDirectory(directory);
    expect(exec).toHaveBeenLastCalledWith([
      "/usr/bin/open",
      "-a",
      "Finder",
      rawString(`'${directory}'`),
    ]);
  });

  it.each(["", home, support, directory + "/child", support + "/../Documents"])(
    "rejects an unrecognized Application Support target (%s)",
    async invalid => {
      configuredDirectory = invalid;
      await expect(getLauncherDataDirectory()).resolves.toBeUndefined();
      await expect(clearLauncherData(invalid, [], isIdle)).rejects.toThrow(
        "verified"
      );
      expect(trashCalls()).toHaveLength(0);
    }
  );

  it("rejects a data folder symlinked out of Application Support", async () => {
    realPaths[directory] = home + "/Documents";
    expect(await getLauncherDataDirectory()).toBeUndefined();
  });

  it("rejects a mismatch with the current working directory", async () => {
    workingDirectory = support + "/Other App";
    realPaths[workingDirectory] = workingDirectory;
    expect(await getLauncherDataDirectory()).toBeUndefined();
  });

  it.each([support, directory, directory + "/Games/Test"])(
    "protects a game installation that overlaps the data folder (%s)",
    async path => {
      await expect(
        clearLauncherData(directory, [path], isIdle)
      ).rejects.toThrow("overlaps");
      expect(trashCalls()).toHaveLength(0);
      expect(closeApp).not.toHaveBeenCalled();
    }
  );

  it("protects game installations that resolve into the data folder", async () => {
    const alias = home + "/Games/Test";
    realPaths[alias] = directory + "/Games/Test";
    await expect(clearLauncherData(directory, [alias], isIdle)).rejects.toThrow(
      "overlaps"
    );
    expect(trashCalls()).toHaveLength(0);
  });

  it("rechecks for active work immediately before moving data", async () => {
    const busy = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    await expect(clearLauncherData(directory, [], busy)).rejects.toThrow(
      "still running"
    );
    expect(trashCalls()).toHaveLength(0);
  });

  it("trashes only the verified folder, then shuts down and quits", async () => {
    await clearLauncherData(
      directory,
      [directory + " Backup/Game", ""],
      isIdle
    );
    expect(trashCalls()).toHaveLength(1);
    expect(trashCalls()[0][0]).toEqual([
      "/usr/bin/osascript",
      "-l",
      "JavaScript",
      "-e",
      expect.stringContaining("trashItemAtURL"),
      rawString(`'${directory}'`),
    ]);
    const trashIndex = vi.mocked(exec).mock.calls.indexOf(trashCalls()[0]);
    expect(vi.mocked(exec).mock.invocationCallOrder[trashIndex]).toBeLessThan(
      vi.mocked(shutdown).mock.invocationCallOrder[0]
    );
    expect(vi.mocked(shutdown).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(closeApp).mock.invocationCallOrder[0]
    );
  });

  it("leaves the launcher open if macOS cannot move the folder", async () => {
    trashError = new Error("Trash unavailable");
    await expect(clearLauncherData(directory, [], isIdle)).rejects.toThrow(
      "Trash unavailable"
    );
    expect(shutdown).not.toHaveBeenCalled();
    expect(closeApp).not.toHaveBeenCalled();
  });
});
