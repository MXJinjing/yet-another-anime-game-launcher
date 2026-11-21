import { Progress, ProgressIndicator } from "@hope-ui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type { DownloadTaskSnapshot } from "../../download/types";
import type { ActivitySample } from "../../integrations/sophon-activity";
import type { SophonMetric } from "../../integrations/sophon-progress";
import type { Locale } from "../../locale";
import { downloadManagerText } from "../../locale/download-manager";
import { formatDownloadSpeed, humanFileSize } from "../../runtime/format";

const network = (sample: ActivitySample) => sample.values["common.network"];
const disk = (sample: ActivitySample) =>
  sample.values["disk.write"] ?? sample.values["common.write"];

function formatRate(rate: number | undefined) {
  return rate === undefined ? "—" : formatDownloadSpeed(rate);
}

function metricPercent(metric: SophonMetric | undefined) {
  return (
    metric?.percentage ??
    (metric?.total ? (metric.completed / metric.total) * 100 : undefined)
  );
}

function formatRemaining(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  const duration = Math.max(0, Math.ceil(seconds));
  return [
    Math.floor(duration / 3600),
    Math.floor(duration / 60) % 60,
    duration % 60,
  ]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

const CHART_WINDOW = 60;
const CHART_GAP = 2.5;

function valueAt(
  history: readonly ActivitySample[],
  time: number,
  read: (sample: ActivitySample) => number | undefined
) {
  let previous: ActivitySample | undefined;
  let next: ActivitySample | undefined;
  for (const sample of history) {
    if (read(sample) === undefined) continue;
    if (sample.time <= time) previous = sample;
    if (sample.time >= time) {
      next = sample;
      break;
    }
  }
  if (
    previous &&
    next &&
    previous !== next &&
    next.time - previous.time <= CHART_GAP
  ) {
    const span = next.time - previous.time;
    const ratio = span === 0 ? 0 : (time - previous.time) / span;
    return (
      (read(previous) ?? 0) +
      ((read(next) ?? 0) - (read(previous) ?? 0)) * ratio
    );
  }
  const nearest = [previous, next]
    .filter((sample): sample is ActivitySample => sample !== undefined)
    .sort(
      (left, right) => Math.abs(left.time - time) - Math.abs(right.time - time)
    )[0];
  return nearest && Math.abs(nearest.time - time) <= CHART_GAP / 2
    ? read(nearest)
    : undefined;
}

function formatChartTime(seconds: number) {
  const duration = Math.max(0, Math.round(seconds));
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(
    2,
    "0"
  )}`;
}

export function TransferChart(props: {
  history: readonly ActivitySample[];
  locale: Locale;
}) {
  const text = () => downloadManagerText(props.locale.currentLanguage);
  let frame: HTMLDivElement | undefined;
  const [hover, setHover] = createSignal<{
    x: number;
    tipX: number;
    networkY?: number;
    diskY?: number;
    time: number;
    network?: number;
    disk?: number;
  }>();
  createEffect(() => {
    if (!hover()) return;
    const hideIfOutside = (event: PointerEvent) => {
      if (!frame) return;
      const bounds = frame.getBoundingClientRect();
      const outside =
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom;
      if (outside) setHover();
    };
    const hide = () => setHover();
    window.addEventListener("pointermove", hideIfOutside);
    window.addEventListener("pointerup", hideIfOutside);
    window.addEventListener("blur", hide);
    onCleanup(() => {
      window.removeEventListener("pointermove", hideIfOutside);
      window.removeEventListener("pointerup", hideIfOutside);
      window.removeEventListener("blur", hide);
    });
  });
  const paths = createMemo(() => {
    const history = props.history;
    const end = history[history.length - 1]?.time ?? 0;
    const maxRate = Math.max(
      1,
      ...history.map(sample =>
        Math.max(network(sample) ?? 0, disk(sample) ?? 0)
      )
    );
    return [network, disk].map(rateFor => {
      let previousTime: number | undefined;
      return history
        .map(sample => {
          const rate = rateFor(sample);
          if (rate === undefined) {
            previousTime = undefined;
            return "";
          }
          const command =
            previousTime !== undefined &&
            sample.time - previousTime <= CHART_GAP
              ? "L"
              : "M";
          previousTime = sample.time;
          const x = CHART_WINDOW - end + sample.time;
          const y = 96 - (rate / maxRate) * 85;
          return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
    });
  });
  const readPoint = (event: PointerEvent) => {
    const history = props.history;
    const frame = event.currentTarget;
    if (!(frame instanceof HTMLElement) || history.length === 0) {
      setHover();
      return;
    }
    const bounds = frame.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - bounds.left) / bounds.width)
    );
    const end = history[history.length - 1]?.time ?? 0;
    const time = end - CHART_WINDOW + ratio * CHART_WINDOW;
    const x = ratio * bounds.width;
    const maxRate = Math.max(
      1,
      ...history.map(sample =>
        Math.max(network(sample) ?? 0, disk(sample) ?? 0)
      )
    );
    const yFor = (rate: number | undefined) =>
      rate === undefined
        ? undefined
        : ((96 - (rate / maxRate) * 85) / 100) * bounds.height;
    const networkValue = valueAt(history, time, network);
    const diskValue = valueAt(history, time, disk);
    setHover({
      x,
      tipX:
        ratio > 0.62
          ? Math.max(8, x - 156)
          : Math.min(x + 14, bounds.width - 156),
      networkY: yFor(networkValue),
      diskY: yFor(diskValue),
      time,
      network: networkValue,
      disk: diskValue,
    });
  };

  return (
    <div
      ref={frame}
      class="download-manager-chart-frame"
      onPointerMove={readPoint}
      onPointerLeave={() => setHover()}
      onPointerCancel={() => setHover()}
    >
      <svg
        class="download-manager-chart"
        viewBox="0 0 60 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <For each={paths()}>
          {(path, index) => (
            <path
              class={index() === 0 ? "is-network" : "is-disk"}
              d={path}
              fill="none"
              vector-effect="non-scaling-stroke"
            />
          )}
        </For>
      </svg>
      <div
        class="download-chart-overlay"
        hidden={!hover()}
        style={{ display: hover() ? "block" : "none" }}
      >
        <span
          class="download-chart-cursor"
          style={{ left: `${hover()?.x ?? 0}px` }}
        />
        <Show when={hover()?.networkY !== undefined}>
          <span
            class="download-chart-dot is-network"
            style={{
              left: `${hover()?.x ?? 0}px`,
              top: `${hover()?.networkY}px`,
            }}
          />
        </Show>
        <Show when={hover()?.diskY !== undefined}>
          <span
            class="download-chart-dot is-disk"
            style={{
              left: `${hover()?.x ?? 0}px`,
              top: `${hover()?.diskY}px`,
            }}
          />
        </Show>
        <div
          class="download-chart-tip"
          role="tooltip"
          style={{ left: `${hover()?.tipX ?? 0}px` }}
        >
          <strong>{formatChartTime(hover()?.time ?? 0)}</strong>
          <span>
            <i class="is-network" />
            {text().network}
            <b>{formatRate(hover()?.network)}</b>
          </span>
          <span>
            <i class="is-disk" />
            {text().disk}
            <b>{formatRate(hover()?.disk)}</b>
          </span>
        </div>
      </div>
    </div>
  );
}

export function DownloadTaskDetail(props: {
  task: DownloadTaskSnapshot;
  locale: Locale;
  status: string;
  fileProgress?: { label: string; value: number };
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onDetails?: () => void;
}) {
  const text = () => downloadManagerText(props.locale.currentLanguage);
  const activity = createMemo(() =>
    Array.from(props.task.sophonActivities?.values() ?? []).find(
      item => item.status === "starting" || item.status === "running"
    )
  );
  const active = () => props.task.status === "active";
  const history = () => (active() ? activity()?.history ?? [] : []);
  const common = () => activity()?.progress?.metrics.common;
  const downloaded = () => common()?.network.completed ?? props.task.downloaded;
  const total = () =>
    common()?.network.total ?? (props.task.total || undefined);
  const transferValue = () =>
    metricPercent(common()?.network) ??
    (props.task.transferring && !props.task.indeterminate
      ? props.task.progress
      : props.fileProgress?.value);
  const remaining = () => {
    if (!active() || !props.task.transferring) return undefined;
    const estimate = common()?.timing.etaSeconds;
    if (estimate !== undefined) return estimate;
    const size = total();
    return props.task.speed > 0 && size !== undefined
      ? (size - downloaded()) / props.task.speed
      : undefined;
  };
  const meta = () => {
    if (props.fileProgress && !props.task.transferring) {
      return props.fileProgress.label;
    }
    const size = `${humanFileSize(downloaded())} / ${
      total() === undefined
        ? props.locale.get("DOWNLOAD_TASK_UNKNOWN_SIZE")
        : humanFileSize(total() ?? 0)
    }`;
    const eta =
      remaining() !== undefined
        ? `${text().remaining} ${formatRemaining(remaining())}`
        : undefined;
    return [size, eta].filter(Boolean).join(" · ");
  };

  return (
    <div class="download-task-detail">
      <div class="download-task-meter">
        <span>
          {props.fileProgress && !props.task.transferring
            ? props.locale.get("DOWNLOAD_FILE_INDEX")
            : text().download}
        </span>
        <span>{meta()}</span>
      </div>
      <Progress
        class="download-task-bar"
        aria-label={props.status}
        value={Math.min(100, Math.max(0, transferValue() ?? 0))}
        indeterminate={transferValue() === undefined}
        size="xs"
      >
        <ProgressIndicator style="transition: none;" />
      </Progress>
      <div class="download-task-actions">
        <Show when={props.onPause}>
          <button
            type="button"
            class="download-task-action is-primary"
            onClick={() => props.onPause?.()}
          >
            <span
              class="download-task-action-icon is-pause"
              aria-hidden="true"
            />
            {props.locale.get("DOWNLOAD_PAUSE")}
          </button>
        </Show>
        <Show when={props.onResume}>
          <button
            type="button"
            class="download-task-action is-primary"
            onClick={() => props.onResume?.()}
          >
            <span
              class="download-task-action-icon is-play"
              aria-hidden="true"
            />
            {props.locale.get("DOWNLOAD_RESUME")}
          </button>
        </Show>
        <Show when={props.onDetails}>
          <button
            type="button"
            class="download-task-action"
            onClick={() => props.onDetails?.()}
          >
            <span
              class="download-task-action-icon is-file"
              aria-hidden="true"
            />
            {text().details}
          </button>
        </Show>
        <Show when={props.onCancel}>
          <button
            type="button"
            class="download-task-action is-danger"
            onClick={() => props.onCancel?.()}
          >
            <span
              class="download-task-action-icon is-close"
              aria-hidden="true"
            />
            {text().cancel}
          </button>
        </Show>
      </div>
    </div>
  );
}
