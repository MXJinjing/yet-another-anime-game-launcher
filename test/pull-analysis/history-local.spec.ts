import { afterEach, expect, it, vi } from "vitest";
import { readDirectory, resolveSidecarPath } from "@platform/neutralino";
import { readGameHistory } from "../../src/pull-analysis/history-local";

vi.mock("@src/clients/game-data-paths", () => ({
  getGameUserDataFolder: () => "Company/Client",
}));
vi.mock("@platform/neutralino", () => ({
  readDirectory: vi.fn(),
  resolve: (path: string) => path,
  resolveSidecarPath: vi.fn(),
}));

const execCommand = vi.fn();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("passes only the configured local cache locations to the offline helper", async () => {
  vi.stubGlobal("Neutralino", { os: { execCommand } });
  vi.mocked(resolveSidecarPath).mockResolvedValue(
    "/sidecar/arm64/wish-history"
  );
  vi.mocked(readDirectory).mockResolvedValue([
    { entry: "runner", type: "DIRECTORY" },
    { entry: "Public", type: "DIRECTORY" },
    { entry: "note.txt", type: "FILE" },
  ]);
  execCommand.mockResolvedValue({
    exitCode: 0,
    stdOut: JSON.stringify({ state: "no-history" }),
  });

  expect(await readGameHistory("/Game Files", "Client.exe", "/wine")).toEqual({
    state: "no-history",
  });
  expect(resolveSidecarPath).toHaveBeenCalledWith("wish-history");
  const [, { stdIn }] = execCommand.mock.calls[0];
  expect(JSON.parse(stdIn)).toEqual({
    installCache: "/Game Files/Client_Data/webCaches",
    directories: ["/wine/drive_c/users/runner/AppData/LocalLow/Company/Client"],
  });
});

it("returns unavailable when the native helper fails", async () => {
  vi.stubGlobal("Neutralino", { os: { execCommand } });
  vi.mocked(resolveSidecarPath).mockResolvedValue(
    "/sidecar/arm64/wish-history"
  );
  execCommand.mockResolvedValue({ exitCode: 1, stdOut: "" });
  expect(await readGameHistory(undefined, undefined, undefined)).toEqual({
    state: "unavailable",
  });
});
