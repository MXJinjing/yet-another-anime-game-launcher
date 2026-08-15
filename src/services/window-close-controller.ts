export type WindowClosePrompt = "download" | "game";
export type WindowCloseDecision =
  | "EXIT"
  | "CANCEL"
  | "CLOSE_GAME"
  | "KEEP_GAME";

export interface WindowCloseControllerDependencies {
  hasActiveDownloads: () => boolean;
  isGameRunning: () => boolean;
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
  let closeGameProcessesOnExit = true;
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
      closeGameProcessesOnExit = true;
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
        closeGameProcessesOnExit = decision === "CLOSE_GAME";
      }
      shouldExit = await dependencies.onBeforeExit();
      if (shouldExit) {
        await dependencies.hideWindow();
        await dependencies.exit();
      }
      return shouldExit;
    } finally {
      if (!shouldExit) {
        closeGameProcessesOnExit = true;
        handlingClose = false;
      }
    }
  }

  return {
    requestClose,
    resolvePrompt,
    isHandlingClose: () => handlingClose,
    shouldCloseGameProcessesOnExit: () => closeGameProcessesOnExit,
  };
}
