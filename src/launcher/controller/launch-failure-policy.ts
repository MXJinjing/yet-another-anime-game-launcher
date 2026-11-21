import { isGameAlreadyRunningError } from "../../clients/launch-errors";
import {
  isRuntimeReplacementConfigInvalidError,
  isRuntimeReplacementFileMissingError,
  isRuntimeReplacementImpossibleError,
  isRuntimeReplacementVerificationError,
} from "../../clients/mhy/patch";

/**
 * How the launcher should react to a failed LAUNCH task.
 *
 * Recoverable launch failures must not reach the generic error toast: the
 * user either needs a choice (skip a replacement, force-stop a running game)
 * or a launch that can continue without the optional step.
 */
export type LaunchFailureResolution =
  | { kind: "default" }
  | { kind: "replacement-error"; details: string }
  | { kind: "replacement-prompt"; details: string }
  | { kind: "replacement-skip"; details: string }
  | { kind: "already-running"; executablePath: string };

export function resolveLaunchFailure(
  error: unknown,
  taskName?: string
): LaunchFailureResolution {
  if (taskName !== "LAUNCH") return { kind: "default" };
  const details = error instanceof Error ? error.message : String(error);

  if (isRuntimeReplacementFileMissingError(error)) {
    return { kind: "replacement-error", details };
  }
  if (
    isRuntimeReplacementConfigInvalidError(error) ||
    isRuntimeReplacementVerificationError(error)
  ) {
    return { kind: "replacement-prompt", details };
  }
  if (isRuntimeReplacementImpossibleError(error)) {
    return { kind: "replacement-skip", details };
  }
  if (isGameAlreadyRunningError(error)) {
    return { kind: "already-running", executablePath: error.executablePath };
  }
  return { kind: "default" };
}
