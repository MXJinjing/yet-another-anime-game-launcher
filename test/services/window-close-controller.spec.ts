import { describe, expect, it, vi } from "vitest";
import {
  createWindowCloseController,
  type WindowClosePrompt,
} from "@services/window-close-controller";

function createHarness({
  downloads = false,
  game = false,
  update = false,
} = {}) {
  let prompt: WindowClosePrompt | null = null;
  const onBeforeExit = vi.fn(async () => true);
  const requestGameClose = vi.fn(async () => undefined);
  const cancelPendingUpdate = vi.fn(async () => undefined);
  const hideWindow = vi.fn(async () => undefined);
  const exit = vi.fn(async () => undefined);
  let settleUpdate: (() => void) | undefined;
  const pendingUpdate = update
    ? new Promise<void>(resolve => {
        settleUpdate = resolve;
      })
    : undefined;
  const controller = createWindowCloseController({
    hasActiveDownloads: () => downloads,
    isGameRunning: () => game,
    requestGameClose,
    pendingUpdate: () => pendingUpdate,
    cancelPendingUpdate,
    onPromptChange: next => {
      prompt = next;
    },
    onBeforeExit,
    hideWindow,
    exit,
  });
  return {
    controller,
    getPrompt: () => prompt,
    onBeforeExit,
    requestGameClose,
    cancelPendingUpdate,
    hideWindow,
    exit,
    settleUpdate: () => settleUpdate?.(),
  };
}

describe("window close controller", () => {
  it("cancels a pending download close without exiting", async () => {
    const harness = createHarness({ downloads: true });
    const request = harness.controller.requestClose();
    expect(harness.getPrompt()).toBe("download");
    harness.controller.resolvePrompt("CANCEL");

    await expect(request).resolves.toBe(false);
    expect(harness.onBeforeExit).not.toHaveBeenCalled();
    expect(harness.exit).not.toHaveBeenCalled();
    expect(harness.controller.isHandlingClose()).toBe(false);
  });

  it("only allows graceful game shutdown when the game is running", async () => {
    const harness = createHarness({ game: true });
    const request = harness.controller.requestClose();
    expect(harness.getPrompt()).toBe("game");
    harness.controller.resolvePrompt("CLOSE_GAME");

    await expect(request).resolves.toBe(true);
    expect(harness.requestGameClose).toHaveBeenCalledOnce();
    expect(harness.hideWindow).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledOnce();
  });

  it("asks download first, then game, and closes game processes on request", async () => {
    const harness = createHarness({ downloads: true, game: true });
    const request = harness.controller.requestClose();
    expect(harness.getPrompt()).toBe("download");
    harness.controller.resolvePrompt("EXIT");
    await Promise.resolve();
    expect(harness.getPrompt()).toBe("game");
    harness.controller.resolvePrompt("CLOSE_GAME");

    await expect(request).resolves.toBe(true);
    expect(harness.requestGameClose).toHaveBeenCalledOnce();
  });

  it("waits for a pending launcher update to settle before exiting", async () => {
    const harness = createHarness({ update: true });
    const request = harness.controller.requestClose();
    expect(harness.getPrompt()).toBeNull();
    expect(harness.cancelPendingUpdate).toHaveBeenCalledOnce();
    expect(harness.exit).not.toHaveBeenCalled();

    harness.settleUpdate();
    await expect(request).resolves.toBe(true);
    expect(harness.onBeforeExit).toHaveBeenCalledOnce();
    expect(harness.hideWindow).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledOnce();
  });

  it("skips the update wait when no update is pending", async () => {
    const harness = createHarness();
    await expect(harness.controller.requestClose()).resolves.toBe(true);
    expect(harness.cancelPendingUpdate).not.toHaveBeenCalled();
  });

  it("ignores duplicate close requests while a prompt is active", async () => {
    const harness = createHarness({ downloads: true });
    const first = harness.controller.requestClose();
    await expect(harness.controller.requestClose()).resolves.toBe(false);
    harness.controller.resolvePrompt("EXIT");
    await expect(first).resolves.toBe(true);
  });
});
