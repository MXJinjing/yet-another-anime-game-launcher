import { shutdown } from "./lifecycle";
import { closeApp } from "../platform/neutralino/system";

/**
 * A failure that makes the current process unsafe or unusable.
 *
 * This is deliberately narrow. Only boot-level infrastructure failures (the
 * settings store or Neutralino itself is unusable), an unrecognized channel in
 * a production build, and a self-update that already rewrote the bundle but
 * could not relaunch belong here. Every other failure has a defined degraded
 * outcome and must be reported instead of terminating the launcher.
 */
export class FatalError extends Error {
  constructor(message = "Fatal launcher error", readonly cause?: unknown) {
    super(message);
    this.name = "FatalError";
  }
}

export function isFatalError(error: unknown): error is FatalError {
  return error instanceof FatalError;
}

export async function fatal(error: unknown) {
  await Neutralino.os.showMessageBox(
    "Fatal error",
    `${error instanceof Error ? String(error) : JSON.stringify(error)}`,
    "OK"
  );
  await shutdown();
  await closeApp();
}
