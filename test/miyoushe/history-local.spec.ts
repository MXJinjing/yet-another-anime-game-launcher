import { afterEach, expect, it, vi } from "vitest";
import {
  createMiyousheSessionHelper,
  type RequestMiyousheHelper,
} from "../../src/miyoushe/local";
import {
  onSpawnedProcess,
  spawnProcess,
  updateSpawnedProcess,
} from "@platform/neutralino";
import {
  readAccountWishHistory,
  readGameHistory,
} from "../../src/miyoushe/history-local";

vi.mock("@src/clients/game-data-paths", () => ({
  getGameUserDataFolder: () => "Game Data",
}));

vi.mock("@platform/neutralino", () => ({
  readDirectory: async () => [
    { entry: "Test User", type: "DIRECTORY" },
    { entry: "Public", type: "DIRECTORY" },
  ],
  resolve: (path: string) => path,
  resolveResource: (path: string) => "/" + path,
  onSpawnedProcess: vi.fn(),
  offSpawnedProcess: async () => undefined,
  spawnProcess: vi.fn(async () => ({ id: 7, pid: 25 })),
  updateSpawnedProcess: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const uid = "100000001";
const heads = { "301": "123" };
const accountId = "0bc26315-d43b-404e-8bf2-31788b9a7ea1";
const history = { uid, list: [] };
const direct = { state: "ok", source: "remote", history };

it("starts a memory-only account process and accepts a split reply", async () => {
  let emit: Neutralino.events.Handler<Neutralino.os.SpawnProcessResult>;
  vi.mocked(onSpawnedProcess).mockImplementation(async handler => {
    emit = handler;
  });
  vi.mocked(updateSpawnedProcess).mockImplementation(async (_id, action) => {
    if (action !== "stdIn") return;
    const reply = JSON.stringify(direct) + "\n";
    for (const data of [reply.slice(0, 10), reply.slice(10)])
      emit({
        detail: { id: 7, pid: 25, action: "stdOut", data },
      } as CustomEvent<Neutralino.os.SpawnProcessResult>);
  });

  const helper = createMiyousheSessionHelper(() => undefined);
  try {
    await expect(
      readAccountWishHistory(helper.request, accountId, uid, heads)
    ).resolves.toEqual(direct);
    expect(spawnProcess).toHaveBeenCalledWith(
      "exec /sidecar/miyoushe-prototype session"
    );
    const [, , input] = vi.mocked(updateSpawnedProcess).mock.calls[0];
    expect(JSON.parse(input!)).toEqual({
      action: "wish-history",
      args: [],
      input: JSON.stringify({ accountId, uid, heads }),
    });
  } finally {
    helper.close();
  }
});

it.each([
  "manual",
  "limited",
  "account-authorization-expired",
  "network",
] as const)(
  "keeps the account operation on the chosen source after %s",
  async state => {
    const account = vi.fn(async () => ({ state }));
    const execCommand = vi.fn();
    vi.stubGlobal("Neutralino", { os: { execCommand } });
    await expect(
      readAccountWishHistory(account as RequestMiyousheHelper, accountId, uid)
    ).resolves.toEqual({ state });
    expect(account).toHaveBeenCalledOnce();
    expect(execCommand).not.toHaveBeenCalled();
  }
);

it("reads only configured game cache paths and sends no account session", async () => {
  const cached = { state: "ok", source: "cache", history };
  const execCommand = vi.fn(
    async (_command: string, _options: { stdIn: string }) => ({
      exitCode: 0,
      stdOut: JSON.stringify(cached),
    })
  );
  vi.stubGlobal("Neutralino", { os: { execCommand } });

  await expect(
    readGameHistory("/game", "/wine", { [uid]: heads })
  ).resolves.toEqual(cached);
  const [[command, input]] = execCommand.mock.calls;
  expect(command).toBe("/sidecar/miyoushe-history");
  expect(JSON.parse(input.stdIn)).toEqual({
    install: "/game",
    directories: ["/wine/drive_c/users/Test User/AppData/LocalLow/Game Data"],
    headsByUid: { [uid]: heads },
  });
});
