import { afterEach, expect, it, vi } from "vitest";
import { readDirectory, resolveSidecarPath } from "@platform/neutralino";
import { exec2 } from "@runtime/command-runner";
import { readGameHistory } from "../../src/pull-analysis/history-local";

vi.mock("@src/clients/game-data-paths", () => ({
  getGameUserDataFolder: () => "Company/Client",
}));
vi.mock("@platform/neutralino", () => ({
  readDirectory: vi.fn(),
  resolve: (path: string) => path,
  resolveSidecarPath: vi.fn(),
}));

vi.mock("@runtime/command-runner", () => ({ exec2: vi.fn() }));

const run = vi.mocked(exec2);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("passes only the configured local cache locations to the offline helper", async () => {
  vi.mocked(resolveSidecarPath).mockResolvedValue(
    "/sidecar/arm64/wish-history"
  );
  vi.mocked(readDirectory).mockResolvedValue([
    { entry: "runner", type: "DIRECTORY" },
    { entry: "Public", type: "DIRECTORY" },
    { entry: "note.txt", type: "FILE" },
  ]);
  run.mockResolvedValue({
    pid: 1,
    stdErr: "",
    exitCode: 0,
    stdOut: JSON.stringify({ state: "no-history" }),
  });

  expect(await readGameHistory("/Game Files", "Client.exe", "/wine")).toEqual({
    state: "no-history",
  });
  expect(resolveSidecarPath).toHaveBeenCalledWith("wish-history");
  const stdIn = run.mock.calls[0][4]?.stdIn;
  expect(JSON.parse(stdIn ?? "")).toEqual({
    installCache: "/Game Files/Client_Data/webCaches",
    directories: ["/wine/drive_c/users/runner/AppData/LocalLow/Company/Client"],
  });
});

it("returns unavailable when the native helper fails", async () => {
  vi.mocked(resolveSidecarPath).mockResolvedValue(
    "/sidecar/arm64/wish-history"
  );
  run.mockRejectedValue(new Error("Could not start"));
  expect(await readGameHistory(undefined, undefined, undefined)).toEqual({
    state: "unavailable",
  });
});

it("enables game authorization only for an explicit online read", async () => {
  vi.mocked(resolveSidecarPath).mockResolvedValue("/sidecar/wish-history");
  run.mockResolvedValue({
    pid: 1,
    stdErr: "",
    exitCode: 0,
    stdOut: '{"state":"no-history","onlineStatus":"expired"}',
  });

  await expect(
    readGameHistory(undefined, undefined, undefined, true)
  ).resolves.toEqual({ state: "no-history", onlineStatus: "expired" });
  expect(JSON.parse(run.mock.calls[0][4]?.stdIn ?? "")).toEqual({
    directories: [],
    fetchOnline: true,
  });
});

it("streams complete progress events across split output chunks", async () => {
  const progress = vi.fn();
  vi.mocked(resolveSidecarPath).mockResolvedValue("/sidecar/wish-history");
  run.mockImplementation(async (_, __, ___, ____, options) => {
    options?.onStdErr?.('log line\n{"phase":"online","pool":"301",');
    options?.onStdErr?.('"pages":3,"records":60}\n{"phase":"cache"}\n');
    return {
      pid: 1,
      stdErr: "",
      exitCode: 0,
      stdOut: '{"state":"no-history"}',
    };
  });
  await readGameHistory(undefined, undefined, undefined, true, progress);
  expect(progress.mock.calls).toEqual([
    [{ phase: "online", pool: "301", pages: 3, records: 60 }],
    [{ phase: "cache" }],
  ]);
  expect(JSON.parse(run.mock.calls[0][4]?.stdIn ?? "")).toHaveProperty(
    "reportProgress",
    true
  );
});
