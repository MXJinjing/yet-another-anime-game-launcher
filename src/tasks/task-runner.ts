import {
  isDownloadCancelledError,
  isDownloadFailedError,
} from "../download/control";
import {
  beginDownloadTask,
  endDownloadTask,
  type DownloadTaskMetadata,
  updateDownloadTaskFileCounter,
  updateDownloadTaskPhase,
} from "../download/task-registry";
import { type Locale, type LocaleTextKey } from "@locale";
import { log, logerror } from "../logging/logger";
import { fatal } from "../runtime/fatal";
import { isConnectionError } from "../services/connection-error";
import { isAuthorizationCancelledError } from "../runtime/authorization";
import { type Accessor, createSignal, type Setter } from "solid-js";
import { isTaskFailedError, type TaskProgram } from "./task-program";
import type { TaskNotifier } from "./task-notifications";

export type { TaskNotifier } from "./task-notifications";

const SKIP_LOG_STATE_KEYS = new Set([
  "DOWNLOADING_ENVIRONMENT_SPEED",
  "DOWNLOADING_FILE_PROGRESS",
]);

const DOWNLOAD_TRANSFER_STATE_KEYS = new Set<LocaleTextKey>([
  "DOWNLOADING_FILE_PROGRESS",
  "DOWNLOADING_ENVIRONMENT_SPEED",
]);

export type TaskEntry = {
  fn: () => TaskProgram;
  name?: LocaleTextKey;
  downloadTask?: DownloadTaskMetadata;
};

export const GLOBAL_TASK_KEY = "__global__";

export type ConcurrentTaskEntry = TaskEntry & {
  /** Tasks sharing a key are serial; tasks with distinct keys may run together. */
  key?: string;
};

export type TaskStateSignals = {
  statusText: Accessor<string>;
  setStatusText: Setter<string>;
  progress: Accessor<number>;
  setProgress: Setter<number>;
  busy: Accessor<boolean>;
  setBusy: Setter<boolean>;
  statusArgs: Accessor<{ key: LocaleTextKey; args: string[] } | null>;
  setStatusArgs: Setter<{ key: LocaleTextKey; args: string[] } | null>;
};

export type TaskRunnerOptions = {
  locale: Locale;
  onStateKey?: (key: string, stateKey: LocaleTextKey | null) => void;
  notifier?: TaskNotifier;
};

// Task execution is intentionally UI-agnostic. Compatibility entrypoints in
// The launcher controller injects the Hope adapter for existing UI callers.
const noOpTaskNotifier: TaskNotifier = {
  taskCompleted: () => undefined,
  taskCancelled: () => undefined,
  taskFailed: () => undefined,
  connectionError: () => undefined,
};

function createTaskStateSignals(): TaskStateSignals {
  const [statusText, setStatusText] = createSignal("");
  const [progress, setProgress] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  const [statusArgs, setStatusArgs] = createSignal<{
    key: LocaleTextKey;
    args: string[];
  } | null>(null);
  return {
    statusText,
    setStatusText,
    progress,
    setProgress,
    busy,
    setBusy,
    statusArgs,
    setStatusArgs,
  };
}

function updateDownloadTaskState(
  taskId: string | undefined,
  key: LocaleTextKey | null,
  args: string[],
  text: string
) {
  if (!taskId) return;
  updateDownloadTaskPhase(
    taskId,
    text,
    key ? DOWNLOAD_TRANSFER_STATE_KEYS.has(key) : false
  );
  if (key === "DOWNLOADING_FILE_PROGRESS") {
    updateDownloadTaskFileCounter(
      taskId,
      Number(args[5]) || undefined,
      Number(args[6]) || undefined
    );
  } else if (key === "DOWNLOADING_ENVIRONMENT_SPEED") {
    updateDownloadTaskFileCounter(
      taskId,
      Number(args[4]) || undefined,
      Number(args[5]) || undefined
    );
  }
}

/**
 * Runs one program per key at a time while allowing independent keys to make
 * progress concurrently. The runner owns all UI-facing state signals.
 */
export function createTaskRunner({
  locale,
  onStateKey,
  notifier = noOpTaskNotifier,
}: TaskRunnerOptions) {
  const stateByKey = new Map<string, TaskStateSignals>();
  const pendingByKey = new Map<string, ConcurrentTaskEntry[]>();
  const runningKeys = new Set<string>();
  const idleWaiters = new Map<string, Array<() => void>>();

  function resolveIdleWaiters(key: string) {
    if (runningKeys.has(key) || (pendingByKey.get(key)?.length ?? 0) > 0)
      return;
    const waiters = idleWaiters.get(key);
    if (!waiters) return;
    idleWaiters.delete(key);
    for (const resolve of waiters) resolve();
  }

  function getState(key: string): TaskStateSignals {
    let state = stateByKey.get(key);
    if (!state) {
      state = createTaskStateSignals();
      stateByKey.set(key, state);
    }
    return state;
  }

  function enqueue(entry: ConcurrentTaskEntry) {
    const key = entry.key ?? GLOBAL_TASK_KEY;
    const queue = pendingByKey.get(key) ?? [];
    queue.push(entry);
    pendingByKey.set(key, queue);
    void runNext(key);
  }

  async function runNext(key: string): Promise<void> {
    if (runningKeys.has(key)) return;
    const queue = pendingByKey.get(key);
    const entry = queue?.shift();
    if (!entry) return;

    runningKeys.add(key);
    const state = getState(key);
    const { fn: task, name: taskName } = entry;
    // Only tasks that explicitly provide download metadata belong in the
    // download queue. Regular tasks such as launching the game may still
    // start an incidental runtime download; those streams are materialized
    // independently by the download registry instead of inheriting a
    // misleading task title such as "Launch Game".
    const downloadTaskId = entry.downloadTask
      ? beginDownloadTask({
          ...entry.downloadTask,
          key: entry.downloadTask.key ?? key,
        })
      : undefined;

    // A state object is reused for the next task on the same key. Reset the
    // visible progress state before execution so a new task cannot briefly
    // render the previous task's title (or the UI fallback "Processing…").
    state.setStatusText("");
    state.setStatusArgs(null);
    state.setProgress(0);
    state.setBusy(true);
    await log("Task started");
    try {
      for await (const command of task()) {
        switch (command[0]) {
          case "setProgress":
            state.setProgress(command[1]);
            break;
          case "setUndeterminedProgress":
            state.setProgress(0);
            break;
          case "setStateText": {
            const [_, stateKey, ...args] = command;
            onStateKey?.(key, stateKey);
            state.setStatusArgs({ key: stateKey, args });
            const formatted = locale.format(stateKey, args);
            state.setStatusText(formatted);
            updateDownloadTaskState(
              downloadTaskId,
              stateKey,
              args,
              stateKey === "DOWNLOADING_FILE_PROGRESS"
                ? locale.get("DOWNLOAD_PROGRESS")
                : stateKey === "DOWNLOADING_ENVIRONMENT_SPEED"
                ? locale.get("DOWNLOADING_ENVIRONMENT")
                : formatted
            );
            if (!SKIP_LOG_STATE_KEYS.has(stateKey)) await log(formatted);
            break;
          }
          case "setRawStateText":
            // Keep the semantic state key while only the display text changes.
            // Launch recovery uses raw progress messages after emitting
            // REVERT_PATCHING and must remain closable only after the task
            // reaches its terminal cleanup path below.
            state.setStatusArgs(null);
            state.setStatusText(command[1]);
            updateDownloadTaskState(downloadTaskId, null, [], command[1]);
            await log(command[1]);
            break;
        }
      }
      await log("Task completed");
      state.setStatusArgs(null);
      if (taskName) notifier.taskCompleted(locale, taskName);
    } catch (error) {
      if (isAuthorizationCancelledError(error)) {
        const authorizationError = new Error(
          locale.get("NOTIFICATION_AUTHORIZATION_CANCELLED")
        );
        await logerror(error instanceof Error ? error.message : String(error));
        notifier.taskFailed(locale, taskName, authorizationError, key);
      } else if (isDownloadCancelledError(error)) {
        await log("Task cancelled");
        if (taskName) notifier.taskCancelled(locale, taskName);
      } else if (isDownloadFailedError(error)) {
        await logerror(error instanceof Error ? error.message : String(error));
        notifier.taskFailed(locale, taskName, undefined, key);
      } else if (isTaskFailedError(error)) {
        await logerror(error instanceof Error ? error.message : String(error));
        notifier.taskFailed(locale, taskName, error, key);
      } else if (isConnectionError(error)) {
        await logerror(error instanceof Error ? error.message : String(error));
        notifier.connectionError(locale, taskName);
      } else {
        await logerror(error instanceof Error ? error.message : String(error));
        await fatal(error);
      }
      state.setStatusArgs(null);
    } finally {
      // Clear terminal task state before releasing busy. This prevents a
      // completed INSTALL_DONE status from surviving while a download stream
      // is being detached.
      onStateKey?.(key, null);
      state.setStatusArgs(null);
      state.setStatusText("");
      state.setProgress(0);
      state.setBusy(false);
      runningKeys.delete(key);
      if (downloadTaskId) endDownloadTask(downloadTaskId);
      if ((pendingByKey.get(key)?.length ?? 0) > 0) {
        void runNext(key);
      } else {
        resolveIdleWaiters(key);
      }
    }
  }

  return {
    getState,
    enqueue,
    isBusy: (key: string) => getState(key).busy(),
    waitForIdle: (key: string) => {
      if (!runningKeys.has(key) && (pendingByKey.get(key)?.length ?? 0) === 0)
        return Promise.resolve();
      return new Promise<void>(resolve => {
        const waiters = idleWaiters.get(key) ?? [];
        waiters.push(resolve);
        idleWaiters.set(key, waiters);
      });
    },
  };
}

/** Backwards-compatible name retained for launcher callers during migration. */
export const createConcurrentTaskQueueState = createTaskRunner;

/**
 * Legacy single-queue adapter. Its generator-shaped enqueue API is retained
 * for older callers; new code should use createTaskRunner().enqueue().
 */
export function createTaskQueueState({
  locale,
  onStateKey,
  notifier,
}: {
  locale: Locale;
  onStateKey?: (key: LocaleTextKey | null) => void;
  notifier?: TaskNotifier;
}) {
  const runner = createTaskRunner({
    locale,
    notifier,
    onStateKey: (_, key) => onStateKey?.(key),
  });
  const state = runner.getState(GLOBAL_TASK_KEY);
  const taskQueue: AsyncGenerator<unknown, void, TaskEntry> = {
    next(entry?: TaskEntry) {
      if (entry) runner.enqueue(entry);
      return Promise.resolve({ value: undefined, done: false });
    },
    return() {
      return Promise.resolve({ value: undefined, done: true });
    },
    throw(error?: unknown) {
      return Promise.reject(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve();
    },
  };
  return [
    state.statusText,
    state.progress,
    state.busy,
    taskQueue,
    state.statusArgs,
  ] as const;
}
