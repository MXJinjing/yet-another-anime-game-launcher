import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
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
import { Locale, type LocaleTextKey } from "../../locale";
import { reconcileDownloadTasks } from "../../download/solid-store";
import { DownloadTaskDetail, TransferChart } from "./download-task-overview";
import { downloadManagerText } from "../../locale/download-manager";
import { formatDownloadSpeed } from "../../runtime/format";
import type { ActivitySample } from "../../integrations/sophon-activity";
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

const networkRate = (sample: ActivitySample) => sample.values["common.network"];
const diskRate = (sample: ActivitySample) =>
  sample.values["disk.write"] ?? sample.values["common.write"];

function percent(value: number): string {
  return `${Math.min(100, Math.max(0, value)).toFixed(1)}%`;
}

export function taskStatusText(task: DownloadTaskSnapshot, locale: Locale) {
  if (task.status === "active" && task.phaseKind === "verifying") {
    return locale.get("DOWNLOAD_STATUS_VERIFYING");
  }
  if (task.phase && !/\d+\s*\/\s*\d+/.test(task.phase)) return task.phase;
  return locale.get(STATUS_LOCALE_KEYS[task.status]);
}

export function taskFileProgress(task: DownloadTaskSnapshot) {
  if (
    task.fileIndex === undefined ||
    task.fileCount === undefined ||
    task.fileCount <= 0
  ) {
    return undefined;
  }
  return {
    label: `${task.fileIndex} / ${task.fileCount}`,
    value: (task.fileIndex / task.fileCount) * 100,
  };
}

export function DownloadManager(props: {
  locale: Locale;
  initialTaskId?: string;
  accent?: string;
  accentText?: string;
  renderTaskIcon: (task: DownloadTaskSnapshot) => JSX.Element;
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
  const [selectedTaskId, setSelectedTaskId] = createSignal(props.initialTaskId);
  const selectedTask = createMemo(
    () =>
      tasks.find(task => task.id === selectedTaskId()) ??
      tasks.find(task => task.status === "active") ??
      tasks[0]
  );
  const [globalTaskActive, setGlobalTaskActive] = createSignal(
    getGlobalTaskActive()
  );

  createEffect(() => {
    const id = props.initialTaskId;
    if (id) setSelectedTaskId(id);
  });

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
  const text = () => downloadManagerText(props.locale.currentLanguage);
  const telemetry = createMemo(() => {
    const task = selectedTask();
    if (!task) return undefined;
    const activity = Array.from(task.sophonActivities?.values() ?? []).sort(
      (left, right) =>
        (right.history.at(-1)?.time ?? 0) - (left.history.at(-1)?.time ?? 0)
    )[0];
    const live = task.status === "active";
    const history = activity?.history ?? [];
    const latest = history.at(-1);
    const peak = history.reduce<number | undefined>((maximum, sample) => {
      const rate = networkRate(sample);
      return rate === undefined ? maximum : Math.max(maximum ?? 0, rate);
    }, undefined);
    return {
      history,
      network: live
        ? activity?.progress?.metrics.common.network.rate ??
          (task.transferring ? task.speed : undefined)
        : undefined,
      disk: live
        ? (latest && diskRate(latest)) ??
          activity?.progress?.metrics.common.write.rate
        : undefined,
      peak,
    };
  });

  return (
    <div
      class="download-manager"
      style={{
        "--download-accent": props.accent,
        "--download-accent-text": props.accentText,
      }}
    >
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
        <div class="download-task-list">
          <For each={tasks}>
            {task => {
              const open = () => selectedTask()?.id === task.id;
              const files = () => taskFileProgress(task);
              const status = () => taskStatusText(task, props.locale);
              return (
                <article
                  class="download-task"
                  classList={{ "is-open": open(), [`is-${task.status}`]: true }}
                >
                  <button
                    class="download-task-select"
                    type="button"
                    aria-pressed={open()}
                    aria-label={task.title}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <span class="download-task-avatar" aria-hidden="true">
                      {props.renderTaskIcon(task)}
                    </span>
                    <span class="download-task-copy">
                      <strong>{task.title}</strong>
                      <small>
                        <i />
                        {status()}
                      </small>
                    </span>
                    <Show when={!open()}>
                      <span class="download-task-aside">
                        {files()?.label ??
                          (task.indeterminate ? "" : percent(task.progress))}
                      </span>
                    </Show>
                  </button>
                  <Show when={open()}>
                    <DownloadTaskDetail
                      task={task}
                      locale={props.locale}
                      status={status()}
                      fileProgress={files()}
                      onPause={
                        (task.status === "active" ||
                          task.status === "queued") &&
                        task.canPause &&
                        !isLocked(task)
                          ? () => void pauseDownloadTask(task.id)
                          : undefined
                      }
                      onResume={
                        task.status === "paused" &&
                        task.canResume &&
                        !isLocked(task)
                          ? () => void resumeDownloadTask(task.id)
                          : undefined
                      }
                      onCancel={
                        task.canCancel && !isLocked(task)
                          ? () => void cancelDownloadTask(task.id)
                          : undefined
                      }
                      onDetails={
                        task.engines.length > 0
                          ? () => setDetailTaskId(task.id)
                          : undefined
                      }
                    />
                  </Show>
                </article>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={telemetry()}>
        {rates => (
          <footer class="download-telemetry" aria-label={text().network}>
            <dl>
              <div>
                <dt>{text().network}</dt>
                <dd>
                  {rates().network === undefined
                    ? "—"
                    : formatDownloadSpeed(rates().network ?? 0)}
                </dd>
              </div>
              <div class="is-peak">
                <dt>{text().peak}</dt>
                <dd>
                  {rates().peak === undefined
                    ? "—"
                    : formatDownloadSpeed(rates().peak ?? 0)}
                </dd>
              </div>
              <div class="is-disk">
                <dt>{text().disk}</dt>
                <dd>
                  {rates().disk === undefined
                    ? "—"
                    : formatDownloadSpeed(rates().disk ?? 0)}
                </dd>
              </div>
            </dl>
            <TransferChart history={rates().history} locale={props.locale} />
          </footer>
        )}
      </Show>
      <DownloadTaskDetailsModal
        task={detailTask()}
        locale={props.locale}
        onClose={() => setDetailTaskId()}
      />
    </div>
  );
}
