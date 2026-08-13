import { getActiveStorageNamespace } from "./utils/neu";

export type DownloadControlState = {
  active: boolean;
  paused: boolean;
  pauseRequested: boolean;
  actionPending: boolean;
  canPause: boolean;
  canCancel: boolean;
};

type DownloadControlActions = {
  pause?: () => Promise<void>;
  resume?: () => Promise<void>;
  cancel?: () => Promise<void>;
};

const defaultState: DownloadControlState = {
  active: false,
  paused: false,
  pauseRequested: false,
  actionPending: false,
  canPause: false,
  canCancel: false,
};

const DEFAULT_KEY = "";

const states = new Map<string, DownloadControlState>();
const actionsByKey = new Map<string, DownloadControlActions>();
const listenersByKey = new Map<
  string,
  Set<(state: DownloadControlState) => void>
>();

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

function getListeners(key: string) {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  return set;
}

function getState(key: string) {
  return states.get(key) ?? defaultState;
}

function emit(key: string) {
  const snapshot = { ...getState(key) };
  for (const listener of getListeners(key)) {
    listener(snapshot);
  }
}

export function getDownloadControlState(key?: string) {
  return { ...getState(resolveKey(key)) };
}

export function subscribeDownloadControl(
  listener: (state: DownloadControlState) => void,
  key?: string
) {
  const resolved = resolveKey(key);
  getListeners(resolved).add(listener);
  listener(getDownloadControlState(resolved));
  return () => getListeners(resolved).delete(listener);
}

export function beginControlledDownload(
  downloadActions: DownloadControlActions,
  key?: string
) {
  const resolved = resolveKey(key);
  actionsByKey.set(resolved, downloadActions);
  states.set(resolved, {
    active: true,
    paused: false,
    pauseRequested: false,
    actionPending: false,
    canPause: Boolean(downloadActions.pause && downloadActions.resume),
    canCancel: Boolean(downloadActions.cancel),
  });
  emit(resolved);
}

export function updateControlledDownload(
  patch: Partial<
    Pick<DownloadControlState, "paused" | "pauseRequested" | "actionPending">
  >,
  key?: string
) {
  const resolved = resolveKey(key);
  states.set(resolved, { ...getState(resolved), ...patch });
  emit(resolved);
}

export function endControlledDownload(key?: string) {
  const resolved = resolveKey(key);
  actionsByKey.delete(resolved);
  states.set(resolved, { ...defaultState });
  emit(resolved);
}

export async function pauseControlledDownload(key?: string) {
  const resolved = resolveKey(key);
  const state = getState(resolved);
  const actions = actionsByKey.get(resolved);
  if (
    !state.active ||
    state.pauseRequested ||
    state.actionPending ||
    !actions?.pause
  ) {
    return;
  }
  updateControlledDownload(
    { pauseRequested: true, actionPending: true },
    resolved
  );
  try {
    await actions.pause();
  } catch (error) {
    updateControlledDownload({ pauseRequested: state.paused }, resolved);
    throw error;
  } finally {
    updateControlledDownload({ actionPending: false }, resolved);
  }
}

export async function resumeControlledDownload(key?: string) {
  const resolved = resolveKey(key);
  const state = getState(resolved);
  const actions = actionsByKey.get(resolved);
  if (
    !state.active ||
    !state.pauseRequested ||
    state.actionPending ||
    !actions?.resume
  ) {
    return;
  }
  updateControlledDownload(
    { pauseRequested: false, actionPending: true },
    resolved
  );
  try {
    await actions.resume();
  } catch (error) {
    updateControlledDownload({ pauseRequested: state.paused }, resolved);
    throw error;
  } finally {
    updateControlledDownload({ actionPending: false }, resolved);
  }
}

export async function cancelControlledDownload(key?: string) {
  const resolved = resolveKey(key);
  const state = getState(resolved);
  const actions = actionsByKey.get(resolved);
  if (!state.active || !actions?.cancel) return;
  await actions.cancel();
}
