import { getKeyOrDefault, log } from "./utils";
import {
  DOWNLOAD_SPEED_LIMIT_ENABLED_KEY,
  DOWNLOAD_SPEED_LIMIT_VALUE_KEY,
  DOWNLOAD_SPEED_LIMIT_UNIT_KEY,
  MAX_CONCURRENT_DOWNLOADS_KEY,
  speedLimitConfigToBps,
} from "./download-budget";

export type DownloadStreamKind = "aria2" | "sophon";

export type DownloadStatus =
  | "queued"
  | "active"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export interface DownloadStream {
  id: string;
  kind: DownloadStreamKind;
  taskId: string;
  /** Optional association with a per-game download-control key (storage
   *  namespace), so both the status panel and the download manager can
   *  address the same stream. Undefined streams are launcher-global. */
  key?: string;
  title: string;
  status: DownloadStatus;
  progress: number;
  speed: number;
  downloaded: number;
  total: number;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  setSpeedLimit: (bps: number) => Promise<void>;
}

type StreamUpdatePatch = Partial<
  Pick<
    DownloadStream,
    | "status"
    | "progress"
    | "speed"
    | "downloaded"
    | "total"
    | "canPause"
    | "canResume"
    | "canCancel"
  >
>;

const streams = new Map<string, DownloadStream>();
const lastLimitByStream = new Map<string, number>();
const listeners = new Set<(streams: readonly DownloadStream[]) => void>();

let budgetBps = 0;
let maxConcurrent = 0;
let recomputing = false;
let globalTaskActive = false;

function getStreamSnapshot(): readonly DownloadStream[] {
  return [...streams.values()];
}

function countActiveStreams(): number {
  let count = 0;
  for (const stream of streams.values()) {
    if (stream.status === "active") {
      count += 1;
    }
  }
  return count;
}

function findFirstQueuedStream(): DownloadStream | undefined {
  for (const stream of streams.values()) {
    if (stream.status === "queued") {
      // While a launcher-global task runs, hold per-game downloads queued so
      // they don't start in parallel with the global task.
      if (globalTaskActive && stream.key) {
        continue;
      }
      return stream;
    }
  }
  return undefined;
}

function findLastActiveStream(): DownloadStream | undefined {
  let last: DownloadStream | undefined;
  for (const stream of streams.values()) {
    if (stream.status === "active") {
      last = stream;
    }
  }
  return last;
}

async function runStreamAction(
  stream: DownloadStream,
  action: () => Promise<void>,
  actionName: string
): Promise<void> {
  try {
    await action();
  } catch (error) {
    log(
      `download-queue: failed to ${actionName} stream ${stream.id}: ${String(
        error
      )}`
    );
  }
}

function pushSpeedLimit(stream: DownloadStream, bps: number): void {
  const lastLimit = lastLimitByStream.get(stream.id) ?? 0;
  if (lastLimit === bps) {
    return;
  }
  lastLimitByStream.set(stream.id, bps);
  void runStreamAction(stream, () => stream.setSpeedLimit(bps), "limit");
}

function recomputeSlots(): void {
  if (maxConcurrent > 0) {
    while (countActiveStreams() > maxConcurrent) {
      const overflow = findLastActiveStream();
      if (!overflow) {
        break;
      }
      overflow.status = "queued";
      void runStreamAction(overflow, () => overflow.pause(), "pause");
    }
  }
  while (maxConcurrent === 0 || countActiveStreams() < maxConcurrent) {
    const next = findFirstQueuedStream();
    if (!next) {
      break;
    }
    next.status = "active";
    void runStreamAction(next, () => next.resume(), "resume");
  }
}

function recomputeBudget(): void {
  const activeStreams = [...streams.values()].filter(
    stream => stream.status === "active"
  );
  if (budgetBps > 0 && activeStreams.length > 0) {
    const share = Math.max(1, Math.floor(budgetBps / activeStreams.length));
    for (const stream of activeStreams) {
      pushSpeedLimit(stream, share);
    }
    return;
  }
  for (const stream of streams.values()) {
    if ((lastLimitByStream.get(stream.id) ?? 0) !== 0) {
      pushSpeedLimit(stream, 0);
    }
  }
}

function recompute(): void {
  if (recomputing) {
    return;
  }
  recomputing = true;
  try {
    recomputeSlots();
    recomputeBudget();
    emit();
  } finally {
    recomputing = false;
  }
}

function emit(): void {
  const snapshot = getStreamSnapshot();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function registerStream(stream: DownloadStream): void {
  const activeCount = countActiveStreams();
  if (maxConcurrent > 0 && activeCount >= maxConcurrent) {
    stream.status = "queued";
    void runStreamAction(stream, () => stream.pause(), "pause");
  } else {
    stream.status = "active";
  }
  streams.set(stream.id, stream);
  lastLimitByStream.set(stream.id, 0);
  recompute();
}

export function unregisterStream(id: string): void {
  if (!streams.delete(id)) {
    return;
  }
  lastLimitByStream.delete(id);
  recompute();
}

export function updateStream(id: string, patch: StreamUpdatePatch): void {
  const stream = streams.get(id);
  if (!stream) {
    return;
  }
  const statusChanged =
    patch.status !== undefined && patch.status !== stream.status;
  Object.assign(stream, patch);
  if (statusChanged) {
    recompute();
  } else {
    emit();
  }
}

export function subscribe(
  listener: (streams: readonly DownloadStream[]) => void
): () => void {
  listeners.add(listener);
  listener(getStreamSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getStreams(): readonly DownloadStream[] {
  return getStreamSnapshot();
}

export function getStreamsByKey(key: string): readonly DownloadStream[] {
  return getStreamSnapshot().filter(stream => (stream.key ?? "") === key);
}

export function getActiveStreamCount(): number {
  return countActiveStreams();
}

/** Whether a launcher-global task (e.g. Wine environment init) is running.
 *  While true, per-game download streams are locked: resume/cancel are refused
 *  and queued per-game streams are not promoted, so the global task keeps the
 *  download bandwidth. Global streams (no key) are never locked. */
export function setGlobalTaskActive(active: boolean): void {
  if (globalTaskActive === active) {
    return;
  }
  globalTaskActive = active;
  emit();
}

export function getGlobalTaskActive(): boolean {
  return globalTaskActive;
}

export async function reloadConfig(): Promise<void> {
  const enabled =
    (await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_ENABLED_KEY, "false")) ===
    "true";
  const rawValue = await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_VALUE_KEY, "0");
  const unit = await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_UNIT_KEY, "K");
  budgetBps = speedLimitConfigToBps(enabled, Number(rawValue), unit);
  const rawConcurrent = await getKeyOrDefault(
    MAX_CONCURRENT_DOWNLOADS_KEY,
    "0"
  );
  const parsedConcurrent = Number(rawConcurrent);
  maxConcurrent =
    Number.isFinite(parsedConcurrent) && parsedConcurrent > 0
      ? Math.floor(parsedConcurrent)
      : 0;
  recompute();
}

export async function pauseStream(id: string): Promise<void> {
  const stream = streams.get(id);
  if (!stream) {
    return;
  }
  if (stream.status === "active") {
    stream.status = "paused";
    await runStreamAction(stream, () => stream.pause(), "pause");
    recompute();
  } else if (stream.status === "queued") {
    stream.status = "paused";
    emit();
  }
}

export async function resumeStream(id: string): Promise<void> {
  const stream = streams.get(id);
  if (!stream || stream.status !== "paused") {
    return;
  }
  if (globalTaskActive && stream.key) {
    log(`download-queue: resume refused for ${id} while a global task runs`);
    return;
  }
  if (maxConcurrent > 0 && countActiveStreams() >= maxConcurrent) {
    stream.status = "queued";
    emit();
    return;
  }
  stream.status = "active";
  await runStreamAction(stream, () => stream.resume(), "resume");
  recompute();
}

export async function cancelStream(id: string): Promise<void> {
  const stream = streams.get(id);
  if (!stream) {
    return;
  }
  if (globalTaskActive && stream.key) {
    log(`download-queue: cancel refused for ${id} while a global task runs`);
    return;
  }
  stream.status = "cancelled";
  await runStreamAction(stream, () => stream.cancel(), "cancel");
  recompute();
}
