import { Progress, ProgressIndicator } from "@hope-ui/solid";
import {
  For,
  Show,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
} from "solid-js";
import type { JSX } from "solid-js";
import { createStore } from "solid-js/store";
import {
  cancelDownloadTask,
  getGlobalTaskActive,
  pauseDownloadTask,
  resumeDownloadTask,
  subscribe as subscribeDownloadQueue,
} from "../../download/stream-scheduler";
import {
  type DownloadTaskSnapshot,
  getDownloadTasks,
  subscribeDownloadTasks,
} from "../../download/task-registry";
import { Locale, LocaleTextKey } from "../../locale";
import { formatDownloadSpeed, humanFileSize } from "../../runtime/format";
import { reconcileDownloadTasks } from "../../download/solid-store";
import { downloadManagerText } from "../../locale/download-manager";
import settingsIcon from "../../assets/icons/settings.svg";
import { DownloadActiveTask } from "./download-active-task";
import { DownloadTaskDetailsModal } from "../../modals/download-task-details-modal";
import "./download-manager.css";

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

export function DownloadManager(props: {
  locale: Locale;
  renderTaskIcon: (task: DownloadTaskSnapshot) => JSX.Element;
  getTaskArtwork: (task: DownloadTaskSnapshot) => string | undefined;
  onOpenSettings: () => void;
}) {
  const [tasks, setTasks] = createStore<DownloadTaskSnapshot[]>(
    getDownloadTasks().map(task => ({
      ...task,
      engines: [...task.engines],
      files: task.files.map(file => ({ ...file })),
    }))
  );
  const [detailTaskId, setDetailTaskId] = createSignal<string>();
  const detailTask = () => tasks.find(task => task.id === detailTaskId());
  const [selectedTaskId, setSelectedTaskId] = createSignal<string>();
  const queueHeadingId = createUniqueId();
  const text = () => downloadManagerText(props.locale.currentLanguage);
  const activityTasks = createMemo(() =>
    tasks.filter(task => task.status === "active")
  );
  const selectedTask = createMemo(
    () =>
      activityTasks().find(task => task.id === selectedTaskId()) ??
      activityTasks()[0]
  );
  const [globalTaskActive, setGlobalTaskActive] = createSignal(
    getGlobalTaskActive()
  );

  onCleanup(
    subscribeDownloadTasks(next => {
      setTasks(reconcileDownloadTasks(next));
    })
  );
  onCleanup(
    subscribeDownloadQueue(() => {
      setGlobalTaskActive(getGlobalTaskActive());
    })
  );

  const isLocked = (task: DownloadTaskSnapshot) =>
    globalTaskActive() && Boolean(task.key);

  return (
    <div class="download-manager">
      <header class="download-manager-header">
        <h1 class="download-manager-title">
          {props.locale.get("DOWNLOAD_MANAGER")}
        </h1>
        <button
          class="download-manager-settings"
          type="button"
          aria-label={text().settings}
          title={text().settings}
          onClick={props.onOpenSettings}
        >
          <img src={settingsIcon} alt="" />
        </button>
      </header>
      <div class="download-manager-body">
        <Show when={selectedTask()}>
          {task => (
            <DownloadActiveTask
              task={task()}
              tasks={activityTasks()}
              locale={props.locale}
              status={taskStatusText(task(), props.locale)}
              artwork={props.getTaskArtwork(task())}
              renderTaskIcon={props.renderTaskIcon}
              onSelect={setSelectedTaskId}
              onPause={
                task().canPause && !isLocked(task())
                  ? () => void pauseDownloadTask(task().id)
                  : undefined
              }
            />
          )}
        </Show>
        <section
          class="download-manager-queue"
          aria-labelledby={queueHeadingId}
        >
          <h2 id={queueHeadingId}>
            {text().queue} <span>({tasks.length})</span>
          </h2>
          <Show when={globalTaskActive()}>
            <div class="download-queue-global-hint">
              {props.locale.get("DOWNLOAD_MANAGER_GLOBAL_TASK_WAITING")}
            </div>
          </Show>
          <Show
            when={tasks.length > 0}
            fallback={
              <div class="download-queue-empty">
                {props.locale.get("DOWNLOAD_MANAGER_EMPTY")}
              </div>
            }
          >
            <div class="download-queue-list">
              <For each={tasks}>
                {task => (
                  <div
                    class="download-queue-item"
                    classList={{
                      "is-featured": selectedTask()?.id === task.id,
                    }}
                  >
                    <div class="download-queue-item-icon" aria-hidden="true">
                      {props.renderTaskIcon(task)}
                    </div>
                    <div class="download-queue-item-header">
                      <div class="download-queue-item-titles">
                        <div
                          class="download-queue-item-title"
                          title={task.title}
                        >
                          {task.title}
                        </div>
                        <Show when={task.phase}>
                          <div
                            class="download-queue-item-phase"
                            title={task.phase}
                          >
                            {task.phase}
                          </div>
                        </Show>
                      </div>
                      <div class="download-queue-item-status">
                        <span class="download-queue-total-percent">
                          {task.indeterminate ? " " : percent(task.progress)}
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
                    <div class="download-queue-item-transfer">
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
                        <span>{formatDownloadSpeed(task.speed)}</span>
                      </div>
                    </div>

                    <div class="download-queue-item-actions">
                      <Show
                        when={
                          (task.status === "active" ||
                            task.status === "queued") &&
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
                          aria-haspopup="dialog"
                          onClick={() => setDetailTaskId(task.id)}
                        >
                          {props.locale.get("DOWNLOAD_TASK_EXPAND")}
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
        </section>
      </div>
      <DownloadTaskDetailsModal
        task={detailTask()}
        locale={props.locale}
        onClose={() => setDetailTaskId()}
      />
    </div>
  );
}
