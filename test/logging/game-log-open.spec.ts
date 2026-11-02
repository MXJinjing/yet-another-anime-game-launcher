import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { openGameLogFile } from "@src/logging/game-log-tail";

const logPath = "/games/The Anime Game's #1 $(echo bad)/Player.log";
const options = {
  prefix: "/prefix",
  gameDir: "/games",
  locations: [
    {
      root: "game-install" as const,
      path: "The Anime Game's #1 $(echo bad)/Player.log",
    },
  ],
};

describe("opening game logs in Console", () => {
  const execCommand = vi.fn();
  const getStats = vi.fn();
  const onOpenError = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    execCommand.mockResolvedValue({ exitCode: 0 });
    getStats.mockResolvedValue({ isFile: true });
    vi.stubGlobal("Neutralino", {
      filesystem: {
        readDirectory: vi.fn(async () => []),
        getStats,
      },
      os: { execCommand },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("targets Console by bundle ID and preserves special characters in paths", async () => {
    const stop = openGameLogFile({ ...options, onOpenError });
    await vi.advanceTimersByTimeAsync(0);

    expect(execCommand).toHaveBeenCalledOnce();
    const command = execCommand.mock.calls[0][0] as string;
    // Replace only the executable to inspect the shell's actual argument parsing.
    const args = execFileSync(
      "/bin/sh",
      ["-c", command.replace("/usr/bin/open", "printf '%s\\n'")],
      { encoding: "utf8" }
    ).trimEnd();
    expect(args.split("\n")).toEqual(["-b", "com.apple.Console", logPath]);
    expect(onOpenError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(execCommand).toHaveBeenCalledOnce();
    stop();
  });

  it("waits for a log created after launch", async () => {
    getStats.mockRejectedValueOnce(new Error("not found"));
    const stop = openGameLogFile(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(execCommand).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(execCommand).toHaveBeenCalledOnce();
    stop();
  });

  it("does not open a log if cancelled during discovery", async () => {
    let resolveStats!: (value: { isFile: boolean }) => void;
    getStats.mockReturnValueOnce(
      new Promise(resolve => {
        resolveStats = resolve;
      })
    );
    const stop = openGameLogFile(options);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolveStats({ isFile: true });
    await vi.advanceTimersByTimeAsync(800);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it.each(["nonzero exit", "API rejection"])(
    "reports the log path on %s without retrying",
    async failure => {
      if (failure === "nonzero exit") {
        execCommand.mockResolvedValue({ exitCode: 1 });
      } else {
        execCommand.mockRejectedValue(new Error("API unavailable"));
      }
      const stop = openGameLogFile({ ...options, onOpenError });
      await vi.advanceTimersByTimeAsync(1600);
      expect(onOpenError).toHaveBeenCalledOnce();
      expect(onOpenError).toHaveBeenCalledWith(logPath);
      expect(execCommand).toHaveBeenCalledOnce();
      stop();
    }
  );
});
