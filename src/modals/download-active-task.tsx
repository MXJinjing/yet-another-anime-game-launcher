import { Progress, ProgressIndicator } from "@hope-ui/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { DownloadTaskSnapshot } from "../download/types";
import type { ActivitySample } from "../integrations/sophon-activity";
import type { SophonMetric } from "../integrations/sophon-progress";
import type { Locale } from "../locale";
import { downloadManagerText } from "../locale/download-manager";
import { sophonDownloaderText } from "../locale/sophon-downloader";
import { formatDownloadSpeed, humanFileSize } from "../runtime/format";
import pauseIcon from "../assets/icons/pause.svg";
import { SophonDownloadDetails } from "./sophon-download-details";

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

function TransferChart(props: { history: readonly ActivitySample[] }) {
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
            previousTime !== undefined && sample.time - previousTime <= 2.5
              ? "L"
              : "M";
          previousTime = sample.time;
          const x = 60 - end + sample.time;
          const y = 96 - (rate / maxRate) * 85;
          return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
    });
  });

  return (
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
  );
}

function TransferProgress(props: {
  label: string;
  text: string;
  value?: number;
  install?: boolean;
}) {
  return (
    <div class="download-manager-transfer-progress">
      <div>
        <span>{props.label}</span>
        <span>{props.text}</span>
      </div>
      <Progress
        aria-label={props.label}
        classList={{
          "download-manager-meter": true,
          "download-manager-meter--install": props.install,
        }}
        value={Math.min(100, Math.max(0, props.value ?? 0))}
        indeterminate={props.value === undefined}
        size="xs"
      >
        <ProgressIndicator style="transition: none;" />
      </Progress>
    </div>
  );
}

export function DownloadActiveTask(props: {
  task: DownloadTaskSnapshot;
  tasks: readonly DownloadTaskSnapshot[];
  locale: Locale;
  status: string;
  artwork?: string;
  renderTaskIcon: (task: DownloadTaskSnapshot) => JSX.Element;
  onSelect: (id: string) => void;
  onPause?: () => void;
}) {
  const text = () => downloadManagerText(props.locale.currentLanguage);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const activity = createMemo(() =>
    Array.from(props.task.sophonActivities?.values() ?? []).find(
      item => item.status === "starting" || item.status === "running"
    )
  );
  const history = () => activity()?.history ?? [];
  const snapshot = () => activity()?.progress;
  const common = () => snapshot()?.metrics.common;
  const peak = createMemo(() =>
    history().reduce<number | undefined>((maximum, sample) => {
      const rate = network(sample);
      return rate === undefined ? maximum : Math.max(maximum ?? 0, rate);
    }, undefined)
  );
  const diskWrite = () => {
    const samples = history();
    const latest = samples[samples.length - 1];
    return (latest && disk(latest)) ?? common()?.write.rate;
  };
  const installPercent = () =>
    snapshot()?.phase === "scanning" || activity()?.predownload
      ? undefined
      : metricPercent(common()?.files);
  const downloaded = () => common()?.network.completed ?? props.task.downloaded;
  const total = () =>
    common()?.network.total ?? (props.task.total || undefined);
  const remaining = () => {
    const estimate = common()?.timing.etaSeconds;
    if (estimate !== undefined) return estimate;
    const size = total();
    return props.task.transferring && props.task.speed > 0 && size !== undefined
      ? (size - downloaded()) / props.task.speed
      : undefined;
  };

  return (
    <>
      <section class="download-manager-active" aria-label={props.task.title}>
        <Show when={props.artwork} keyed>
          {url => (
            <img
              class="download-manager-art"
              src={url}
              alt=""
              onError={event => (event.currentTarget.hidden = true)}
            />
          )}
        </Show>
        <div class="download-manager-active-identity">
          <Show when={props.tasks.length > 1}>
            <div
              class="download-manager-task-switcher"
              role="group"
              aria-label={
                sophonDownloaderText(props.locale.currentLanguage).activityTitle
              }
            >
              <For each={props.tasks}>
                {task => (
                  <button
                    type="button"
                    aria-label={task.title}
                    aria-pressed={task.id === props.task.id}
                    title={task.title}
                    onClick={() => props.onSelect(task.id)}
                  >
                    {props.renderTaskIcon(task)}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <h2>{props.task.title}</h2>
          <p>{props.status}</p>
        </div>
        <Show when={history().length > 1}>
          <TransferChart history={history()} />
        </Show>
        <div class="download-manager-telemetry">
          <dl class="download-manager-rates">
            <div>
              <dt>{text().network}</dt>
              <dd>{formatRate(common()?.network.rate ?? props.task.speed)}</dd>
            </div>
            <Show when={peak() !== undefined}>
              <div class="is-peak">
                <dt>{text().peak}</dt>
                <dd>{formatRate(peak())}</dd>
              </div>
            </Show>
            <Show when={common()}>
              <div class="is-disk">
                <dt>{text().disk}</dt>
                <dd>{formatRate(diskWrite())}</dd>
              </div>
            </Show>
          </dl>
          <TransferProgress
            label={text().download}
            text={`${humanFileSize(downloaded())} / ${
              total() === undefined
                ? props.locale.get("DOWNLOAD_TASK_UNKNOWN_SIZE")
                : humanFileSize(total() ?? 0)
            }`}
            value={
              metricPercent(common()?.network) ??
              (props.task.transferring && !props.task.indeterminate
                ? props.task.progress
                : undefined)
            }
          />
          <Show when={installPercent() !== undefined}>
            <TransferProgress
              label={text().install}
              text={`${Math.min(100, installPercent() ?? 0).toFixed(1)}%`}
              value={installPercent()}
              install
            />
          </Show>
          <div class="download-manager-task-controls">
            <span>
              {text().remaining}
              <strong>{formatRemaining(remaining())}</strong>
            </span>
            <Show when={props.onPause}>
              <button
                class="download-manager-pause"
                type="button"
                title={props.locale.get("DOWNLOAD_PAUSE")}
                aria-label={props.locale.get("DOWNLOAD_PAUSE")}
                onClick={() => props.onPause?.()}
              >
                <img src={pauseIcon} alt="" />
              </button>
            </Show>
          </div>
        </div>
      </section>
      <Show when={activity()}>
        {selected => (
          <details
            class="download-manager-diagnostics"
            onToggle={event => setDetailsOpen(event.currentTarget.open)}
          >
            <summary>{props.locale.get("DOWNLOAD_TASK_EXPAND")}</summary>
            <Show when={detailsOpen()}>
              <Show when={selected().id} keyed>
                {() => (
                  <SophonDownloadDetails
                    activity={selected()}
                    locale={props.locale}
                    paused={false}
                  />
                )}
              </Show>
            </Show>
          </details>
        )}
      </Show>
    </>
  );
}
