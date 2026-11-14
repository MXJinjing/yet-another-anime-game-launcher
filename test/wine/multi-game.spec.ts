import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => {
  const values = new Map<string, string>();
  return {
    __storage: values,
    getKey: vi.fn(async (key: string) => {
      const value = values.get(key);
      if (value == undefined) throw new Error(`Missing key: ${key}`);
      return value;
    }),
    setKey: vi.fn(async (key: string, value: string | null) => {
      if (value == null) values.delete(key);
      else values.set(key, value);
    }),
  };
});

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/neutralino", () => ({
  resolve: (path: string) => path,
  fileOrDirExists: vi.fn(async () => false),
  removeFileIfExists: vi.fn(async () => undefined),
  stats: vi.fn(async () => ({ isDirectory: true, isFile: false })),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));

import { fileOrDirExists } from "@platform/neutralino";
import { exec } from "@runtime/command-runner";
import type { TaskProgressCommand } from "@tasks/task-program";
import * as runtimeStorage from "@runtime/storage";
import {
  copyMultiGamePrefix,
  createMultiGameWineProxy,
  getMultiGameGameWineEnabled,
  getMultiGameGameWineTag,
  getMultiGamePrefix,
  prepareMultiGameGameWine,
  setMultiGameGameWineTag,
  SHARED_WINE_TAG,
} from "@wine/multi-game";

const storage = (
  runtimeStorage as typeof runtimeStorage & {
    __storage: Map<string, string>;
  }
).__storage;

describe("multi-game Wine", () => {
  beforeEach(() => {
    storage.clear();
    vi.mocked(fileOrDirExists).mockResolvedValue(false);
    vi.mocked(exec).mockResolvedValue({
      stdOut: "logs/wine-initialization.test\n",
      stdErr: "",
      exitCode: 0,
      pid: 1,
    });
  });

  it("migrates legacy Wine keys without leaving a downgrade-unsafe tag", async () => {
    storage.set("yaaglm_zzz_wine_tag", "gptk3-system");
    storage.set("yaaglm_zzz_wine_enabled", "true");

    await expect(getMultiGameGameWineEnabled("zzz")).resolves.toBe(true);
    await expect(getMultiGameGameWineTag("zzz")).resolves.toBe("gptk3-system");

    expect(storage.get("yaaglm_v2_zzz_wine_enabled")).toBe("true");
    expect(storage.get("yaaglm_v2_zzz_wine_tag")).toBe("gptk3-system");
    expect(storage.has("yaaglm_zzz_wine_enabled")).toBe(false);
    expect(storage.has("yaaglm_zzz_wine_tag")).toBe(false);
  });

  it("stores new selections only in versioned Wine keys", async () => {
    await setMultiGameGameWineTag("zzz", "custom-wine-test");

    expect(storage.get("yaaglm_v2_zzz_wine_tag")).toBe("custom-wine-test");
    expect(storage.has("yaaglm_zzz_wine_tag")).toBe(false);
  });

  it("proxies calls to the Wine selected for the current game", async () => {
    const first = { prefix: "/first", killAll: vi.fn(async () => "first") };
    const second = { prefix: "/second", killAll: vi.fn(async () => "second") };
    const ref = { current: first as never };
    const proxy = createMultiGameWineProxy(ref);
    await expect(proxy.killAll()).resolves.toBe("first");
    ref.current = second as never;
    await expect(proxy.killAll()).resolves.toBe("second");
    expect(proxy.prefix).toBe("/second");
  });

  it("gives each game that pins its own Wine a dedicated prefix", () => {
    const zzz = getMultiGamePrefix("/launcher/wineprefix", "napcn");
    const hsr = getMultiGamePrefix("/launcher/wineprefix", "hkrpgcn");
    expect(zzz).not.toBe(hsr);
    expect(zzz).toBe("/launcher/wineprefixes/napcn");
    expect(hsr).toBe("/launcher/wineprefixes/hkrpgcn");
  });

  it("warms up the prefix before persisting a per-game Wine choice", async () => {
    const wine = {
      prefix: "/prefix",
      killAll: vi.fn(async () => undefined),
      waitForWineServerExit: vi.fn(async () => true),
      exec2: vi.fn(async () => ({ exitCode: 0, stdOut: "", stdErr: "" })),
    };
    const program = prepareMultiGameGameWine({
      aria2: {} as never,
      baseWine: wine as never,
      previousWine: wine as never,
      gameId: "zzz",
      wineTag: SHARED_WINE_TAG,
    });
    const states: string[] = [];
    let result: unknown;
    while (true) {
      const step = await program.next();
      if (step.done) {
        result = step.value;
        break;
      }
      const command = step.value as TaskProgressCommand;
      if (command[0] === "setStateText") states.push(command[1]);
    }
    expect(wine.killAll).toHaveBeenCalledOnce();
    expect(wine.waitForWineServerExit).toHaveBeenCalledWith({
      timeoutMs: 5_000,
    });
    expect(wine.exec2).toHaveBeenCalledWith(
      "wineboot",
      [],
      {},
      "logs/wine-initialization.test/1-wineboot.log",
      { timeoutMs: 300_000 }
    );
    expect(wine.exec2).toHaveBeenCalledWith(
      "winecfg",
      ["-v", "win10"],
      {},
      "logs/wine-initialization.test/2-winecfg.log",
      { timeoutMs: 120_000 }
    );
    expect(states).toEqual(["CONFIGURING_ENVIRONMENT", "INSTALL_DONE"]);
    expect(result).toBe(wine);
  });

  it("uses separate logs when preparing Wine environments concurrently", async () => {
    vi.mocked(fileOrDirExists).mockResolvedValue(true);
    let directory = 0;
    vi.mocked(exec).mockImplementation(async ([command]) => ({
      stdOut: command === "/usr/bin/mktemp" ? `logs/run-${++directory}\n` : "",
      stdErr: "",
      exitCode: 0,
      pid: 1,
    }));
    const error = new Error("winecfg timed out");
    const wines = ["/prefix-one", "/prefix-two"].map(prefix => ({
      prefix,
      killAll: vi.fn(async () => undefined),
      waitForWineServerExit: vi.fn(async () => true),
      exec2: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(error),
    }));

    await Promise.all(
      wines.map(async (wine, index) => {
        const program = prepareMultiGameGameWine({
          aria2: {} as never,
          baseWine: wine as never,
          gameId: `game-${index}`,
          wineTag: SHARED_WINE_TAG,
        });
        const directory = `logs/run-${index + 1}`;
        await expect(program.next()).resolves.toMatchObject({ done: false });
        await expect(program.next()).resolves.toMatchObject({ done: false });
        await expect(program.next()).rejects.toMatchObject({
          cause: error,
          message: expect.stringContaining(`${directory}/2-winecfg.log`),
        });
        expect(wine.exec2).toHaveBeenCalledWith(
          "wineboot",
          ["-u"],
          {},
          `${directory}/1-wineboot.log`,
          { timeoutMs: 300_000 }
        );
      })
    );
  });

  it("copies the current prefix once into the per-game location", async () => {
    const exists = vi.fn(async (path: string) => path == "/global/wineprefix");
    const makeDir = vi.fn(async () => undefined);
    const removeDirectory = vi.fn(async () => undefined);
    const copy = vi.fn(async () => undefined);

    await expect(
      copyMultiGamePrefix({
        sourcePrefix: "/global/wineprefix",
        targetPrefix: "/global/wineprefixes/zzz",
        exists,
        makeDir,
        removeDirectory,
        copy,
      })
    ).resolves.toBe(true);
    expect(makeDir).toHaveBeenCalledWith("/global/wineprefixes");
    expect(copy).toHaveBeenCalledWith(
      "/global/wineprefix",
      "/global/wineprefixes/zzz"
    );

    exists.mockImplementation(async (path: string) => true);
    await expect(
      copyMultiGamePrefix({
        sourcePrefix: "/global/wineprefix",
        targetPrefix: "/global/wineprefixes/zzz",
        exists,
        makeDir,
        removeDirectory,
        copy,
      })
    ).resolves.toBe(false);
    expect(copy).toHaveBeenCalledTimes(1);
  });
});
