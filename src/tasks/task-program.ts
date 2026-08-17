import type { LocaleTextKey } from "@locale";

/** Commands emitted by long-running launcher tasks for progress UIs. */
export type TaskProgressCommand =
  | ["setProgress", number]
  | ["setStateText", LocaleTextKey, ...string[]]
  | ["setRawStateText", string]
  | ["setUndeterminedProgress"];

/** A cancellable, progress-reporting task used by download, Wine, and update flows. */
export type TaskProgram<Ret = void> = AsyncGenerator<TaskProgressCommand, Ret>;

/** An expected task failure that should be reported instead of treated as fatal. */
export class TaskFailedError extends Error {
  constructor(message = "Task failed") {
    super(message);
    this.name = "TaskFailedError";
  }
}

export function isTaskFailedError(error: unknown): error is TaskFailedError {
  return error instanceof TaskFailedError;
}
