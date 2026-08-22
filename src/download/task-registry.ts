import type {
  DownloadFileSnapshot,
  DownloadStatus,
  DownloadStream,
  DownloadStreamKind,
  DownloadTaskMetadata,
  DownloadTaskOverallUpdate,
  DownloadTaskSnapshot,
  DownloadTaskPhase,
} from "./types";

export type {
  DownloadFileSnapshot,
  DownloadTaskMetadata,
  DownloadTaskSnapshot,
};
export type DownloadEngine = DownloadStreamKind;

type DownloadTaskRecord = {
  id: string;
  key?: string;
  title: string;
  phaseKind?: DownloadTaskPhase;
  phase: string;
  phaseTransferring: boolean;
  materialized: boolean;
  orphan: boolean;
  streams: Map<string, DownloadStream>;
  engines: Set<DownloadStreamKind>;
  explicitOverall: boolean;
  progress: number;
  totalKnown: boolean;
  downloaded: number;
  total: number;
  completedAria2Downloaded: number;
  completedAria2Total: number;
  fileIndex?: number;
  fileCount?: number;
};

const tasks = new Map<string, DownloadTaskRecord>();
const listeners = new Set<(tasks: readonly DownloadTaskSnapshot[]) => void>();
let nextTaskId = 1;

const clampProgress = (value: number) =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
const streamIsTerminal = (stream: DownloadStream) =>
  ["completed", "error", "cancelled"].includes(stream.status);

function taskStatus(record: DownloadTaskRecord): DownloadStatus {
  const streams = [...record.streams.values()];
  for (const status of [
    "active",
    "queued",
    "paused",
    "error",
    "cancelled",
  ] as const) {
    if (streams.some(stream => stream.status === status)) return status;
  }
  return "active";
}

function aria2Overall(record: DownloadTaskRecord) {
  const streams = [...record.streams.values()].filter(
    stream => stream.kind === "aria2" && !streamIsTerminal(stream)
  );
  const downloaded =
    record.completedAria2Downloaded +
    streams.reduce((sum, stream) => sum + stream.downloaded, 0);
  const total =
    record.completedAria2Total +
    streams.reduce((sum, stream) => sum + stream.total, 0);
  return {
    downloaded,
    total,
    progress: total > 0 ? (downloaded / total) * 100 : 0,
  };
}

function taskFiles(record: DownloadTaskRecord): DownloadFileSnapshot[] {
  if (!record.phaseTransferring) return [];
  const files: DownloadFileSnapshot[] = [];
  for (const stream of record.streams.values()) {
    if (streamIsTerminal(stream)) continue;
    if (stream.kind === "sophon" && stream.files) files.push(...stream.files);
    else
      files.push({
        id: stream.id,
        name: stream.title,
        progress: stream.progress,
        speed: stream.speed,
        downloaded: stream.downloaded,
        total: stream.total,
      });
  }
  return files.slice(0, 8).map(file => ({ ...file }));
}

function toSnapshot(record: DownloadTaskRecord): DownloadTaskSnapshot {
  const streams = [...record.streams.values()];
  const fallback = aria2Overall(record);
  const downloaded = record.explicitOverall
    ? record.downloaded
    : fallback.downloaded;
  const total = record.explicitOverall ? record.total : fallback.total;
  return {
    id: record.id,
    key: record.key,
    title: record.title,
    phaseKind: record.phaseKind,
    phase: record.phase,
    transferring: record.phaseTransferring,
    status: taskStatus(record),
    progress: clampProgress(
      record.explicitOverall ? record.progress : fallback.progress
    ),
    indeterminate: record.explicitOverall ? !record.totalKnown : total <= 0,
    speed: record.phaseTransferring
      ? streams
          .filter(stream => stream.status === "active")
          .reduce((sum, stream) => sum + stream.speed, 0)
      : 0,
    downloaded,
    total,
    fileIndex: record.fileIndex,
    fileCount: record.fileCount,
    engines: [...record.engines],
    files: taskFiles(record),
    canPause: streams.some(
      stream =>
        (stream.status === "active" || stream.status === "queued") &&
        stream.canPause
    ),
    canResume: streams.some(
      stream => stream.status === "paused" && stream.canResume
    ),
    canCancel: streams.some(
      stream => !streamIsTerminal(stream) && stream.canCancel
    ),
  };
}

function snapshots() {
  return [...tasks.values()]
    .filter(record => record.materialized)
    .map(toSnapshot);
}
function emit() {
  const next = snapshots();
  for (const listener of listeners) listener(next);
}

export function beginDownloadTask(metadata: DownloadTaskMetadata): string {
  const id = `download-task:${nextTaskId++}`;
  tasks.set(id, {
    id,
    key: metadata.key,
    title: metadata.title,
    phaseKind: undefined,
    phase: "",
    phaseTransferring: true,
    materialized: false,
    orphan: false,
    streams: new Map(),
    engines: new Set(),
    explicitOverall: false,
    progress: 0,
    totalKnown: false,
    downloaded: 0,
    total: 0,
    completedAria2Downloaded: 0,
    completedAria2Total: 0,
  });
  return id;
}

export function endDownloadTask(id: string) {
  if (tasks.delete(id)) emit();
}

export function resolveDownloadTaskId(key?: string): string | undefined {
  const records = [...tasks.values()].filter(record => !record.orphan);
  const lastMatching = (predicate: (record: DownloadTaskRecord) => boolean) => {
    for (let index = records.length - 1; index >= 0; index -= 1)
      if (predicate(records[index])) return records[index];
    return undefined;
  };
  if (key) return lastMatching(record => record.key === key)?.id;
  return (
    lastMatching(record => record.key === "__global__")?.id ??
    lastMatching(record => record.key === undefined)?.id ??
    (records.length === 1 ? records[0].id : undefined)
  );
}

export function attachDownloadStream(stream: DownloadStream): string {
  let ownerTaskId = stream.ownerTaskId ?? resolveDownloadTaskId(stream.key);
  let record = ownerTaskId ? tasks.get(ownerTaskId) : undefined;
  if (!record) {
    ownerTaskId = beginDownloadTask({ title: stream.title, key: stream.key });
    record = tasks.get(ownerTaskId)!;
    record.orphan = true;
  }
  const attachedTaskId = record.id;
  stream.ownerTaskId = attachedTaskId;
  record.phaseKind = stream.phaseKind;
  record.materialized = true;
  record.streams.set(stream.id, stream);
  record.engines.add(stream.kind);
  if (!record.title) record.title = stream.title;
  if (!record.key) record.key = stream.key;
  emit();
  return attachedTaskId;
}

export function updateDownloadStream(stream: DownloadStream) {
  const record = stream.ownerTaskId ? tasks.get(stream.ownerTaskId) : undefined;
  if (!record) return;
  record.streams.set(stream.id, stream);
  if (stream.phaseKind !== undefined) record.phaseKind = stream.phaseKind;
  record.engines.add(stream.kind);
  if (stream.kind === "sophon" && stream.total > 0) {
    Object.assign(record, {
      explicitOverall: true,
      progress: stream.progress,
      downloaded: stream.downloaded,
      total: stream.total,
      totalKnown: true,
    });
  }
  emit();
}

export function detachDownloadStream(stream: DownloadStream) {
  const record = stream.ownerTaskId ? tasks.get(stream.ownerTaskId) : undefined;
  if (!record) return;
  if (
    stream.kind === "aria2" &&
    !record.explicitOverall &&
    stream.status !== "cancelled"
  ) {
    record.completedAria2Downloaded += stream.downloaded;
    record.completedAria2Total += stream.total;
  }
  record.streams.delete(stream.id);
  if (record.orphan && record.streams.size === 0) tasks.delete(record.id);
  emit();
}

export function updateDownloadTaskOverall(
  id: string | undefined,
  patch: DownloadTaskOverallUpdate
) {
  if (!id) return;
  const record = tasks.get(id);
  if (!record) return;
  Object.assign(record, {
    explicitOverall: true,
    progress: clampProgress(patch.progress),
    downloaded: Math.max(0, patch.downloaded),
    total: Math.max(0, patch.total),
    totalKnown: patch.totalKnown ?? patch.total > 0,
  });
  emit();
}

export function updateDownloadTaskPhase(
  id: string,
  phase: string,
  transferring: boolean
) {
  const record = tasks.get(id);
  if (!record) return;
  record.phase = phase;
  record.phaseTransferring = transferring;
  if (!transferring) {
    record.fileIndex = undefined;
    record.fileCount = undefined;
  }
  emit();
}

export function updateDownloadTaskFileCounter(
  id: string,
  fileIndex?: number,
  fileCount?: number
) {
  const record = tasks.get(id);
  if (!record) return;
  record.fileIndex = fileIndex;
  record.fileCount = fileCount;
  emit();
}

export const getDownloadTasks = (): readonly DownloadTaskSnapshot[] =>
  snapshots();
export const getDownloadTaskCount = () => snapshots().length;
export function subscribeDownloadTasks(
  listener: (tasks: readonly DownloadTaskSnapshot[]) => void
) {
  listeners.add(listener);
  listener(snapshots());
  return () => listeners.delete(listener);
}
