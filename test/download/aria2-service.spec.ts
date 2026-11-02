import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aria2", () => ({ createAria2Retry: vi.fn() }));
vi.mock("@logging/logger", () => ({ log: vi.fn() }));
vi.mock("@platform/neutralino/filesystem", () => ({ appendFile: vi.fn() }));
vi.mock("@platform/neutralino/path", () => ({
  resolve: (path: string) => path,
}));
vi.mock("@platform/neutralino/sidecar", () => ({
  resolveSidecarPath: vi.fn(async () => "/sidecar/aria2c"),
}));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn(), spawn: vi.fn() }));
vi.mock("@runtime/lifecycle", () => ({ addTerminationHook: vi.fn() }));
vi.mock("@runtime/async", () => ({
  timeout: vi.fn(() => new Promise(() => undefined)),
}));

import { createAria2Retry } from "@aria2";
import { exec, spawn } from "@runtime/command-runner";
import { appendFile } from "@platform/neutralino/filesystem";
import { addTerminationHook } from "@runtime/lifecycle";
import { startAria2Service } from "@download/aria2-service";

const aria2 = { version: { version: "1.0" } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAria2Retry).mockReset();
  vi.spyOn(Date, "now").mockReturnValue(1000);
  vi.mocked(exec).mockResolvedValue({ stdOut: "900\n" } as never);
  vi.mocked(spawn).mockResolvedValue({ pid: 123 } as never);
  vi.mocked(createAria2Retry).mockResolvedValue(aria2 as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("aria2 sidecar startup", () => {
  it("starts an authenticated process with an owned session and shutdown hook", async () => {
    await expect(
      startAria2Service({
        port: 41000,
        binaryPath: "/aria2",
        sessionPath: "/session",
      })
    ).resolves.toBe(aria2);
    expect(appendFile).toHaveBeenCalledWith("/session", "");
    expect(spawn).toHaveBeenCalledWith(
      expect.arrayContaining([
        "/aria2",
        "--rpc-listen-port=41000",
        "--rpc-secret",
        "--stop-with-process",
        "900",
      ])
    );
    expect(createAria2Retry).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 41000,
      secret: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    const shutdown = vi.mocked(addTerminationHook).mock.lastCall![0];
    await expect(shutdown(false)).resolves.toBe(true);
    expect(exec).toHaveBeenLastCalledWith(["kill", "123"]);
  });
  it("uses a random port within the aria2 pool", async () => {
    await startAria2Service({ binaryPath: "/aria2" });
    const port = vi.mocked(createAria2Retry).mock.lastCall![0].port;
    expect(port).toBeGreaterThanOrEqual(40000);
    expect(port).toBeLessThanOrEqual(49999);
  });
  it("kills a failed process and retains only the replacement for shutdown", async () => {
    vi.mocked(createAria2Retry)
      .mockRejectedValueOnce(new Error("port busy"))
      .mockResolvedValueOnce(aria2 as never);
    vi.mocked(spawn)
      .mockResolvedValueOnce({ pid: 123 } as never)
      .mockResolvedValueOnce({ pid: 456 } as never);
    await startAria2Service({ binaryPath: "/aria2" });
    expect(exec).toHaveBeenCalledWith(["kill", "123"]);
    const shutdown = vi.mocked(addTerminationHook).mock.lastCall![0];
    await shutdown(false);
    expect(exec).toHaveBeenLastCalledWith(["kill", "456"]);
  });
  it("rejects startup after its deadline instead of looping forever", async () => {
    vi.mocked(Date.now)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValue(20000);
    vi.mocked(createAria2Retry).mockRejectedValue(new Error("offline"));
    await expect(
      startAria2Service({ binaryPath: "/aria2", startupTimeoutMs: 100 })
    ).rejects.toThrow("Failed to start download service");
  });
  it("does not fail shutdown if the process has already exited", async () => {
    await startAria2Service({ binaryPath: "/aria2" });
    vi.mocked(exec).mockRejectedValue(new Error("already exited"));
    await expect(
      vi.mocked(addTerminationHook).mock.lastCall![0](false)
    ).resolves.toBe(true);
  });
});
