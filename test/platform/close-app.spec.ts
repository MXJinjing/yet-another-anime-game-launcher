import { afterEach, describe, expect, it, vi } from "vitest";
import { addBeforeCloseApp, closeApp } from "@src/platform/neutralino/system";

describe("closeApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs cleanup before killing the process", async () => {
    const order: string[] = [];
    const remove = addBeforeCloseApp(async () => {
      order.push("cleanup");
    });
    try {
      vi.stubGlobal("Neutralino", {
        app: {
          killProcess: vi.fn(async () => {
            order.push("kill");
          }),
        },
      });
      await closeApp();
      expect(order).toEqual(["cleanup", "kill"]);
    } finally {
      remove();
    }
  });

  it("still exits when cleanup fails", async () => {
    const remove = addBeforeCloseApp(async () => {
      throw new Error("log window already gone");
    });
    try {
      const killProcess = vi.fn(async () => undefined);
      vi.stubGlobal("Neutralino", { app: { killProcess } });
      await closeApp();
      expect(killProcess).toHaveBeenCalledOnce();
    } finally {
      remove();
    }
  });
});
