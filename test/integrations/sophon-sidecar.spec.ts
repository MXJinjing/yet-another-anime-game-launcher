import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";

vi.mock("@platform/neutralino", () => ({
  spawnProcess: vi.fn(),
  updateSpawnedProcess: vi.fn(),
}));
vi.mock("@src/platform/neutralino/sidecar", () => ({
  resolveSidecarPath: async () => "/test/SophonCLI",
}));
vi.mock("@runtime/command-runner", () => ({
  exec: async () => ({ stdOut: "42" }),
}));
vi.mock("@src/integrations/sophon-settings", () => ({
  readSophonSettings: async () => ({ debugLogging: false }),
}));
vi.mock("@logging/logger", () => ({ log: vi.fn() }));

import { spawnProcess, updateSpawnedProcess } from "@platform/neutralino";
import { getSophonClient } from "@src/integrations/sophon-sidecar";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reuses a healthy Sophon process and shares one restart after a disconnect", async () => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(spawnProcess)
    .mockResolvedValueOnce({ id: 1, pid: 41, action: "stdOut", data: "" })
    .mockResolvedValueOnce({ id: 2, pid: 42, action: "stdOut", data: "" });
  vi.mocked(updateSpawnedProcess).mockResolvedValue(undefined);
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const { id } = JSON.parse(String(init.body));
    return {
      ok: true,
      json: async () => ({
        id,
        jsonrpc: "2.0",
        result: { methods: ["files.download", "game.online"] },
      }),
    };
  });
  vi.stubGlobal("fetch", fetch);

  await getSophonClient("os");
  await getSophonClient("cn");
  expect(spawnProcess).toHaveBeenCalledTimes(1);

  fetch.mockRejectedValueOnce(new Error("Connection refused"));
  await Promise.all([getSophonClient("os"), getSophonClient("cn")]);
  expect(updateSpawnedProcess).toHaveBeenCalledWith(1, "exit");
  expect(spawnProcess).toHaveBeenCalledTimes(2);
});
