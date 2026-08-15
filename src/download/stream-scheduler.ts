import { log } from "../logging/logger";
import { getKeyOrDefault } from "../runtime/storage";
import {
  DOWNLOAD_SPEED_LIMIT_ENABLED_KEY,
  DOWNLOAD_SPEED_LIMIT_UNIT_KEY,
  DOWNLOAD_SPEED_LIMIT_VALUE_KEY,
  MAX_CONCURRENT_DOWNLOADS_KEY,
  speedLimitConfigToBps,
} from "./config";
import {
  attachDownloadStream,
  detachDownloadStream,
  updateDownloadStream,
} from "./task-registry";
import type { DownloadStream, DownloadStreamUpdate } from "./types";

export type {
  DownloadStatus,
  DownloadStream,
  DownloadStreamKind,
} from "./types";

const streams = new Map<string, DownloadStream>();
const lastLimitByStream = new Map<string, number>();
const controlActionByStream = new Map<string, Promise<void>>();
const listeners = new Set<(streams: readonly DownloadStream[]) => void>();
let budgetBps = 0;
let maxConcurrent = 0;
let recomputing = false;
let globalTaskActive = false;

const getStreamSnapshot = () => [...streams.values()];
const countActiveStreams = () =>
  [...streams.values()].filter(stream => stream.status === "active").length;
function findFirstQueuedStream() {
  return [...streams.values()].find(
    stream => stream.status === "queued" && !(globalTaskActive && stream.key)
  );
}
function findLastActiveStream() {
  return [...streams.values()]
    .filter(stream => stream.status === "active")
    .pop();
}
async function runStreamAction(
  stream: DownloadStream,
  action: () => Promise<void>,
  actionName: string
) {
  try {
    await action();
  } catch (error) {
    log(
      `stream-scheduler: failed to ${actionName} stream ${stream.id}: ${String(
        error
      )}`
    );
  }
}
function runStreamControlAction(
  stream: DownloadStream,
  action: () => Promise<void>,
  actionName: string
) {
  const previous = controlActionByStream.get(stream.id);
  const current = previous
    ? previous.then(() => runStreamAction(stream, action, actionName))
    : runStreamAction(stream, action, actionName);
  controlActionByStream.set(stream.id, current);
  void current.then(() => {
    if (controlActionByStream.get(stream.id) === current)
      controlActionByStream.delete(stream.id);
  });
  return current;
}
function pushSpeedLimit(stream: DownloadStream, bps: number) {
  if ((lastLimitByStream.get(stream.id) ?? 0) === bps) return;
  lastLimitByStream.set(stream.id, bps);
  void runStreamAction(stream, () => stream.setSpeedLimit(bps), "limit");
}
function recomputeSlots() {
  if (maxConcurrent > 0)
    while (countActiveStreams() > maxConcurrent) {
      const overflow = findLastActiveStream();
      if (!overflow) break;
      overflow.status = "queued";
      void runStreamControlAction(overflow, () => overflow.pause(), "pause");
    }
  while (maxConcurrent === 0 || countActiveStreams() < maxConcurrent) {
    const next = findFirstQueuedStream();
    if (!next) break;
    next.status = "active";
    void runStreamControlAction(next, () => next.resume(), "resume");
  }
}
function recomputeBudget() {
  const active = getStreamSnapshot().filter(
    stream => stream.status === "active"
  );
  if (budgetBps > 0 && active.length > 0) {
    const share = Math.max(1, Math.floor(budgetBps / active.length));
    for (const stream of active) pushSpeedLimit(stream, share);
  } else
    for (const stream of streams.values())
      if ((lastLimitByStream.get(stream.id) ?? 0) !== 0)
        pushSpeedLimit(stream, 0);
}
function emit() {
  const snapshot = getStreamSnapshot();
  for (const stream of snapshot) updateDownloadStream(stream);
  for (const listener of listeners) listener(snapshot);
}
function recompute() {
  if (recomputing) return;
  recomputing = true;
  try {
    recomputeSlots();
    recomputeBudget();
    emit();
  } finally {
    recomputing = false;
  }
}

export function registerStream(stream: DownloadStream) {
  if (
    (globalTaskActive && Boolean(stream.key)) ||
    (maxConcurrent > 0 && countActiveStreams() >= maxConcurrent)
  ) {
    stream.status = "queued";
    void runStreamControlAction(stream, () => stream.pause(), "pause");
  } else stream.status = "active";
  streams.set(stream.id, stream);
  attachDownloadStream(stream);
  lastLimitByStream.set(stream.id, 0);
  recompute();
}
export function unregisterStream(id: string) {
  const stream = streams.get(id);
  if (!stream || !streams.delete(id)) return;
  detachDownloadStream(stream);
  lastLimitByStream.delete(id);
  recompute();
}
export function updateStream(id: string, patch: DownloadStreamUpdate) {
  const stream = streams.get(id);
  if (!stream) return;
  const statusChanged =
    patch.status !== undefined && patch.status !== stream.status;
  Object.assign(stream, patch);
  if (statusChanged) recompute();
  else emit();
}
export function subscribe(
  listener: (streams: readonly DownloadStream[]) => void
) {
  listeners.add(listener);
  listener(getStreamSnapshot());
  return () => listeners.delete(listener);
}
export const getStreams = (): readonly DownloadStream[] => getStreamSnapshot();
export const getStreamsByKey = (key: string): readonly DownloadStream[] =>
  getStreamSnapshot().filter(stream => (stream.key ?? "") === key);
export const getStreamsByTaskId = (taskId: string): readonly DownloadStream[] =>
  getStreamSnapshot().filter(stream => stream.ownerTaskId === taskId);
export const getActiveStreamCount = () => countActiveStreams();
export function setGlobalTaskActive(active: boolean) {
  if (globalTaskActive === active) return;
  globalTaskActive = active;
  if (active)
    for (const stream of streams.values())
      if (stream.key && stream.status === "active") {
        stream.status = "queued";
        void runStreamControlAction(stream, () => stream.pause(), "pause");
      }
  recompute();
}
export const getGlobalTaskActive = () => globalTaskActive;
export async function reloadConfig() {
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
      ? Math.min(10, Math.max(1, Math.floor(parsedConcurrent)))
      : 0;
  recompute();
}
export async function pauseStream(id: string) {
  const stream = streams.get(id);
  if (!stream) return;
  if (stream.status === "active") {
    stream.status = "paused";
    emit();
    await runStreamControlAction(stream, () => stream.pause(), "pause");
    recompute();
  } else if (stream.status === "queued") {
    stream.status = "paused";
    emit();
  }
}
export async function resumeStream(id: string) {
  const stream = streams.get(id);
  if (!stream || stream.status !== "paused") return;
  if (globalTaskActive && stream.key) {
    log(`stream-scheduler: resume refused for ${id} while a global task runs`);
    return;
  }
  if (maxConcurrent > 0 && countActiveStreams() >= maxConcurrent) {
    stream.status = "queued";
    emit();
    return;
  }
  stream.status = "active";
  emit();
  await runStreamControlAction(stream, () => stream.resume(), "resume");
  recompute();
}
export async function cancelStream(id: string) {
  const stream = streams.get(id);
  if (!stream) return;
  if (globalTaskActive && stream.key) {
    log(`stream-scheduler: cancel refused for ${id} while a global task runs`);
    return;
  }
  stream.status = "cancelled";
  await runStreamControlAction(stream, () => stream.cancel(), "cancel");
  recompute();
}
export async function pauseDownloadTask(taskId: string) {
  for (const stream of getStreamsByTaskId(taskId).filter(
    stream =>
      (stream.status === "active" || stream.status === "queued") &&
      stream.canPause
  ))
    await pauseStream(stream.id);
}
export async function resumeDownloadTask(taskId: string) {
  for (const stream of getStreamsByTaskId(taskId).filter(
    stream => stream.status === "paused" && stream.canResume
  ))
    await resumeStream(stream.id);
}
export async function cancelDownloadTask(taskId: string) {
  for (const stream of getStreamsByTaskId(taskId).filter(
    stream =>
      !["completed", "error", "cancelled"].includes(stream.status) &&
      stream.canCancel
  ))
    await cancelStream(stream.id);
}
