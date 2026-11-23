import { afterEach, expect, it, vi } from "vitest";
import { readGameHistory } from "../../src/miyoushe/history-local";

vi.mock("@src/clients/game-data-paths", () => ({
  getGameUserDataFolder: () => "Game Data",
}));

vi.mock("@platform/neutralino", () => ({
  readDirectory: async () => [
    { entry: "Test User", type: "DIRECTORY" },
    { entry: "Public", type: "DIRECTORY" },
  ],
  resolve: (path: string) => path,
  resolveResource: () => "/sidecar/miyoushe-history",
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

it("passes optional scope and sync cursors to the helper on standard input", async () => {
  const execCommand = vi.fn(
    async (_command: string, _options: { stdIn: string }) => ({
      exitCode: 0,
      stdOut: '{"state":"no-history"}',
    })
  );
  vi.stubGlobal("Neutralino", { os: { execCommand } });

  await expect(
    readGameHistory(undefined, "/prefix", {
      mode: "sync",
      uid: "100000001",
      heads: { "301": "123" },
    })
  ).resolves.toEqual({ state: "no-history" });
  await expect(
    readGameHistory("/game's install", undefined, { mode: "authorized" })
  ).resolves.toEqual({ state: "no-history" });

  expect(execCommand.mock.calls.map(([command]) => command)).toEqual([
    "/sidecar/miyoushe-history",
    "/sidecar/miyoushe-history",
  ]);
  const [sync, authorized] = execCommand.mock.calls.map(([, { stdIn }]) =>
    JSON.parse(stdIn)
  );
  expect(sync).toEqual({
    mode: "sync",
    uid: "100000001",
    heads: { "301": "123" },
    directories: ["/prefix/drive_c/users/Test User/AppData/LocalLow/Game Data"],
  });
  expect(authorized).toEqual({
    mode: "authorized",
    install: "/game's install",
    directories: [],
  });
});
