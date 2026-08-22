import { Progress, ProgressIndicator } from "@hope-ui/solid";
import { For, Show, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { AppModal } from "../components/app-modal";
import {
  cancelDownloadTask,
  getGlobalTaskActive,
  pauseDownloadTask,
  resumeDownloadTask,
  subscribe as subscribeDownloadQueue,
} from "../download/stream-scheduler";
import {
  type DownloadTaskSnapshot,
  getDownloadTasks,
  subscribeDownloadTasks,
} from "../download/task-registry";
import { Locale, LocaleTextKey } from "../locale";
import { formatDownloadSpeed, humanFileSize } from "../runtime/format";
import { reconcileDownloadTasks } from "../download/solid-store";

const STATUS_LOCALE_KEYS: Record<
  DownloadTaskSnapshot["status"],
  LocaleTextKey
> = {
  queued: "DOWNLOAD_STATUS_QUEUED",
  active: "DOWNLOAD_STATUS_ACTIVE",
  paused: "DOWNLOAD_STATUS_PAUSED",
  completed: "DOWNLOAD_STATUS_COMPLETED",
  error: "DOWNLOAD_STATUS_ERROR",
  cancelled: "DOWNLOAD_STATUS_CANCELLED",
};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function percent(value: number): string {
  return `${Math.min(100, Math.max(0, value)).toFixed(1)}%`;
}

function taskStatusText(task: DownloadTaskSnapshot, locale: Locale): string {
  if (task.status === "active" && task.phaseKind === "verifying") {
    return locale.get("DOWNLOAD_STATUS_VERIFYING");
  }
  if (task.status === "active" && !task.transferring && task.phase) {
    return task.phase;
  }
  return locale.get(STATUS_LOCALE_KEYS[task.status]);
}

export function DownloadQueueModal(props: {
  opened: boolean;
  onClose: () => void;
  locale: Locale;
}) {
  const [tasks, setTasks] = createStore<DownloadTaskSnapshot[]>(
    getDownloadTasks().map(task => ({
      ...task,
      engines: [...task.engines],
      files: task.files.map(file => ({ ...file })),
    }))
  );
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const [globalTaskActive, setGlobalTaskActive] = createSignal(
    getGlobalTaskActive()
  );

  onCleanup(
    subscribeDownloadTasks(next => {
      setTasks(reconcileDownloadTasks(next));
      const liveIds = new Set(next.map(task => task.id));
      setExpanded(current =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => liveIds.has(id))
        )
      );
    })
  );
  onCleanup(
    subscribeDownloadQueue(() => {
      setGlobalTaskActive(getGlobalTaskActive());
    })
  );

  const isLocked = (task: DownloadTaskSnapshot) =>
    globalTaskActive() && Boolean(task.key);
  const toggleExpanded = (id: string) =>
    setExpanded(current => ({ ...current, [id]: !current[id] }));

  return (
    <AppModal
      opened={props.opened}
      onClose={props.onClose}
      title={props.locale.get("DOWNLOAD_MANAGER")}
      maxWidth={720}
      height={520}
      bodyClass="download-queue-body"
    >
      <Show when={globalTaskActive()}>
        <div class="download-queue-global-hint">
          {props.locale.get("DOWNLOAD_MANAGER_GLOBAL_TASK_WAITING")}
        </div>
      </Show>
      <Show when={tasks.length === 0}>
        <div class="download-queue-empty">
          {props.locale.get("DOWNLOAD_MANAGER_EMPTY")}
        </div>
      </Show>
      <Show when={tasks.length > 0}>
        <div class="download-queue-list">
          <For each={tasks}>
            {task => (
              <div class="download-queue-item">
                <div class="download-queue-item-header">
                  <div class="download-queue-item-titles">
                    <div class="download-queue-item-title" title={task.title}>
                      {task.title}
                    </div>
                    <Show when={task.phase}>
                      <div class="download-queue-item-phase" title={task.phase}>
                        {task.phase}
                      </div>
                    </Show>
                  </div>
                  <div class="download-queue-item-status">
                    <span class="download-queue-total-percent">
                      {task.indeterminate ? "—" : percent(task.progress)}
                    </span>
                    <span
                      classList={{
                        "download-queue-badge": true,
                        [`download-queue-badge--${task.status}`]: true,
                      }}
                    >
                      {taskStatusText(task, props.locale)}
                    </span>
                  </div>
                </div>
                <Progress
                  class="download-queue-progress"
                  value={task.progress}
                  indeterminate={task.indeterminate}
                  size="sm"
                  borderRadius={8}
                >
                  <ProgressIndicator
                    style={"transition: none;"}
                    borderRadius={8}
                  />
                </Progress>
                <div class="download-queue-item-meta">
                  <span>{formatDownloadSpeed(task.speed)}</span>
                  <span>
                    {humanFileSize(task.downloaded)} /{" "}
                    {task.total > 0
                      ? humanFileSize(task.total)
                      : props.locale.get("DOWNLOAD_TASK_UNKNOWN_SIZE")}
                    <Show
                      when={
                        task.fileIndex !== undefined &&
                        task.fileCount !== undefined
                      }
                    >
                      {` · ${props.locale.get("DOWNLOAD_FILE_INDEX")} ${
                        task.fileIndex
                      } / ${task.fileCount}`}
                    </Show>
                  </span>
                </div>

                <Show when={expanded()[task.id]}>
                  <div class="download-queue-details">
                    <div class="download-queue-engine">
                      {props.locale.get("DOWNLOAD_TASK_ENGINE")}:{" "}
                      {task.engines
                        .map(engine =>
                          engine === "sophon" ? "Sophon" : "aria2"
                        )
                        .join(" + ")}
                    </div>
                    <Show when={task.files.length > 0}>
                      <div class="download-queue-files">
                        <For each={task.files.slice(0, 8)}>
                          {file => (
                            <div class="download-queue-file">
                              <div class="download-queue-file-header">
                                <span
                                  class="download-queue-file-name"
                                  title={file.name}
                                >
                                  {fileName(file.name)}
                                </span>
                                <span>{percent(file.progress)}</span>
                              </div>
                              <Progress
                                class="download-queue-file-progress"
                                value={file.progress}
                                indeterminate={file.total <= 0}
                                size="sm"
                                borderRadius={6}
                              >
                                <ProgressIndicator
                                  style={"transition: none;"}
                                  borderRadius={6}
                                />
                              </Progress>
                              <div class="download-queue-file-meta">
                                <span>
                                  {humanFileSize(file.downloaded)} /{" "}
                                  {file.total > 0
                                    ? humanFileSize(file.total)
                                    : props.locale.get(
                                        "DOWNLOAD_TASK_UNKNOWN_SIZE"
                                      )}
                                </span>
                                <span>{formatDownloadSpeed(file.speed)}</span>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>

                <div class="download-queue-item-actions">
                  <Show
                    when={
                      (task.status === "active" || task.status === "queued") &&
                      task.canPause &&
                      !isLocked(task)
                    }
                  >
                    <button
                      type="button"
                      class="download-queue-action"
                      onClick={() => void pauseDownloadTask(task.id)}
                    >
                      {props.locale.get("DOWNLOAD_PAUSE")}
                    </button>
                  </Show>
                  <Show
                    when={
                      task.status === "paused" &&
                      task.canResume &&
                      !isLocked(task)
                    }
                  >
                    <button
                      type="button"
                      class="download-queue-action"
                      onClick={() => void resumeDownloadTask(task.id)}
                    >
                      {props.locale.get("DOWNLOAD_RESUME")}
                    </button>
                  </Show>
                  <Show when={task.engines.length > 0}>
                    <button
                      type="button"
                      class="download-queue-action download-queue-action--expand"
                      aria-expanded={Boolean(expanded()[task.id])}
                      onClick={() => toggleExpanded(task.id)}
                    >
                      {props.locale.get(
                        expanded()[task.id]
                          ? "DOWNLOAD_TASK_COLLAPSE"
                          : "DOWNLOAD_TASK_EXPAND"
                      )}
                    </button>
                  </Show>
                  <Show when={task.canCancel && !isLocked(task)}>
                    <button
                      type="button"
                      class="download-queue-action download-queue-action--cancel"
                      onClick={() => void cancelDownloadTask(task.id)}
                    >
                      {props.locale.get("CANCEL_DOWNLOAD")}
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </AppModal>
  );
}
