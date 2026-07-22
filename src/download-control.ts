type DownloadControlState = {
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

let state = defaultState;
let actions: DownloadControlActions = {};
const listeners = new Set<(state: DownloadControlState) => void>();

export class DownloadCancelledError extends Error {
  constructor(message = "Download cancelled") {
    super(message);
    this.name = "DownloadCancelledError";
  }
}

export function isDownloadCancelledError(error: unknown) {
  return error instanceof DownloadCancelledError;
}

function emit() {
  const snapshot = { ...state };
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function getDownloadControlState() {
  return { ...state };
}

export function subscribeDownloadControl(
  listener: (state: DownloadControlState) => void
) {
  listeners.add(listener);
  listener(getDownloadControlState());
  return () => listeners.delete(listener);
}

export function beginControlledDownload(
  downloadActions: DownloadControlActions
) {
  actions = downloadActions;
  state = {
    active: true,
    paused: false,
    pauseRequested: false,
    actionPending: false,
    canPause: Boolean(downloadActions.pause && downloadActions.resume),
    canCancel: Boolean(downloadActions.cancel),
  };
  emit();
}

export function updateControlledDownload(
  patch: Partial<
    Pick<DownloadControlState, "paused" | "pauseRequested" | "actionPending">
  >
) {
  state = { ...state, ...patch };
  emit();
}

export function endControlledDownload() {
  actions = {};
  state = defaultState;
  emit();
}

export async function pauseControlledDownload() {
  if (
    !state.active ||
    state.pauseRequested ||
    state.actionPending ||
    !actions.pause
  ) {
    return;
  }
  updateControlledDownload({ pauseRequested: true, actionPending: true });
  try {
    await actions.pause();
  } catch (error) {
    updateControlledDownload({ pauseRequested: state.paused });
    throw error;
  } finally {
    updateControlledDownload({ actionPending: false });
  }
}

export async function resumeControlledDownload() {
  if (
    !state.active ||
    !state.pauseRequested ||
    state.actionPending ||
    !actions.resume
  ) {
    return;
  }
  updateControlledDownload({ pauseRequested: false, actionPending: true });
  try {
    await actions.resume();
  } catch (error) {
    updateControlledDownload({ pauseRequested: state.paused });
    throw error;
  } finally {
    updateControlledDownload({ actionPending: false });
  }
}

export async function cancelControlledDownload() {
  if (!state.active || !actions.cancel) return;
  await actions.cancel();
}
