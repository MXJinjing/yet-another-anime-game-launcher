import { describe, expect, it, vi } from "vitest";
import {
  cleanupCancelledMultiGameWineDownload,
  createMultiGameWineProxy,
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
});
