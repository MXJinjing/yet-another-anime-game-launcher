import { getActiveStorageNamespace } from "./utils/neu";
import {
  cancelStream,
  DownloadStream,
  getStreams,
  getStreamsByKey,
  pauseStream,
  resumeStream,
  subscribe,
} from "./download-queue";

export type DownloadControlState = {
  active: boolean;
  paused: boolean;
  pauseRequested: boolean;
  actionPending: boolean;
  canPause: boolean;
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

export function isDownloadCancelledError(error: unknown) {
  return error instanceof DownloadCancelledError;
}

export function isDownloadFailedError(error: unknown) {
  return error instanceof DownloadFailedError;
}

// Downloads started while a per-game storage namespace is active (i.e. inside
// a game's install/update/launch program) are automatically associated with
// that game, so multiple games can be controlled independently. Callers may
// also pass an explicit key to override the namespace (e.g. per-game Wine
// downloads that run before the namespace is entered).
function resolveKey(key?: string) {
  if (key) return key;
  return getActiveStorageNamespace() ?? DEFAULT_KEY;
}

const listenersByKey = new Map<
  string,
  Set<(state: DownloadControlState) => void>
>();

// Transient UI state (in-flight pause/resume) that the queue manager doesn't
// track. Everything else is derived from the download-queue manager so this
// module and the download-manager modal always share the same source of truth.
const pendingByKey = new Map<
  string,
  { pauseRequested: boolean; actionPending: boolean }
>();

let queueUnsubscribe: (() => void) | null = null;

function getPending(key: string) {
  return (
    pendingByKey.get(key) ?? { pauseRequested: false, actionPending: false }
  );
}

function isTerminal(status: DownloadStream["status"]) {
  return status === "completed" || status === "error" || status === "cancelled";
}

function computeState(key: string): DownloadControlState {
  const streams = getStreamsByKey(key);
  const pending = getPending(key);
  const paused = streams.some(stream => stream.status === "paused");
  return {
    active: streams.some(stream => !isTerminal(stream.status)),
    paused,
    // Pausing from the download manager also flips the primary button to
    // "paused"/resume; it isn't a transient request in this module.
    pauseRequested: pending.pauseRequested || paused,
    actionPending: pending.actionPending,
    canPause: streams.some(
      stream => stream.status === "active" && stream.canPause
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
  for (const listener of getListeners(key)) {
    listener(snapshot);
  }
}

function ensureQueueSubscription() {
  if (queueUnsubscribe) return;
  queueUnsubscribe = subscribe(() => {
    for (const key of listenersByKey.keys()) {
      emitKey(key);
    }
  });
}

export function getDownloadControlState(key?: string) {
  return computeState(resolveKey(key));
}

/** True when any download (per-game or launcher-global) is still in progress,
 *  including paused-but-not-finished downloads. Used to guard the launcher
 *  close flow so an active download can't be interrupted silently. */
export function hasActiveDownloads() {
  return getStreams().some(stream => !isTerminal(stream.status));
}

export function subscribeDownloadControl(
  listener: (state: DownloadControlState) => void,
  key?: string
) {
  const resolved = resolveKey(key);
  getListeners(resolved).add(listener);
  ensureQueueSubscription();
  emitKey(resolved);
  return () => getListeners(resolved).delete(listener);
}

// Deprecated: download state is derived from the download-queue manager, so
// these no longer store anything. Kept as no-ops so existing callers (the
// aria2 / sophon adapters) don't need changes.
export function beginControlledDownload(
  _downloadActions: {
    pause?: () => Promise<void>;
    resume?: () => Promise<void>;
    cancel?: () => Promise<void>;
  },
  _key?: string
) {} // eslint-disable-line @typescript-eslint/no-empty-function -- intentional no-op, see above

export function updateControlledDownload(
  _patch: Partial<
    Pick<DownloadControlState, "paused" | "pauseRequested" | "actionPending">
  >,
  _key?: string
) {} // eslint-disable-line @typescript-eslint/no-empty-function -- intentional no-op, see above

export function endControlledDownload(_key?: string) {} // eslint-disable-line @typescript-eslint/no-empty-function -- intentional no-op, see above

export async function pauseControlledDownload(key?: string) {
  const resolved = resolveKey(key);
  const targets = getStreamsByKey(resolved).filter(
    stream => stream.status === "active" && stream.canPause
  );
  if (targets.length === 0) return;
  pendingByKey.set(resolved, { pauseRequested: true, actionPending: true });
  emitKey(resolved);
  try {
    for (const stream of targets) {
      await pauseStream(stream.id);
    }
  } finally {
    pendingByKey.set(resolved, {
      ...getPending(resolved),
      actionPending: false,
    });
    emitKey(resolved);
  }
}

export async function resumeControlledDownload(key?: string) {
  const resolved = resolveKey(key);
  const targets = getStreamsByKey(resolved).filter(
    stream => stream.status === "paused" && stream.canResume
  );
  if (targets.length === 0) return;
  pendingByKey.set(resolved, { pauseRequested: false, actionPending: true });
  emitKey(resolved);
  try {
    for (const stream of targets) {
      await resumeStream(stream.id);
    }
  } finally {
    pendingByKey.set(resolved, {
      ...getPending(resolved),
      actionPending: false,
    });
    emitKey(resolved);
  }
}

export async function cancelControlledDownload(key?: string) {
  const resolved = resolveKey(key);
  const targets = getStreamsByKey(resolved).filter(
    stream => !isTerminal(stream.status) && stream.canCancel
  );
  for (const stream of targets) {
    await cancelStream(stream.id);
  }
}
