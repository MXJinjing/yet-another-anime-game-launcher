import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@runtime", () => ({
  exec: vi.fn(),
  exec2: vi.fn(),
  generateRandomString: () => "1234567",
  mkdirp: vi.fn(),
  rmrf_dangerously: vi.fn(),
}));
vi.mock("@runtime/storage", () => ({ getKey: vi.fn(), setKey: vi.fn() }));
vi.mock("@platform/neutralino", () => ({
  stats: vi.fn(),
  fileOrDirExists: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@platform/neutralino/path", () => ({ resolve: (p: string) => p }));
vi.mock("@wine/distro", () => ({ getWineDistributions: vi.fn() }));
vi.mock("@wine/wine", () => ({
  getWineDistroRoot: (id: string) => `/wines/${id}`,
  isWineDistroInstalled: vi.fn(),
  isWineserverUnavailableError: (e: unknown) =>
    String(e).includes("No such file"),
}));
vi.mock("@wine/wine-install-program", () => ({
  installWineEnvironmentProgram: vi.fn(async function* () {}),
}));
vi.mock("@logging/logger", () => ({ log: vi.fn() }));
vi.mock("@wine/native-window-state", () => ({
  createNativeGameWindowState: vi.fn(),
}));
import { exec, exec2 } from "@runtime";
import { getKey } from "@runtime/storage";
import { stats, writeFile, fileOrDirExists } from "@platform/neutralino";
import { getWineDistributions } from "@wine/distro";
import { isWineDistroInstalled } from "@wine/wine";
import { installWineEnvironmentProgram } from "@wine/wine-install-program";
import {
  AUTO_WINE_TAG,
  SHARED_WINE_TAG,
  createMultiGameWineFromRoot,
  ensureMultiGameGameWine,
  prepareMultiGameGameWine,
} from "@wine/multi-game";
const distro = {
  id: "test",
  displayName: "Test",
  remoteUrl: "https://example.invalid/wine.tar.gz",
  attributes: {},
};
async function create() {
  return createMultiGameWineFromRoot({
    prefix: "/prefix",
    distro,
    wineRoot: "/wine",
  });
}
async function result<T>(program: AsyncGenerator<unknown, T>) {
  let step = await program.next();
  while (!step.done) step = await program.next();
  return step.value;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getKey).mockResolvedValue("DESKTOP-TEST");
  vi.mocked(stats)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(fileOrDirExists).mockResolvedValue(false);
  vi.mocked(exec)
    .mockReset()
    .mockResolvedValue({ stdOut: "" } as never);
  vi.mocked(exec2)
    .mockReset()
    .mockResolvedValue({ stdOut: "" } as never);
  vi.mocked(getWineDistributions).mockResolvedValue([distro]);
  vi.mocked(isWineDistroInstalled).mockResolvedValue(true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("isolated Wine runtime", () => {
  it("runs commands using the selected loader, prefix and explicit overrides", async () => {
    const wine = await create();
    await wine.exec("copy", ["a", "b"], { CUSTOM: "yes" }, "/log");
    expect(exec).toHaveBeenCalledWith(
      ["/wine/bin/wine64", "cmd", "/c", "copy", "a", "b"],
      expect.objectContaining({ WINEPREFIX: "/prefix", CUSTOM: "yes" }),
      false,
      "/log"
    );
    await wine.exec2("wineboot", [], {}, undefined, { timeoutMs: 100 });
    expect(exec2).toHaveBeenCalledWith(
      ["/wine/bin/wine64", "wineboot"],
      expect.objectContaining({ WINEPREFIX: "/prefix" }),
      false,
      undefined,
      { timeoutMs: 100 }
    );
    expect(wine.toWinePath("/a/b")).toBe("Z:\\a\\b");
  });
  it("falls back to the wine loader and initializes a computer name", async () => {
    vi.mocked(stats).mockRejectedValueOnce(new Error("missing wine64"));
    vi.mocked(getKey).mockRejectedValueOnce(new Error("missing key"));
    await (await create()).cmd("/c", ["echo", "test"]);
    expect(exec).toHaveBeenCalledWith(
      ["/wine/bin/wine", "cmd", "/c", "echo", "test"],
      expect.any(Object),
      false,
      undefined
    );
  });
  it("writes prefix configuration before running it and waiting for wineserver", async () => {
    const wine = await create();
    await wine.setProps({ retina: true, leftCmd: false });
    expect(writeFile).toHaveBeenCalledWith(
      "winedrv_config.bat",
      expect.stringContaining("RetinaMode")
    );
    await wine.setNVExtension();
    await wine.clearNVExtension();
    await wine.openCmdWindow({ gameDir: "/game" });
    expect(exec2).toHaveBeenLastCalledWith(
      expect.arrayContaining(["osascript"]),
      {},
      false,
      "/dev/null"
    );
    await wine.waitUntilServerOff();
    await wine.setDistribution(distro);
  });
  it("handles server exit, missing binaries, command failures and timeouts", async () => {
    const wine = await create();
    await expect(wine.waitForWineServerExit({ timeoutMs: 0 })).resolves.toBe(
      true
    );
    vi.mocked(exec2).mockRejectedValueOnce(new Error("No such file"));
    await expect(wine.waitForWineServerExit()).resolves.toBe(true);
    vi.mocked(exec2).mockRejectedValueOnce(new Error("permission denied"));
    await expect(wine.waitForWineServerExit()).resolves.toBe(false);
    vi.useFakeTimers();
    vi.mocked(exec2).mockReturnValueOnce(new Promise(() => undefined));
    const pending = wine.waitForWineServerExit({ timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBe(false);
  });
  it("allows best-effort process cleanup after the server has exited", async () => {
    const wine = await create();
    vi.mocked(exec).mockRejectedValueOnce(new Error("gone"));
    await expect(wine.killAll()).resolves.toBeUndefined();
  });
  it.each([SHARED_WINE_TAG, AUTO_WINE_TAG, "test", "unknown"])(
    "resolves a persisted selection %s",
    async wineTag => {
      const baseWine = await create();
      const wine = await result(
        ensureMultiGameGameWine({
          aria2: {} as never,
          baseWine,
          gameId: "one",
          wineTag,
        })
      );
      if (wineTag === SHARED_WINE_TAG || wineTag === "unknown")
        expect(wine).toBe(baseWine);
      else expect(wine.prefix).toBe("/wineprefixes/one");
    }
  );
  it("installs missing managed distributions before creating the runtime", async () => {
    vi.mocked(isWineDistroInstalled).mockResolvedValue(false);
    const baseWine = await create();
    await result(
      ensureMultiGameGameWine({
        aria2: {} as never,
        baseWine,
        gameId: "one",
        wineTag: "test",
        downloadKey: "game",
      })
    );
    expect(installWineEnvironmentProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        activate: false,
        finishMessage: false,
        downloadKey: "game",
      })
    );
  });
  it("does not mutate a prefix when its previous Wine server cannot stop", async () => {
    const baseWine = await create();
    baseWine.waitForWineServerExit = vi.fn(async () => false);
    vi.mocked(exec2).mockClear();
    await expect(
      result(
        prepareMultiGameGameWine({
          aria2: {} as never,
          baseWine,
          gameId: "one",
          wineTag: SHARED_WINE_TAG,
        })
      )
    ).rejects.toThrow("Wine server did not exit");
    expect(exec2).not.toHaveBeenCalled();
  });
});
