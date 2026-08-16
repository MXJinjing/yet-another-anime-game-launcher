export type WindowClosePrompt = "download" | "game";
export type WindowCloseDecision = "EXIT" | "CANCEL" | "CLOSE_GAME";

export interface WindowCloseControllerDependencies {
  hasActiveDownloads: () => boolean;
  isGameRunning: () => boolean;
  requestGameClose: () => Promise<void>;
  onPromptChange?: (prompt: WindowClosePrompt | null) => void;
  onBeforeExit: () => Promise<boolean>;
  hideWindow: () => Promise<void>;
  exit: () => Promise<void>;
}

/**
 * UI-agnostic controller for the window-close flow. The host renders prompts
 * from `onPromptChange` and sends the selected answer back with
 * `resolvePrompt`.
 */
export function createWindowCloseController(
  dependencies: WindowCloseControllerDependencies
) {
  let handlingClose = false;
  let resolvePendingPrompt:
    | ((decision: WindowCloseDecision) => void)
    | undefined;

  function waitForPrompt(
    prompt: WindowClosePrompt
  ): Promise<WindowCloseDecision> {
    return new Promise(resolve => {
      resolvePendingPrompt = resolve;
      dependencies.onPromptChange?.(prompt);
    });
  }

  function resolvePrompt(decision: WindowCloseDecision) {
    dependencies.onPromptChange?.(null);
    resolvePendingPrompt?.(decision);
    resolvePendingPrompt = undefined;
  }

  async function requestClose(): Promise<boolean> {
    if (handlingClose) {
      return false;
    }
    handlingClose = true;
    let shouldExit = false;
    try {
      if (dependencies.hasActiveDownloads()) {
        const decision = await waitForPrompt("download");
        if (decision === "CANCEL") {
          return false;
        }
      }
      if (dependencies.isGameRunning()) {
        const decision = await waitForPrompt("game");
        if (decision === "CANCEL") {
          return false;
        }
        await dependencies.requestGameClose();
      }
      shouldExit = await dependencies.onBeforeExit();
      if (shouldExit) {
        await dependencies.hideWindow();
        await dependencies.exit();
      }
      return shouldExit;
    } finally {
      if (!shouldExit) {
        handlingClose = false;
      }
    }
  }

  return {
    requestClose,
    resolvePrompt,
    isHandlingClose: () => handlingClose,
  };
}
