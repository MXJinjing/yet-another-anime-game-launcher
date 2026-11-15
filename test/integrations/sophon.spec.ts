import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getActiveStorageNamespace: () => "test",
  getKeyOrDefault: vi.fn(async (_key: string, fallback: string) => fallback),
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
import { getKeyOrDefault } from "@runtime/storage";
import { ConnectionError } from "../../src/services/connection-error";
import {
  registerStream,
  unregisterStream,
  updateStream,
} from "@download/stream-scheduler";
import { DownloadCancelledError } from "@download/control";
import { TaskFailedError } from "@tasks/task-program";

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
    vi.mocked(getKeyOrDefault).mockImplementation(
      async (_key, fallback) => fallback
    );
  });

  it("treats a failed predownload as retryable without closing the launcher", async () => {
    mockRPC({
      "update.start": { operationID: "task" },
      "operation.status": { status: "failed", error: "Download failed" },
    });
    const client = new SophonClient("127.0.0.1", 6969);
    const task = await client.startUpdate({
      gamedir: "/games/test",
      game_type: "hk4e",
      predownload: true,
    });
    const events = client.streamOperationProgress(task);
    await events.next();
    await expect(events.next()).resolves.toMatchObject({
      value: { type: "error", error: "Download failed" },
    });
    await expect(events.next()).rejects.toBeInstanceOf(TaskFailedError);
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

  it.each([
    ["hk4e", "cn", "hk4e_cn"],
    ["hk4e", "os", "hk4e_global"],
    ["hkrpg", "cn", "hkrpg_cn"],
    ["hkrpg", "os", "hkrpg_global"],
    ["nap", "cn", "nap_cn"],
    ["nap", "os", "nap_global"],
  ] as const)(
    "routes %s %s through the same Swift operation API",
    async (game, region, biz) => {
      const requests = mockRPC({
        "install.start": { operationID: "install" },
        "update.start": { operationID: "update" },
        "repair.start": { operationID: "repair" },
        "game.online": {
          version: "1.2.3",
          installSize: 100,
          updatableVersions: ["1.2.2"],
          predownloadVersion: "1.2.4",
          predownloadFrom: null,
          needsResume: true,
        },
      });
      const client = new SophonClient("127.0.0.1", 6969, region);
      const options = {
        gamedir: "/games/example",
        game_type: game,
        installedVersion: "1.2.3",
      };
      await expect(
        client.getLatestOnlineGameInfo(region, game, options.gamedir)
      ).resolves.toMatchObject({
        pre_download: true,
        pre_download_version: "1.2.4",
        needs_resume: true,
      });
      await client.startInstallation(
        { ...options, install_reltype: region },
        "game-key"
      );
      await client.startUpdate({ ...options, predownload: false }, "game-key");
      await client.startUpdate(
        { ...options, predownload: true, targetVersion: "1.2.4" },
        "game-key"
      );
      await client.startRepair(
        { ...options, repair_mode: "reliable" },
        "game-key"
      );
      const requestsSent = requests.mock.calls.map(([, init]) =>
        JSON.parse(String(init.body))
      );
      expect(requestsSent.map(r => r.method)).toEqual([
        "game.online",
        "install.start",
        "update.start",
        "update.start",
        "repair.start",
      ]);
      for (const request of requestsSent) {
        expect(request.params).toMatchObject({
          game: biz,
          region,
          directory: options.gamedir,
        });
      }
      for (const request of requestsSent.slice(1)) {
        expect(request.params).toMatchObject({
          resolveAction: true,
          transfer: { predownloadDirectory: "/games/example/.tmp/swift" },
        });
      }
      expect(requestsSent[2].params).toMatchObject({
        predownload: false,
        cacheOnly: false,
        sourceVersion: "1.2.3",
      });
      expect(requestsSent[3].params).toMatchObject({
        predownload: true,
        cacheOnly: true,
        targetVersion: "1.2.4",
      });
      expect(registerStream).toHaveBeenCalledTimes(4);
    }
  );

  it("loads the regional catalog, resumes a saved selection, and sends it to the queue", async () => {
    const catalog = {
      game: { id: "regional-game" },
      tag: "1.2.3",
    };
    const metadataRPC = {
      "api.configs": {
        launch_configs: [{ game: catalog.game, enable_scenario_pkg: true }],
      },
      "api.branches": {
        game_branches: [
          {
            game: catalog.game,
            main: {
              tag: catalog.tag,
              categories: [
                {
                  type: "CATEGORY_TYPE_RESOURCE",
                  matching_field: "game",
                  scenarios: [
                    "CATEGORY_SCENARIO_FULL",
                    "CATEGORY_SCENARIO_BASE",
                  ],
                },
                {
                  type: "CATEGORY_TYPE_AUDIO",
                  matching_field: "ja-jp",
                  scenarios: [],
                },
              ],
            },
          },
        ],
      },
      "api.sophonBuild": {
        tag: catalog.tag,
        manifests: [
          {
            matching_field: "game",
            stats: { compressed_size: 100, uncompressed_size: 200 },
          },
          {
            matching_field: "ja-jp",
            stats: { compressed_size: 5, uncompressed_size: 20 },
          },
        ],
      },
      "game.nextAction": {
        action: "resumeInstall",
        targetVersion: catalog.tag,
        mode: "CATEGORY_SCENARIO_BASE",
        voicePacks: ["ja-jp"],
      },
    };
    const requests = mockRPC({
      ...metadataRPC,
      "install.start": { operationID: "catalog-install" },
    });
    const client = new SophonClient("127.0.0.1", 6969, "bb");
    const options = await client.getInstallOptions("hk4e", "/games/bb");
    expect(options.resume).toEqual({
      mode: "base",
      version: "1.2.3",
      voicePacks: ["ja-jp"],
    });
    for (const [, init] of requests.mock.calls) {
      expect(JSON.parse(String(init.body)).params).toMatchObject({
        game: "T2S0Gz4Dr2",
        region: "bb",
        cn: true,
      });
    }
    await client.startInstallation(
      {
        game_type: "hk4e",
        gamedir: "/games/bb",
        install_reltype: "bb",
        selection: options.resume,
      },
      "game"
    );
    const request = requests.mock.calls.at(-1);
    expect(JSON.parse(String(request?.[1].body))).toMatchObject({
      method: "install.start",
      params: { mode: "base", voicePacks: ["ja-jp"], targetVersion: "1.2.3" },
    });
    expect(registerStream).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "game",
        sophonActivity: expect.objectContaining({
          id: "catalog-install",
          targetVersion: "1.2.3",
        }),
      })
    );

    const verifyRequests = mockRPC({
      ...metadataRPC,
      "game.nextAction": {
        action: "resumeUpdate",
        cacheOnly: false,
        sourceVersion: "1.2.2",
        targetVersion: "1.2.3",
        voicePacks: ["ja-jp"],
      },
      "install.start": { operationID: "verify-selected" },
    });
    const verification = await client.getInstallOptions(
      "hk4e",
      "/games/alternate",
      "verify"
    );
    expect(verification).toMatchObject({
      installedVoicePacks: ["ja-jp"],
      resumeUpdate: true,
    });
    expect(verification.resume).toBeUndefined();
    expect(
      JSON.parse(String(verifyRequests.mock.calls.at(-1)?.[1].body))
    ).toMatchObject({
      method: "game.nextAction",
      params: { directory: "/games/alternate" },
    });
    await client.startRepair(
      {
        game_type: "hk4e",
        gamedir: "/games/alternate",
        repair_mode: "reliable",
        selection: {
          mode: "base",
          voicePacks: ["ja-jp", "en-us"],
          version: "1.2.3",
        },
      },
      "game"
    );
    expect(
      JSON.parse(String(verifyRequests.mock.calls.at(-1)?.[1].body))
    ).toMatchObject({
      method: "install.start",
      params: {
        directory: "/games/alternate",
        mode: "base",
        voicePacks: ["ja-jp", "en-us"],
        targetVersion: "1.2.3",
        quickVerify: false,
        transfer: { preserveState: false },
      },
    });
    expect(registerStream).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phaseKind: "verifying",
        sophonActivity: expect.objectContaining({ kind: "repair" }),
      })
    );

    mockRPC({
      ...metadataRPC,
      "game.nextAction": {
        action: "none",
        sourceVersion: "1.2.4",
        targetVersion: "1.2.4",
        voicePacks: [],
      },
    });
    await expect(
      client.getInstallOptions("hk4e", "/games/alternate", "verify")
    ).rejects.toThrow("The installed version is newer");
  });

  it("snapshots transfer settings at each start without changing the shared speed limit", async () => {
    let writes = 5;
    vi.mocked(getKeyOrDefault).mockImplementation(async (key, fallback) => {
      if (key === "config_sophon")
        return JSON.stringify({
          writes,
          checks: 2,
          postProcessors: 3,
          memoryMiB: 64,
        });
      return fallback;
    });
    const rpc = vi.fn(() => ({ operationID: "repair" }));
    mockRPC({ "repair.start": rpc });
    const client = new SophonClient("127.0.0.1");
    const options = {
      gamedir: "/game",
      game_type: "nap",
      repair_mode: "quick",
    } as const;
    await client.startRepair(options);
    writes = 2;
    await client.startRepair(options);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        writes: 5,
        checks: 2,
        postProcessors: 3,
        bytesPerSecond: 0,
        transfer: expect.objectContaining({ memoryLimit: 64 * 1024 ** 2 }),
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ writes: 2 })
    );
  });

  it("uses the shared proxy for remote operations and reloads the setting for new requests", async () => {
    const settings: Record<string, string> = {
      config_downloadProxyEnabled: "true",
      config_downloadProxyHost: "  proxy.example:8080  ",
    };
    vi.mocked(getKeyOrDefault).mockImplementation(
      async (key, fallback) => settings[key] ?? fallback
    );
    const requests = mockRPC({
      "game.online": {
        version: "1.2.3",
        installSize: 42,
        updatableVersions: [],
      },
      "files.list": { files: [] },
      "install.start": { operationID: "install" },
      "repair.start": { operationID: "repair" },
      "update.start": { operationID: "update" },
      "files.download": { operationID: "download" },
      "operation.pause": true,
      "rpc.discover": { methods: ["files.download", "game.online"] },
    });
    const client = new SophonClient("127.0.0.1", 6969, "cn");
    const options = { gamedir: "/games/test", game_type: "hk4e" as const };
    await client.getLatestOnlineGameInfo("cn", "hk4e");
    await client.listFiles({ version: "1.2.3" });
    await client.startInstallation({ ...options, install_reltype: "cn" });
    await client.startRepair({ ...options, repair_mode: "reliable" });
    await client.startUpdate({ ...options, predownload: true });
    await client.downloadFiles(options.gamedir, "1.2.3", ["file"]);
    await client.pauseOperation("install");
    await client.healthCheck();
    settings.config_downloadProxyHost = "http://other.example:6789";
    await client.listFiles({ version: "1.2.3" });
    settings.config_downloadProxyEnabled = "false";
    await client.getLatestOnlineGameInfo("cn", "hk4e");
    settings.config_downloadProxyEnabled = "true";
    settings.config_downloadProxyHost = "  ";
    await client.listFiles({ version: "1.2.3" });

    expect(
      requests.mock.calls.map(([url, init]) => {
        expect(url).toBe("http://127.0.0.1:6969/rpc");
        const { method, params } = JSON.parse(String(init.body));
        return [method, params.httpProxy];
      })
    ).toEqual([
      ["game.online", "http://proxy.example:8080"],
      ["files.list", "http://proxy.example:8080"],
      ["install.start", "http://proxy.example:8080"],
      ["repair.start", "http://proxy.example:8080"],
      ["update.start", "http://proxy.example:8080"],
      ["files.download", "http://proxy.example:8080"],
      ["operation.pause", undefined],
      ["rpc.discover", undefined],
      ["files.list", "http://other.example:6789"],
      ["game.online", undefined],
      ["files.list", undefined],
    ]);
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
