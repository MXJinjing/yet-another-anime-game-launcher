import { hopeTaskNotifier } from "@tasks/task-notifications";
import {
  createTaskQueueState as createCoreTaskQueueState,
  createTaskRunner as createCoreTaskRunner,
  GLOBAL_TASK_KEY,
} from "@tasks/task-runner";
import type { TaskNotifier, TaskRunnerOptions } from "@tasks/task-runner";
import type { Locale, LocaleTextKey } from "@locale";

/** Launcher composition owns the Hope UI notification adapter. */
export { GLOBAL_TASK_KEY };
export type {
  ConcurrentTaskEntry,
  TaskEntry,
  TaskRunnerOptions,
  TaskStateSignals,
} from "@tasks/task-runner";

export function createTaskRunner(options: TaskRunnerOptions) {
  return createCoreTaskRunner({
    ...options,
    notifier: options.notifier ?? hopeTaskNotifier,
  });
}

export const createConcurrentTaskQueueState = createTaskRunner;

export function createTaskQueueState({
  locale,
  onStateKey,
  notifier,
}: {
  locale: Locale;
  onStateKey?: (key: LocaleTextKey | null) => void;
  notifier?: TaskNotifier;
}) {
  return createCoreTaskQueueState({
    locale,
    onStateKey,
    notifier: notifier ?? hopeTaskNotifier,
  });
}
