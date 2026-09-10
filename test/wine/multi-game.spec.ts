import { describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
}));

vi.mock("@platform/neutralino", () => ({
  fileOrDirExists: vi.fn(async () => false),
  removeFileIfExists: vi.fn(async () => undefined),
  stats: vi.fn(async () => ({ isDirectory: true, isFile: false })),
  writeFile: vi.fn(async () => undefined),
}));
import type { TaskProgressCommand } from "@tasks/task-program";
import {
  cleanupCancelledMultiGameWineDownload,
  copyMultiGamePrefix,
  createMultiGameWineProxy,
  getMultiGamePrefix,
  prepareMultiGameGameWine,
  SHARED_WINE_TAG,
} from "@wine/multi-game";

describe("multi-game Wine", () => {
  it("cleans both partial archive and Wine root after cancellation", async () => {
    const removeFile = vi.fn(async () => undefined);
    const removeDirectory = vi.fn(async () => undefined);
    await cleanupCancelledMultiGameWineDownload({
      wineTarPath: "/tmp/wine.tar.xz",
      wineRoot: "/tmp/wine",
      removeFile,
      removeDirectory,
    });
    expect(removeFile).toHaveBeenCalledWith("/tmp/wine.tar.xz");
    expect(removeDirectory).toHaveBeenCalledWith("/tmp/wine");
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
    // A brand-new prefix is initialized (no `-u`), and failures keep stderr
    // visible by not redirecting the output.
    expect(wine.exec2).toHaveBeenCalledWith("wineboot", [], {}, undefined, {
      timeoutMs: 300_000,
    });
    expect(wine.exec2).toHaveBeenCalledWith(
      "winecfg",
      ["-v", "win10"],
      {},
      "/dev/null",
      { timeoutMs: 120_000 }
    );
    expect(states).toEqual(["CONFIGURING_ENVIRONMENT", "INSTALL_DONE"]);
    expect(result).toBe(wine);
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
