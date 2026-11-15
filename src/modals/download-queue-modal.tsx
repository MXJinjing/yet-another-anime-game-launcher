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
import { downloadManagerText } from "../locale/download-manager";
import downloadIcon from "../assets/icons/download.svg";
import settingsIcon from "../assets/icons/settings.svg";
import { DownloadActiveTask } from "./download-active-task";
import "./download-queue-modal.css";

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
  accentColor?: string;
  accentText?: string;
  onClose: () => void;
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
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
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
      title={
        <span class="download-manager-title">
          <span class="download-manager-title-icon">
            <img src={downloadIcon} alt="" />
          </span>
          {props.locale.get("DOWNLOAD_MANAGER")}
        </span>
      }
      contentClass="download-manager"
      contentStyle={{
        "--download-accent": props.accentColor,
        "--download-accent-text": props.accentText,
      }}
      bodyClass="download-manager-body"
    >
      <button
        class="download-manager-settings"
        type="button"
        aria-label={text().settings}
        title={text().settings}
        onClick={props.onOpenSettings}
      >
        <img src={settingsIcon} alt="" />
      </button>
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
      <section class="download-manager-queue" aria-labelledby={queueHeadingId}>
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
                  classList={{ "is-featured": selectedTask()?.id === task.id }}
                >
                  <div class="download-queue-item-icon" aria-hidden="true">
                    {props.renderTaskIcon(task)}
                  </div>
                  <div class="download-queue-item-header">
                    <div class="download-queue-item-titles">
                      <div class="download-queue-item-title" title={task.title}>
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
                                  <div class="download-queue-file-meta">
                                    <span>{percent(file.progress)}</span>
                                    <span>
                                      {formatDownloadSpeed(file.speed)}
                                    </span>
                                    <span>
                                      {humanFileSize(file.downloaded)} /{" "}
                                      {file.total > 0
                                        ? humanFileSize(file.total)
                                        : props.locale.get(
                                            "DOWNLOAD_TASK_UNKNOWN_SIZE"
                                          )}
                                    </span>
                                  </div>
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
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
    </AppModal>
  );
}
