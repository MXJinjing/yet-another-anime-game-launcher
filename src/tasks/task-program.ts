import type { LocaleTextKey } from "@locale";

/** Commands emitted by long-running launcher tasks for progress UIs. */
export type TaskProgressCommand =
  | ["setProgress", number]
  | ["setStateText", LocaleTextKey, ...string[]]
  | ["setRawStateText", string]
  | ["setUndeterminedProgress"];

/** A cancellable, progress-reporting task used by download, Wine, and update flows. */
export type TaskProgram<Ret = void> = AsyncGenerator<TaskProgressCommand, Ret>;
