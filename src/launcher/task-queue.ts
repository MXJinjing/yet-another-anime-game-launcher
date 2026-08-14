import { CommonUpdateProgram } from "@common-update-ui";
import {
  isDownloadCancelledError,
  isDownloadFailedError,
} from "../download-control";
import { Locale, LocaleTextKey } from "@locale";
import { fatal, isConnectionError, log, logerror } from "@utils";
import { Accessor, Setter, createSignal } from "solid-js";
import { notificationService } from "@hope-ui/solid";

// DOWNLOADING_FILE_PROGRESS now also fires on every file start (so the UI
// updates the current file / file index immediately), which would otherwise
// flood the log with one line per file. The progress itself is still visible
// in the download panel.
const SKIP_LOG_STATE_KEYS = new Set([
  "DOWNLOADING_ENVIRONMENT_SPEED",
  "DOWNLOADING_FILE_PROGRESS",
]);

type TaskEntry = {
  fn: () => CommonUpdateProgram;
  name?: LocaleTextKey;
};

export function createTaskQueueState({
  locale,
  onStateKey,
}: {
  locale: Locale;
  onStateKey?: (key: LocaleTextKey | null) => void;
}) {
  const [statusText, setStatusText] = createSignal("");
  const [progress, setProgress] = createSignal(0);
  const [programBusy, setBusy] = createSignal(false);
  const [statusArgs, setStatusArgs] = createSignal<{
    key: LocaleTextKey;
    args: string[];
  } | null>(null);

  const taskQueue: AsyncGenerator<unknown, void, TaskEntry> =
    (async function* () {
      while (true) {
        const entry = yield undefined!;
        const { fn: task, name: taskName } = entry;
        setBusy(true);
        await log("Task started");
        try {
          for await (const text of task()) {
            switch (text[0]) {
              case "setProgress":
                setProgress(text[1]);
                break;
              case "setUndeterminedProgress":
                setProgress(0);
                break;
              case "setStateText":
                onStateKey?.(text[1]);
                setStatusArgs({ key: text[1], args: text.slice(2) });
                setStatusText(locale.format(text[1], text.slice(2)));
                if (!SKIP_LOG_STATE_KEYS.has(text[1])) {
                  await log(locale.format(text[1], text.slice(2)));
                }
                break;
              case "setRawStateText":
                onStateKey?.(null);
                setStatusArgs(null);
                setStatusText(text[1]);
                await log(text[1]);
                break;
            }
          }
          await log("Task completed");
          setStatusArgs(null);
          if (taskName) {
            notificationService.show({
              status: "success",
              title: locale.get(taskName),
              description: locale.get("NOTIFICATION_TASK_COMPLETED"),
            });
          }
        } catch (e) {
          onStateKey?.(null);
          if (isDownloadCancelledError(e)) {
            await log("Task cancelled");
            if (taskName) {
              notificationService.show({
                status: "warning",
                title: locale.get(taskName),
                description: locale.get("NOTIFICATION_TASK_CANCELLED"),
              });
            }
            setStatusArgs(null);
            setBusy(false);
            continue;
          }
          if (isDownloadFailedError(e)) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            await logerror(errorMessage);
            if (taskName) {
              notificationService.show({
                status: "danger",
                title: locale.get(taskName),
                description: locale.get("NOTIFICATION_TASK_FAILED"),
              });
            } else {
              notificationService.show({
                status: "danger",
                title: locale.get("NOTIFICATION_TASK_FAILED_TITLE"),
                description: locale.get("NOTIFICATION_TASK_FAILED"),
              });
            }
            setStatusArgs(null);
            setBusy(false);
            continue;
          }
          if (isConnectionError(e)) {
            await logerror(e instanceof Error ? e.message : String(e));
            notificationService.show({
              status: "danger",
              title: taskName
                ? locale.get(taskName)
                : locale.get("CHECK_GAME_UPDATE_FAILED"),
              description: locale.get("CHECK_GAME_UPDATE_FAILED_DESC"),
            });
            setStatusArgs(null);
            setBusy(false);
            continue;
          }
          await logerror(e instanceof Error ? e.message : String(e));
          // fatal
          await fatal(e);
          return;
        }
        onStateKey?.(null);
        setBusy(false);
      }
    })();
  taskQueue.next(); // ignored anyway

  return [statusText, progress, programBusy, taskQueue, statusArgs] as const;
}

export const GLOBAL_TASK_KEY = "__global__";

export type ConcurrentTaskEntry = TaskEntry & {
  /** Optional key identifying the game/context this task belongs to.
   *  Tasks under the same key run one at a time; different keys run
   *  concurrently. Omit for launcher-global tasks (e.g. Wine setup). */
  key?: string;
};

type TaskStateSignals = {
  statusText: Accessor<string>;
  setStatusText: Setter<string>;
  progress: Accessor<number>;
  setProgress: Setter<number>;
  busy: Accessor<boolean>;
  setBusy: Setter<boolean>;
  statusArgs: Accessor<{ key: LocaleTextKey; args: string[] } | null>;
  setStatusArgs: Setter<{ key: LocaleTextKey; args: string[] } | null>;
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

/**
 * Task queue that runs tasks concurrently across different keys (e.g. one per
 * game) while keeping tasks under the same key strictly serialized. Each key
 * keeps its own progress/status/busy signals so every game page can display
 * its own download/update progress.
 */
export function createConcurrentTaskQueueState({
  locale,
  onStateKey,
}: {
  locale: Locale;
  onStateKey?: (key: string, stateKey: LocaleTextKey | null) => void;
}) {
  const stateByKey = new Map<string, TaskStateSignals>();
  const pendingByKey = new Map<string, ConcurrentTaskEntry[]>();
  const runningKeys = new Set<string>();

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

  async function runNext(key: string) {
    if (runningKeys.has(key)) return;
    const queue = pendingByKey.get(key);
    const entry = queue?.shift();
    if (!entry) return;
    runningKeys.add(key);
    const state = getState(key);
    const { fn: task, name: taskName } = entry;
    state.setBusy(true);
    await log("Task started");
    try {
      for await (const text of task()) {
        switch (text[0]) {
          case "setProgress":
            state.setProgress(text[1]);
            break;
          case "setUndeterminedProgress":
            state.setProgress(0);
            break;
          case "setStateText":
            onStateKey?.(key, text[1]);
            state.setStatusArgs({ key: text[1], args: text.slice(2) });
            state.setStatusText(locale.format(text[1], text.slice(2)));
            if (!SKIP_LOG_STATE_KEYS.has(text[1])) {
              await log(locale.format(text[1], text.slice(2)));
            }
            break;
          case "setRawStateText":
            onStateKey?.(key, null);
            state.setStatusArgs(null);
            state.setStatusText(text[1]);
            await log(text[1]);
            break;
        }
      }
      await log("Task completed");
      state.setStatusArgs(null);
      if (taskName) {
        notificationService.show({
          status: "success",
          title: locale.get(taskName),
          description: locale.get("NOTIFICATION_TASK_COMPLETED"),
        });
      }
    } catch (e) {
      if (isDownloadCancelledError(e)) {
        await log("Task cancelled");
        if (taskName) {
          notificationService.show({
            status: "warning",
            title: locale.get(taskName),
            description: locale.get("NOTIFICATION_TASK_CANCELLED"),
          });
        }
        state.setStatusArgs(null);
      } else if (isDownloadFailedError(e)) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        await logerror(errorMessage);
        if (taskName) {
          notificationService.show({
            status: "danger",
            title: locale.get(taskName),
            description: locale.get("NOTIFICATION_TASK_FAILED"),
          });
        } else {
          notificationService.show({
            status: "danger",
            title: locale.get("NOTIFICATION_TASK_FAILED_TITLE"),
            description: locale.get("NOTIFICATION_TASK_FAILED"),
          });
        }
        state.setStatusArgs(null);
      } else if (isConnectionError(e)) {
        await logerror(e instanceof Error ? e.message : String(e));
        notificationService.show({
          status: "danger",
          title: taskName
            ? locale.get(taskName)
            : locale.get("CHECK_GAME_UPDATE_FAILED"),
          description: locale.get("CHECK_GAME_UPDATE_FAILED_DESC"),
        });
        state.setStatusArgs(null);
      } else {
        await logerror(e instanceof Error ? e.message : String(e));
        // fatal
        await fatal(e);
        return;
      }
    }
    onStateKey?.(key, null);
    state.setBusy(false);
    runningKeys.delete(key);
    void runNext(key);
  }

  return {
    getState,
    enqueue,
    isBusy: (key: string) => getState(key).busy(),
  };
}
