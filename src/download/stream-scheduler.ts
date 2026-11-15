import { log } from "../logging/logger";
import { getKeyOrDefault } from "../runtime/storage";
import {
  DOWNLOAD_SPEED_LIMIT_ENABLED_KEY,
  DOWNLOAD_SPEED_LIMIT_UNIT_KEY,
  DOWNLOAD_SPEED_LIMIT_VALUE_KEY,
  speedLimitConfigToBps,
} from "./config";
import {
  attachDownloadStream,
  detachDownloadStream,
  updateDownloadStream,
} from "./task-registry";
import type {
  DownloadStatus,
  DownloadStream,
  DownloadStreamUpdate,
} from "./types";

export type {
  DownloadStatus,
  DownloadStream,
  DownloadStreamKind,
} from "./types";

const streams = new Map<string, DownloadStream>();
const lastLimitByStream = new Map<string, number>();
type ControlAction = "pause" | "resume" | "cancel";
const pendingControls = new Map<
  DownloadStream,
  { action: ControlAction; done: Promise<void> }
>();
const listeners = new Set<(streams: readonly DownloadStream[]) => void>();
let budgetBps = 0;
let recomputing = false;
let globalTaskActive = false;

const getStreamSnapshot = () => [...streams.values()];
const countActiveStreams = () =>
  [...streams.values()].filter(stream => stream.status === "active").length;
function usesAria2Slot(stream: DownloadStream) {
  // Local verification can start its own aria2 transfer to repair a file.
  return stream.kind === "aria2" && stream.phaseKind !== "verifying";
}
function hasDownloadSlot(stream: DownloadStream) {
  return (
    !usesAria2Slot(stream) ||
    !getStreamSnapshot().some(
      other =>
        other !== stream &&
        usesAria2Slot(other) &&
        (other.status === "active" ||
          pendingControls.get(other)?.action === "resume")
    )
  );
}
async function runStreamAction(
  stream: DownloadStream,
  action: () => Promise<void>,
  actionName: string
) {
  try {
    await action();
    return true;
  } catch (error) {
    log(
      `stream-scheduler: failed to ${actionName} stream ${stream.id}: ${String(
        error
      )}`
    );
    return false;
  }
}
function changeStreamStatus(
  stream: DownloadStream,
  action: ControlAction,
  nextStatus: DownloadStatus,
  failureStatus = stream.status
) {
  const previousStatus = stream.status;
  const done = runStreamAction(stream, () => stream[action](), action).then(
    succeeded => {
      pendingControls.delete(stream);
      if (streams.get(stream.id) !== stream) return;
      if (stream.status === previousStatus) {
        stream.status = succeeded ? nextStatus : failureStatus;
      }
      if (action === "resume" && succeeded) pauseForGlobalTask(stream);
      recompute();
    }
  );
  pendingControls.set(stream, { action, done });
  return done;
}
function pauseForGlobalTask(stream: DownloadStream) {
  if (
    globalTaskActive &&
    stream.key &&
    stream.status === "active" &&
    !pendingControls.has(stream)
  ) {
    void changeStreamStatus(stream, "pause", "queued");
  }
}
async function controlStream(
  id: string,
  control: (stream: DownloadStream) => Promise<void>
) {
  const stream = streams.get(id);
  if (!stream) return;
  let pending = pendingControls.get(stream);
  while (pending) {
    await pending.done;
    pending = pendingControls.get(stream);
  }
  if (streams.get(id) === stream) await control(stream);
}
function pushSpeedLimit(stream: DownloadStream, bps: number) {
  if ((lastLimitByStream.get(stream.id) ?? 0) === bps) return;
  lastLimitByStream.set(stream.id, bps);
  void runStreamAction(stream, () => stream.setSpeedLimit(bps), "limit");
}
function recomputeSlots() {
  for (const stream of streams.values()) {
    if (
      stream.status === "queued" &&
      !pendingControls.has(stream) &&
      !(globalTaskActive && stream.key) &&
      hasDownloadSlot(stream)
    ) {
      // A failed automatic resume is available for a manual retry.
      void changeStreamStatus(stream, "resume", "active", "paused");
    }
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
  const queue =
    (globalTaskActive && Boolean(stream.key)) || !hasDownloadSlot(stream);
  stream.status = queue ? "queued" : "active";
  streams.set(stream.id, stream);
  attachDownloadStream(stream);
  lastLimitByStream.set(stream.id, 0);
  if (queue) void changeStreamStatus(stream, "pause", "queued", "active");
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
  if (active) for (const stream of streams.values()) pauseForGlobalTask(stream);
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
  recompute();
}
export function pauseStream(id: string) {
  return controlStream(id, async stream => {
    if (stream.status === "active") {
      await changeStreamStatus(stream, "pause", "paused");
    } else if (stream.status === "queued") {
      stream.status = "paused";
      emit();
    }
  });
}
export function resumeStream(id: string) {
  return controlStream(id, async stream => {
    if (stream.status !== "paused") return;
    if (globalTaskActive && stream.key) {
      log(
        `stream-scheduler: resume refused for ${id} while a global task runs`
      );
      return;
    }
    if (!hasDownloadSlot(stream)) {
      stream.status = "queued";
      emit();
      return;
    }
    await changeStreamStatus(stream, "resume", "active");
  });
}
export function cancelStream(id: string) {
  return controlStream(id, async stream => {
    if (["completed", "error", "cancelled"].includes(stream.status)) return;
    if (globalTaskActive && stream.key) {
      log(
        `stream-scheduler: cancel refused for ${id} while a global task runs`
      );
      return;
    }
    await changeStreamStatus(stream, "cancel", "cancelled");
  });
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
