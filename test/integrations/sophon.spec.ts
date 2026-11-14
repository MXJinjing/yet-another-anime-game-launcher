import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getActiveStorageNamespace: () => "test",
  getKeyOrDefault: async (_key: string, fallback: string) => fallback,
}));

vi.mock("@logging/logger", () => ({ log: vi.fn() }));
vi.mock("@download/stream-scheduler", () => ({
  registerStream: vi.fn(),
  unregisterStream: vi.fn(),
  updateStream: vi.fn(),
}));
vi.mock("@download/control", () => ({
  beginControlledDownload: vi.fn(),
  DownloadCancelledError: class extends Error {},
  endControlledDownload: vi.fn(),
}));

import { SophonClient } from "@sophon";
import { ConnectionError } from "../../src/services/connection-error";
import {
  registerStream,
  unregisterStream,
  updateStream,
} from "@download/stream-scheduler";
import { DownloadCancelledError } from "@download/control";

function mockRPC(
  results: Record<string, unknown | ((params: unknown) => unknown)>
) {
  const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const value = results[request.method];
    const result = typeof value === "function" ? value(request.params) : value;
    return {
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: request.id, result }),
    };
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

describe("Swift Sophon RPC", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("passes the exact origin token and version for predownload and update", async () => {
    const requests = mockRPC({ "update.start": { operationID: "task" } });
    const client = new SophonClient("127.0.0.1", 6969, "cn", "token");
    for (const predownload of [true, false]) {
      await expect(
        client.startUpdate(
          {
            gamedir: "/games/test",
            game_type: "hk4e",
            tempdir: "/games/test/.tmp",
            predownload,
            installedVersion: "1.0.0",
          },
          "game"
        )
      ).resolves.toEqual("task");
      const request = requests.mock.calls[requests.mock.calls.length - 1];
      expect(request[0]).toEqual("http://127.0.0.1:6969/rpc");
      expect(request[1].headers).toMatchObject({
        Authorization: "Bearer token",
      });
      expect(JSON.parse(String(request[1].body))).toMatchObject({
        method: "update.start",
        params: {
          game: "hk4e_cn",
          sourceVersion: "1.0.0",
          predownload,
          cacheOnly: predownload,
          transfer: { predownloadDirectory: "/games/test/.tmp/swift" },
        },
      });
    }
    expect(registerStream).toHaveBeenCalledWith(
      expect.objectContaining({ key: "game", canPause: true })
    );
  });

  it("lists and downloads explicit files for the selected region", async () => {
    const list = vi.fn(() => ({ version: "1.2.3", total: 1, files: [] }));
    const download = vi.fn(() => ({ operationID: "selected" }));
    mockRPC({ "files.list": list, "files.download": download });
    const client = new SophonClient("127.0.0.1", 6969, "bb");
    await expect(
      client.listFiles({ version: "1.2.3", path: "data", limit: 10 })
    ).resolves.toMatchObject({ total: 1 });
    expect(list).toHaveBeenCalledWith({
      game: "T2S0Gz4Dr2",
      region: "bb",
      version: "1.2.3",
      path: "data",
      limit: 10,
    });
    await expect(
      client.downloadFiles("/games/test", "1.2.3", ["data/a"])
    ).resolves.toBe("selected");
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ files: ["data/a"], categories: ["game"] })
    );
  });

  it("maps Swift verification and payload progress before resolving completion", async () => {
    let count = 0;
    mockRPC({
      "operation.status": () => {
        count++;
        if (count === 3) return { status: "completed" };
        return {
          status: "running",
          progress: {
            phase: count === 1 ? "scanning" : "running",
            metrics: {
              common: {
                network: { completed: 25, total: 100, rate: 10 },
                files: { completed: 0, total: 5 },
                write: { completed: 0, total: 100 },
                timing: { elapsedSeconds: 2 },
                resources: {
                  downloads: [
                    { id: "chunk", totalBytes: 100, receivedBytes: 25 },
                  ],
                },
              },
              verification: { files: { completed: 2, total: 5 } },
            },
          },
        };
      },
    });
    const iterator = new SophonClient("127.0.0.1").streamOperationProgress(
      "task"
    );
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "job_start" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "processing_progress" },
    });
    expect(updateStream).toHaveBeenLastCalledWith(
      "sophon:task",
      expect.objectContaining({
        phaseKind: "verifying",
        progress: 40,
        speed: 0,
      })
    );
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "chunk_progress" },
    });
    expect(updateStream).toHaveBeenLastCalledWith(
      "sophon:task",
      expect.objectContaining({
        phaseKind: "transferring",
        progress: 25,
        speed: 10,
      })
    );
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "job_end" },
    });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    expect(unregisterStream).toHaveBeenCalledWith("sophon:task");
  });

  it("reports early cancellation and clears the download stream", async () => {
    mockRPC({ "operation.status": { status: "cancelled" } });
    const iterator = new SophonClient("127.0.0.1").streamOperationProgress(
      "task"
    );
    await iterator.next();
    await expect(iterator.next()).rejects.toBeInstanceOf(
      DownloadCancelledError
    );
    expect(unregisterStream).toHaveBeenCalledWith("sophon:task");
  });

  it("reports a disconnected sidecar and clears the download stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const iterator = new SophonClient("127.0.0.1").streamOperationProgress(
      "task"
    );
    await iterator.next();
    await expect(iterator.next()).rejects.toBeInstanceOf(ConnectionError);
    expect(unregisterStream).toHaveBeenCalledWith("sophon:task");
  });

  it("sends pause, resume, rate and cancellation for the same task", async () => {
    const pause = vi.fn(() => true);
    const resume = vi.fn(() => true);
    const limit = vi.fn(() => true);
    const cancel = vi.fn(() => true);
    mockRPC({
      "operation.pause": pause,
      "operation.resume": resume,
      "operation.limit": limit,
      "operation.cancel": cancel,
    });
    const client = new SophonClient("127.0.0.1");
    await client.pauseOperation("task");
    await client.resumeOperation("task");
    await client.setDownloadSpeedLimit(128, "task");
    await client.cancelOperation("task");
    for (const control of [pause, resume, cancel]) {
      expect(control).toHaveBeenCalledWith({ operationID: "task" });
    }
    expect(limit).toHaveBeenCalledWith({
      operationID: "task",
      bytesPerSecond: 128,
    });
  });
});
