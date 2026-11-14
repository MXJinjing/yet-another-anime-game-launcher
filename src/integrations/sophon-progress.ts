import type { SophonProgressEvent } from "./sophon";

interface Metric {
  completed: number;
  total?: number;
  percentage?: number;
  rate?: number;
  averageRate?: number;
}

interface Payload {
  id: string;
  receivedBytes: number;
  totalBytes: number;
}

export interface SophonSnapshot {
  phase: string;
  currentFile?: string;
  currentFileBytes?: number;
  currentFileSize?: number;
  metrics: {
    common: {
      network: Metric;
      files: Metric;
      write: Metric;
      timing: { elapsedSeconds: number };
      resources?: { downloads: Payload[] };
    };
    verification?: { files: Metric; bytes: Metric };
  };
}

export function progressEvent(
  taskId: string,
  snapshot: SophonSnapshot
): SophonProgressEvent | undefined {
  const { phase, metrics } = snapshot;
  const { network, files, resources, timing, write } = metrics.common;
  const percent = (metric: Metric) =>
    metric.percentage ??
    (metric.total ? Math.min(100, (metric.completed * 100) / metric.total) : 0);
  const active = (resources?.downloads ?? []).filter(
    payload => payload.receivedBytes < payload.totalBytes
  );
  if (
    phase === "scanning" ||
    phase === "trimming" ||
    phase === "deleting" ||
    (phase === "running" &&
      active.length === 0 &&
      write.completed < (write.total ?? 0) &&
      network.completed >= (network.total ?? 0))
  ) {
    const processed =
      phase === "scanning" ? metrics.verification?.files : files;
    return {
      type: "processing_progress",
      task_id: taskId,
      phase: phase === "running" || phase === "deleting" ? "patching" : phase,
      filename: snapshot.currentFile,
      current_bytes: snapshot.currentFileBytes,
      file_bytes: snapshot.currentFileSize,
      processed_files: processed?.completed ?? 0,
      total_files: processed?.total ?? 0,
      elapsed_seconds: Math.floor(timing.elapsedSeconds),
      overall_progress: { overall_percent: processed ? percent(processed) : 0 },
    };
  }
  if (phase === "metadata" || network.total === undefined) return;
  return {
    type: "chunk_progress",
    task_id: taskId,
    filename: snapshot.currentFile ?? "",
    current_file_index: files.completed,
    total_file_count: files.total,
    overall_progress: {
      downloaded_size: network.completed,
      total_size: network.total,
      download_speed: network.rate ?? network.averageRate ?? 0,
      overall_percent: percent(network),
    },
    active_files: active.slice(0, 8).map(payload => ({
      filename: payload.id,
      progress_percent: payload.totalBytes
        ? (payload.receivedBytes * 100) / payload.totalBytes
        : 0,
      downloaded_size: payload.receivedBytes,
      total_size: payload.totalBytes,
    })),
  };
}
