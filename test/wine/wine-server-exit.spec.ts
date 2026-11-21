import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: vi.fn(async () => false),
  getCPUInfo: vi.fn(async () => ({ arch: "arm64" })),
  removeFileIfExists: vi.fn(async () => undefined),
  resolve: vi.fn((path: string) =>
    path.startsWith("/") ? path : `/test/${path}`
  ),
  stats: vi.fn(async () => {
    throw new Error("not found");
  }),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("@runtime/command-runner", () => ({
  exec: vi.fn(async () => ({ exitCode: 0, stdOut: "", stdErr: "" })),
  exec2: vi.fn(async () => ({ exitCode: 0, stdOut: "", stdErr: "" })),
}));

vi.mock("@runtime/storage", () => ({
  getKey: vi.fn(async () => {
    throw new Error("missing");
  }),
  setKey: vi.fn(async () => undefined),
}));

import { fileOrDirExists } from "@platform/neutralino";
import { exec, exec2 } from "@runtime/command-runner";
import { TaskFailedError } from "@tasks/task-program";
import { createWine } from "@wine/wine";

describe("Wine server shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fileOrDirExists).mockResolvedValue(false);
  });

  it("treats an unavailable wineserver binary as already stopped", async () => {
    vi.mocked(exec2).mockRejectedValueOnce(
      new Error(
        "Command return non-zero code (127) \n/path/to/wineserver -w\nStdErr:\nNo such file or directory"
      )
    );
    const wine = await createWine({
      prefix: "/tmp/yaaglm-test-prefix",
      distro: {
        id: "test-wine",
        displayName: "Test Wine",
        remoteUrl: "https://example.invalid/wine.tar.xz",
        attributes: { renderBackend: "dxmt", winePath: "wine" },
      },
    });

    await expect(wine.waitForWineServerExit()).resolves.toBe(true);
    expect(exec2).toHaveBeenCalledOnce();
  });

  it("keeps the server active when wineserver fails for another reason", async () => {
    vi.mocked(exec2).mockRejectedValueOnce(
      new Error("Command return non-zero code (1) \nwineserver failed")
    );
    const wine = await createWine({
      prefix: "/tmp/yaaglm-test-prefix",
      distro: {
        id: "test-wine",
        displayName: "Test Wine",
        remoteUrl: "https://example.invalid/wine.tar.xz",
        attributes: { renderBackend: "dxmt", winePath: "wine" },
      },
    });

    await expect(wine.waitForWineServerExit()).resolves.toBe(false);
  });

  async function createTestWine(
    confirmProcessCleanup?: (request: {
      kind: "kill-stale" | "force-kill";
      processes: { pid: string; name: string; command: string }[];
      error?: unknown;
    }) => Promise<boolean>
  ) {
    return await createWine({
      prefix: "/tmp/yaaglm-test-prefix",
      distro: {
        id: "test-wine",
        displayName: "Test Wine",
        remoteUrl: "https://example.invalid/wine.tar.xz",
        attributes: { renderBackend: "dxmt", winePath: "wine" },
      },
      confirmProcessCleanup,
    });
  }

  it("fails only the task when stale process cleanup is declined", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(exec2).mockReturnValueOnce(new Promise(() => undefined));
      vi.mocked(exec).mockRejectedValueOnce(new Error("ps failed"));
      const confirm = vi.fn(async () => false);
      const wine = await createTestWine(confirm);

      const pending = wine.waitUntilServerOff(10);
      const rejection = expect(pending).rejects.toBeInstanceOf(TaskFailedError);
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
      expect(confirm).toHaveBeenCalledWith({
        kind: "kill-stale",
        processes: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("force-kills after a second confirmation and continues", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(exec2)
        .mockReturnValueOnce(new Promise(() => undefined))
        .mockReturnValueOnce(new Promise(() => undefined))
        .mockResolvedValueOnce({
          exitCode: 0,
          stdOut: "",
          stdErr: "",
        } as never);
      const confirm = vi.fn(
        async (_request: { kind: "kill-stale" | "force-kill" }) => true
      );
      const wine = await createTestWine(confirm);

      const pending = wine.waitUntilServerOff(10);
      const resolution = expect(pending).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(30);

      await resolution;
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm.mock.calls.map(call => call[0].kind)).toEqual([
        "kill-stale",
        "force-kill",
      ]);
      expect(exec).toHaveBeenCalledWith(
        [expect.stringContaining("wineserver"), "-k", "-9"],
        expect.any(Object),
        false,
        "/dev/null"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the task when the force-kill confirmation is declined", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(exec2)
        .mockReturnValueOnce(new Promise(() => undefined))
        .mockReturnValueOnce(new Promise(() => undefined));
      const confirm = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const wine = await createTestWine(confirm);

      const pending = wine.waitUntilServerOff(10);
      const rejection = expect(pending).rejects.toBeInstanceOf(TaskFailedError);
      await vi.advanceTimersByTimeAsync(30);

      await rejection;
      await expect(pending).rejects.toThrow(
        "User declined to force-kill stale wine processes"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a task failure when the server survives the forced kill", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(exec2).mockReturnValue(new Promise(() => undefined));
      const confirm = vi.fn(async () => true);
      const wine = await createTestWine(confirm);

      const pending = wine.waitUntilServerOff(10);
      const rejection = expect(pending).rejects.toBeInstanceOf(TaskFailedError);
      await vi.advanceTimersByTimeAsync(40);

      await rejection;
      await expect(pending).rejects.toThrow("did not exit after force kill");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns an empty process list when ps fails", async () => {
    vi.mocked(exec2).mockRejectedValueOnce(new Error("ps failed"));
    const wine = await createTestWine();
    const monitor = wine.createGameProcessMonitor("game.exe");
    await expect(monitor.listProcesses()).resolves.toEqual([]);
  });
});
