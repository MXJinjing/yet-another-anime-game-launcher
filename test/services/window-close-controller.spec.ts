import { describe, expect, it, vi } from "vitest";
import {
  createWindowCloseController,
  type WindowClosePrompt,
} from "@services/window-close-controller";

function createHarness({ downloads = false, game = false } = {}) {
  let prompt: WindowClosePrompt | null = null;
  const onBeforeExit = vi.fn(async () => true);
  const hideWindow = vi.fn(async () => undefined);
  const exit = vi.fn(async () => undefined);
  const controller = createWindowCloseController({
    hasActiveDownloads: () => downloads,
    isGameRunning: () => game,
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
    hideWindow,
    exit,
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

  it("keeps game processes alive when the user chooses KEEP_GAME", async () => {
    const harness = createHarness({ game: true });
    const request = harness.controller.requestClose();
    expect(harness.getPrompt()).toBe("game");
    harness.controller.resolvePrompt("KEEP_GAME");

    await expect(request).resolves.toBe(true);
    expect(harness.controller.shouldCloseGameProcessesOnExit()).toBe(false);
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
    expect(harness.controller.shouldCloseGameProcessesOnExit()).toBe(true);
  });

  it("ignores duplicate close requests while a prompt is active", async () => {
    const harness = createHarness({ downloads: true });
    const first = harness.controller.requestClose();
    await expect(harness.controller.requestClose()).resolves.toBe(false);
    harness.controller.resolvePrompt("EXIT");
    await expect(first).resolves.toBe(true);
  });
});
