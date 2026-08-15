import { getActiveStorageNamespace } from "../runtime/storage";
import {
  cancelStream,
  getStreams,
  getStreamsByKey,
  pauseStream,
  resumeStream,
  subscribe,
} from "./stream-scheduler";
import type { DownloadStatus } from "./types";

export type DownloadControlState = {
  active: boolean;
  paused: boolean;
  pauseRequested: boolean;
  actionPending: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
};
const DEFAULT_KEY = "";
export class DownloadCancelledError extends Error {
  constructor(message = "Download cancelled") {
    super(message);
    this.name = "DownloadCancelledError";
  }
}
export class DownloadFailedError extends Error {
  constructor(message = "Download failed") {
    super(message);
    this.name = "DownloadFailedError";
  }
}
export const isDownloadCancelledError = (error: unknown) =>
  error instanceof DownloadCancelledError;
export const isDownloadFailedError = (error: unknown) =>
  error instanceof DownloadFailedError;
const resolveKey = (key?: string) =>
  key || getActiveStorageNamespace() || DEFAULT_KEY;
const listenersByKey = new Map<
  string,
  Set<(state: DownloadControlState) => void>
>();
const pendingActionsByKey = new Map<string, number>();
let schedulerUnsubscribe: (() => void) | null = null;
const isTerminal = (status: DownloadStatus) =>
  ["completed", "error", "cancelled"].includes(status);
function computeState(key: string): DownloadControlState {
  const streams = getStreamsByKey(key);
  const paused = streams.some(stream => stream.status === "paused");
  return {
    active: streams.some(stream => !isTerminal(stream.status)),
    paused,
    pauseRequested: paused,
    actionPending: (pendingActionsByKey.get(key) ?? 0) > 0,
    canPause: streams.some(
      stream => stream.status === "active" && stream.canPause
    ),
    canResume: streams.some(
      stream => stream.status === "paused" && stream.canResume
    ),
    canCancel: streams.some(
      stream => !isTerminal(stream.status) && stream.canCancel
    ),
  };
}
function getListeners(key: string) {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  return set;
}
function emitKey(key: string) {
  const snapshot = { ...computeState(key) };
  for (const listener of getListeners(key)) listener(snapshot);
}
function ensureSchedulerSubscription() {
  if (schedulerUnsubscribe) return;
  schedulerUnsubscribe = subscribe(() => {
    for (const key of listenersByKey.keys()) emitKey(key);
  });
}
function beginPendingAction(key: string) {
  pendingActionsByKey.set(key, (pendingActionsByKey.get(key) ?? 0) + 1);
  emitKey(key);
}
function endPendingAction(key: string) {
  const remaining = (pendingActionsByKey.get(key) ?? 1) - 1;
  if (remaining > 0) pendingActionsByKey.set(key, remaining);
  else pendingActionsByKey.delete(key);
  emitKey(key);
}
export const getDownloadControlState = (key?: string) =>
  computeState(resolveKey(key));
export const hasActiveDownloads = () =>
  getStreams().some(stream => !isTerminal(stream.status));
export function subscribeDownloadControl(
  listener: (state: DownloadControlState) => void,
  key?: string
) {
  const resolved = resolveKey(key);
  getListeners(resolved).add(listener);
  ensureSchedulerSubscription();
  emitKey(resolved);
  return () => getListeners(resolved).delete(listener);
}
/** Compatibility no-ops: stream state is owned by stream-scheduler. */
export function beginControlledDownload(
  _actions: {
    pause?: () => Promise<void>;
    resume?: () => Promise<void>;
    cancel?: () => Promise<void>;
  },
  _key?: string
) {
  return;
}
export function updateControlledDownload(
  _patch: Partial<
    Pick<DownloadControlState, "paused" | "pauseRequested" | "actionPending">
  >,
  _key?: string
) {
  return;
}
export function endControlledDownload(_key?: string) {
  return;
}
async function runForKey(
  key: string,
  predicate: (stream: ReturnType<typeof getStreamsByKey>[number]) => boolean,
  action: (id: string) => Promise<void>,
  pending = false
) {
  const targets = getStreamsByKey(key).filter(predicate);
  if (targets.length === 0) return;
  if (pending) beginPendingAction(key);
  try {
    for (const stream of targets) await action(stream.id);
  } finally {
    if (pending) endPendingAction(key);
  }
}
export const pauseControlledDownload = (key?: string) => {
  const resolved = resolveKey(key);
  return runForKey(
    resolved,
    stream => stream.status === "active" && stream.canPause,
    pauseStream,
    true
  );
};
export const resumeControlledDownload = (key?: string) => {
  const resolved = resolveKey(key);
  return runForKey(
    resolved,
    stream => stream.status === "paused" && stream.canResume,
    resumeStream,
    true
  );
};
export const cancelControlledDownload = (key?: string) => {
  const resolved = resolveKey(key);
  return runForKey(
    resolved,
    stream => !isTerminal(stream.status) && stream.canCancel,
    cancelStream
  );
};
