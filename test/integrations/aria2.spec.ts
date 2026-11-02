import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("libaria2-ts", () => ({ WebSocket: { Client: vi.fn() } }));
vi.mock("@runtime/async", () => ({
  wait: vi.fn(async () => undefined),
  timeout: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("@runtime/binary", () => ({ sha256_16: vi.fn(async () => "gid") }));
vi.mock("@runtime/storage", () => ({ getKeyOrDefault: vi.fn() }));
vi.mock("@platform/neutralino", () => ({ fileOrDirExists: vi.fn() }));
vi.mock("@logging/logger", () => ({ log: vi.fn() }));
vi.mock("@download/stream-scheduler", () => ({
  registerStream: vi.fn(),
  unregisterStream: vi.fn(),
  updateStream: vi.fn(),
  pauseStream: vi.fn(),
  resumeStream: vi.fn(),
  cancelStream: vi.fn(),
}));
vi.mock("@download/task-registry", () => ({
  resolveDownloadTaskId: vi.fn(() => "task"),
  updateDownloadTaskOverall: vi.fn(),
}));
vi.mock("@src/integrations/github", () => ({
  applyGithubPrefix: (url: string) => url,
}));

import { WebSocket as RPC } from "libaria2-ts";
import { getKeyOrDefault } from "@runtime/storage";
import { fileOrDirExists } from "@platform/neutralino";
import {
  registerStream,
  unregisterStream,
  updateStream,
} from "@download/stream-scheduler";
import { updateDownloadTaskOverall } from "@download/task-registry";
import { DownloadCancelledError, DownloadFailedError } from "@download/control";
import { Aria2OverallProgress, createAria2, createAria2Retry } from "@aria2";
import type { DownloadStream } from "@download/types";

const rpc = {
  getVersion: vi.fn(),
  shutdown: vi.fn(),
  tellStatus: vi.fn(),
  changeOption: vi.fn(),
  unpause: vi.fn(),
  removeDownloadResult: vi.fn(),
  addUri: vi.fn(),
  forcePause: vi.fn(),
  forceRemove: vi.fn(),
};
const request = {
  uri: "https://example.invalid/file",
  absDst: "/game/file.zip",
  downloadKey: "aria2-test",
};
const status = (state = "active", done = 25n, total = 100n) => ({
  status: state,
  completedLength: done,
  totalLength: total,
  downloadSpeed: 10n,
});
async function collect(iterator: AsyncGenerator<unknown>) {
  const values: unknown[] = [];
  for await (const value of iterator) values.push(value);
  return values;
}
function stream() {
  return vi.mocked(registerStream).mock.lastCall![0] as DownloadStream;
}
async function client() {
  return createAria2({ host: "localhost", port: 40000, secret: "test-secret" });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(rpc)) mock.mockReset();
  rpc.getVersion.mockResolvedValue({ version: "1.0" });
  rpc.tellStatus.mockRejectedValue({ code: 1 });
  vi.mocked(RPC.Client).mockImplementation(() => rpc as never);
  vi.mocked(getKeyOrDefault).mockImplementation(
    async (_key, fallback) => fallback
  );
  vi.mocked(fileOrDirExists).mockResolvedValue(true);
});

describe("aria2 download lifecycle", () => {
  it("uses authenticated RPC and delegates shutdown", async () => {
    const aria2 = await client();
    expect(RPC.Client).toHaveBeenCalledWith({
      host: "localhost",
      port: 40000,
      auth: { secret: "test-secret" },
    });
    await aria2.shutdown();
    expect(rpc.shutdown).toHaveBeenCalledOnce();
  });

  it("starts a missing download, reports progress and cleans up after completion", async () => {
    rpc.tellStatus
      .mockRejectedValueOnce({ code: 1 })
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status("complete"));
    const values = await collect((await client()).doStreamingDownload(request));
    expect(values).toEqual([status()]);
    expect(rpc.addUri).toHaveBeenCalledWith(
      request.uri,
      expect.objectContaining({
        gid: "gid",
        out: request.absDst,
        "allow-overwrite": true,
      })
    );
    expect(updateStream).toHaveBeenCalledWith(
      "aria2:gid",
      expect.objectContaining({ progress: 25, speed: 10, total: 100 })
    );
    expect(unregisterStream).toHaveBeenCalledWith("aria2:gid");
  });

  it.each(["active", "waiting", "paused"])(
    "reuses a %s task",
    async initial => {
      rpc.tellStatus
        .mockResolvedValueOnce(status(initial))
        .mockResolvedValueOnce(status("complete"));
      await collect((await client()).doStreamingDownload(request));
      expect(rpc.changeOption).toHaveBeenCalledWith("gid", {});
      expect(rpc.addUri).not.toHaveBeenCalled();
      expect(rpc.unpause).toHaveBeenCalledTimes(initial === "paused" ? 1 : 0);
    }
  );

  it("skips a complete task only when its destination exists", async () => {
    rpc.tellStatus.mockResolvedValueOnce(status("complete"));
    await expect(
      collect((await client()).doStreamingDownload(request))
    ).resolves.toEqual([]);
    expect(registerStream).not.toHaveBeenCalled();
    vi.mocked(fileOrDirExists).mockResolvedValueOnce(false);
    rpc.tellStatus
      .mockResolvedValueOnce(status("complete"))
      .mockResolvedValueOnce(status("complete"));
    await collect((await client()).doStreamingDownload(request));
    expect(rpc.removeDownloadResult).toHaveBeenCalledWith("gid");
    expect(rpc.addUri).toHaveBeenCalledOnce();
  });

  it.each(["removed", "error"])(
    "restarts an old %s task even if cleanup fails",
    async initial => {
      rpc.tellStatus
        .mockResolvedValueOnce(status(initial))
        .mockResolvedValueOnce(status("complete"));
      rpc.removeDownloadResult.mockRejectedValue(new Error("already removed"));
      await collect((await client()).doStreamingDownload(request));
      expect(rpc.addUri).toHaveBeenCalledOnce();
    }
  );

  it("passes normalized proxy and configured bandwidth to the backend", async () => {
    const settings: Record<string, string> = {
      config_downloadProxyEnabled: "true",
      config_downloadProxyHost: " proxy:8080 ",
      config_downloadSpeedLimitEnabled: "true",
      config_downloadSpeedLimitValue: "2.8",
      config_downloadSpeedLimitUnit: "M",
    };
    vi.mocked(getKeyOrDefault).mockImplementation(
      async (key, fallback) => settings[key] ?? fallback
    );
    rpc.tellStatus
      .mockRejectedValueOnce({ code: 1 })
      .mockResolvedValueOnce(status("complete"));
    await collect((await client()).doStreamingDownload(request));
    expect(rpc.addUri).toHaveBeenCalledWith(
      request.uri,
      expect.objectContaining({
        "all-proxy": "http://proxy:8080",
        "max-download-limit": "2M",
      })
    );
  });

  it("does not swallow connection errors while looking for an existing task", async () => {
    rpc.tellStatus.mockRejectedValueOnce(new Error("connection lost"));
    await expect(
      collect((await client()).doStreamingDownload(request))
    ).rejects.toThrow("connection lost");
    expect(rpc.addUri).not.toHaveBeenCalled();
  });

  it.each(["removed", "error"])(
    "rejects terminal %s states and unregisters the stream",
    async state => {
      rpc.tellStatus.mockRejectedValueOnce({ code: 1 }).mockResolvedValueOnce({
        ...status(state),
        errorCode: 9,
        errorMessage: "disk full",
      });
      const result = collect((await client()).doStreamingDownload(request));
      await expect(result).rejects.toBeInstanceOf(
        state === "removed" ? DownloadCancelledError : DownloadFailedError
      );
      expect(unregisterStream).toHaveBeenCalledWith("aria2:gid");
    }
  );

  it("yields a paused sample once and waits for a known length before active progress", async () => {
    rpc.tellStatus
      .mockRejectedValueOnce({ code: 1 })
      .mockResolvedValueOnce(status("paused"))
      .mockResolvedValueOnce(status("paused"))
      .mockResolvedValueOnce(status("active", 0n, 0n))
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status("complete"));
    await expect(
      collect((await client()).doStreamingDownload(request))
    ).resolves.toEqual([status("paused"), status()]);
  });

  it("supports pause, resume and byte limits on the registered stream", async () => {
    rpc.tellStatus
      .mockRejectedValueOnce({ code: 1 })
      .mockResolvedValueOnce(status());
    const iterator = (await client()).doStreamingDownload(request);
    await iterator.next();
    rpc.tellStatus.mockResolvedValueOnce(status());
    await stream().pause();
    expect(rpc.forcePause).toHaveBeenCalledWith("gid");
    rpc.tellStatus.mockResolvedValueOnce(status("paused"));
    await stream().resume();
    expect(rpc.unpause).toHaveBeenCalledWith("gid");
    await stream().setSpeedLimit(123.9);
    expect(rpc.changeOption).toHaveBeenLastCalledWith("gid", {
      "max-download-limit": "123",
    });
    await iterator.return(undefined);
    expect(unregisterStream).toHaveBeenCalledOnce();
  });

  it("propagates cancellation even if the backend already removed the task", async () => {
    rpc.tellStatus
      .mockRejectedValueOnce({ code: 1 })
      .mockResolvedValueOnce(status());
    const iterator = (await client()).doStreamingDownload(request);
    await iterator.next();
    rpc.forceRemove.mockRejectedValue(new Error("missing"));
    await stream().cancel();
    rpc.tellStatus.mockRejectedValueOnce(new Error("missing"));
    await expect(iterator.next()).rejects.toBeInstanceOf(
      DownloadCancelledError
    );
    expect(unregisterStream).toHaveBeenCalledOnce();
  });

  it("cleans up after unexpected status polling errors", async () => {
    rpc.tellStatus
      .mockRejectedValueOnce({ code: 1 })
      .mockRejectedValueOnce(new Error("network"));
    await expect(
      collect((await client()).doStreamingDownload(request))
    ).rejects.toThrow("network");
    expect(unregisterStream).toHaveBeenCalledOnce();
  });

  it("retries RPC initialization but stops after its retry budget", async () => {
    rpc.getVersion.mockRejectedValueOnce(new Error("not ready"));
    await expect(
      createAria2Retry({ host: "localhost", port: 40000 })
    ).resolves.toHaveProperty("version");
    expect(RPC.Client).toHaveBeenCalledTimes(2);
    vi.mocked(RPC.Client).mockClear();
    rpc.getVersion.mockRejectedValue(new Error("offline"));
    await expect(
      createAria2Retry({ host: "localhost", port: 40000 })
    ).rejects.toThrow("Fail to create aria2 rpc");
    expect(RPC.Client).toHaveBeenCalledTimes(30);
  });
});

describe("aggregate aria2 progress", () => {
  it("preserves completed files with a known grand total", () => {
    const progress = new Aria2OverallProgress(400n, "game");
    expect(progress.step({ completedLength: 50n, totalLength: 100n })).toBe(
      12.5
    );
    progress.finishFile();
    expect(progress.step({ completedLength: 100n, totalLength: 300n })).toBe(
      50
    );
    expect(updateDownloadTaskOverall).toHaveBeenLastCalledWith("task", {
      progress: 50,
      downloaded: 200,
      total: 400,
      totalKnown: true,
    });
  });
  it("discovers totals incrementally and avoids division by zero", () => {
    const progress = new Aria2OverallProgress();
    expect(progress.step({ completedLength: 0n, totalLength: 0n })).toBe(0);
    progress.current({ completedLength: 100n, totalLength: 100n });
    progress.finishFile();
    expect(
      progress.current({ completedLength: 50n, totalLength: 100n })
    ).toEqual({ completed: 150n, total: 200n });
  });
});
