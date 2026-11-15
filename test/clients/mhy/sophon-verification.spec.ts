import { beforeEach, expect, it, vi } from "vitest";
import type { Server } from "@constants";
import type { Locale } from "@locale";
import { createSophonGame } from "@src/clients/mhy/sophon-game";
import { getSophonClient } from "@src/integrations/sophon-sidecar";
import type { SophonInstallOptionsMetadata } from "@src/integrations/sophon-install-options";

vi.mock("@src/integrations/sophon-sidecar", () => ({
  getSophonClient: vi.fn(),
}));
vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: async () => false,
  writeFile: async () => undefined,
}));
vi.mock("@runtime/macos-filesystem", () => ({
  mkdirp: async () => undefined,
}));

const directory = "/games/alternate";
const catalog: SophonInstallOptionsMetadata = {
  version: "2.1.0",
  modes: [
    { mode: "base", size: 200 },
    { mode: "full", size: 400 },
  ],
  voicePacks: [
    { id: "ja-jp", size: 25 },
    { id: "en-us", size: 30 },
  ],
  installedVoicePacks: ["ja-jp"],
  resumeUpdate: true,
};
const sophon = {
  getInstallOptions: vi.fn(async () => catalog),
  startUpdate: vi.fn(async () => "resume-update"),
  startRepair: vi.fn(async () => "verify"),
  streamOperationProgress: vi.fn(async function* () {}),
};
const game = createSophonGame(
  { id: "nap_global", channel_id: 1, subchannel_id: 0, cps: "test" } as Server,
  {} as Locale,
  {
    namespace: "nap",
    getKey: async () => "",
    getKeyOrDefault: async (_key, fallback) => fallback,
    setKey: async () => undefined,
  },
  "nap"
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSophonClient).mockResolvedValue(
    sophon as unknown as Awaited<ReturnType<typeof getSophonClient>>
  );
});

it("finishes a pending update before checking the selected resources and preserving installed voices", async () => {
  await expect(game.integrityOptions(directory)).resolves.toBe(catalog);
  const commands = [];
  for await (const command of game.repair(directory, "2.0.0", {
    version: "2.1.0",
    mode: "base",
    voicePacks: ["en-us"],
  }))
    commands.push(command);

  expect(sophon.getInstallOptions).toHaveBeenCalledWith(
    "nap",
    directory,
    "verify"
  );
  expect(sophon.startUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ gamedir: directory, installedVersion: "2.0.0" }),
    "nap"
  );
  expect(sophon.startRepair).toHaveBeenCalledWith(
    expect.objectContaining({
      gamedir: directory,
      selection: {
        version: "2.1.0",
        mode: "base",
        voicePacks: ["ja-jp", "en-us"],
      },
    }),
    "nap"
  );
  expect(sophon.startUpdate.mock.invocationCallOrder[0]).toBeLessThan(
    sophon.startRepair.mock.invocationCallOrder[0]
  );
  expect(commands.map(([, state]) => state)).toEqual([
    "UPDATING",
    "SCANNING_FILES",
  ]);
});

it("does not change files when the resource catalog version changed", async () => {
  await expect(
    game
      .repair(directory, undefined, {
        version: "2.0.0",
        mode: "full",
        voicePacks: ["en-us"],
      })
      .next()
  ).rejects.toThrow("Installation options changed");
  expect(sophon.startUpdate).not.toHaveBeenCalled();
  expect(sophon.startRepair).not.toHaveBeenCalled();
});
