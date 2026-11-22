import { expect, it, vi } from "vitest";

vi.mock("solid-js/web", async () => ({
  ...(await vi.importActual<object>("solid-js/web")),
  delegateEvents: () => undefined,
}));

vi.mock("@logging/logger", () => ({ log: vi.fn() }));
vi.mock("@wine/runtime-resources", () => ({
  isDXMTInstalled: async () => true,
}));
vi.mock("@src/clients/mhy/unity", () => ({
  getGameVersion: async () => "1.0.0",
  getGameVersionWithFallback: async () => "1.0.0",
}));
vi.mock("@src/clients/mhy/hyp-connect", () => ({
  getLatestLauncherContent: async () => {
    throw new Error("Use fallback background");
  },
}));
vi.mock("@src/clients/mhy/sophon-game", async () => {
  const actual = await vi.importActual<
    typeof import("@src/clients/mhy/sophon-game")
  >("@src/clients/mhy/sophon-game");
  return {
    ...actual,
    createSophonGame: () => ({
      online: async () => ({
        version: "1.0.0",
        pre_download: true,
        pre_download_version: "1.1.0",
      }),
      async *predownload() {
        throw new Error("Transfer failed");
      },
    }),
  };
});

import { createHK4EChannelClient } from "@src/clients/mhy/hk4e";

it("keeps predownload available after a transfer fails", async () => {
  const game = await createHK4EChannelClient({
    server: { dataDir: "data" } as never,
    locale: { alert: async () => undefined } as never,
    aria2: {} as never,
    wine: {} as never,
    releaseType: "os",
    storage: {
      getKey: async () => "/test/game",
      getKeyOrDefault: async (_key, fallback) => fallback,
      setKey: async () => undefined,
    },
  });
  expect(game.showPredownloadPrompt()).toBe(true);
  await expect(game.predownload().next()).rejects.toThrow("Transfer failed");
  expect(game.predownloadVersion()).toBe("1.1.0");
  expect(game.showPredownloadPrompt()).toBe(true);
});
