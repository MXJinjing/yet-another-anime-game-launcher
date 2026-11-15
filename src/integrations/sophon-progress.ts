import type { SophonProgressEvent } from "./sophon";

export interface SophonMetric {
  completed: number;
  total?: number;
  remaining?: number;
  percentage?: number;
  rate?: number;
  averageRate?: number;
  etaSeconds?: number;
  elapsedSeconds?: number;
  isFinished?: boolean;
}

interface Payload {
  id: string;
  receivedBytes: number;
  totalBytes: number;
  category: string;
  retainedBytes: number;
  transferredBytes: number;
}

interface IOMetrics {
  read: SophonMetric;
  write: SophonMetric;
}

interface CommonMetrics extends IOMetrics {
  network: SophonMetric;
  files: SophonMetric;
  timing: {
    elapsedSeconds: number;
    stageElapsedSeconds: number;
    etaSeconds?: number;
    phaseDurations: Record<string, number>;
  };
  resources?: {
    memoryBytes: number;
    memoryLimit: number;
    diskLimit: number;
    diskReservedBytes: number;
    memoryCache: IOMetrics;
    diskCache: IOMetrics;
    target: IOMetrics;
    devices: (IOMetrics & {
      id: string;
      location: string;
      roles: string[];
      cacheBytes: number;
      reservedCacheBytes: number;
    })[];
    downloads: Payload[];
  };
}

interface InstallationMetrics {
  common: CommonMetrics;
  verification: {
    files: SophonMetric;
    bytes: SophonMetric;
    chunks: SophonMetric;
    missingFiles: number;
    brokenFiles: number;
  };
  downloadedChunks: number;
  processing: { bytes: number };
  retries: number;
}

interface UpdateMetrics {
  common: CommonMetrics;
  patch: { retainedBytes: number; verifiedBytes: number; bundlesReady: number };
  repair: { files: number };
  skippedFiles: number;
  cachedFiles: number;
}

export interface SophonSnapshot {
  phase: string;
  currentFile?: string;
  currentFileBytes?: number;
  currentFileSize?: number;
  sourceVersion?: string;
  targetVersion?: string;
  outcome?:
    | { failed: { reason: string } }
    | { completed: object }
    | { cancelled: object };
  metrics: InstallationMetrics | UpdateMetrics;
}

export function progressEvent(
  taskId: string,
  snapshot: SophonSnapshot
): SophonProgressEvent | undefined {
  const { phase, metrics } = snapshot;
  const { network, files, resources, timing, write } = metrics.common;
  const percent = (metric: SophonMetric) =>
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
      phase === "scanning" && "verification" in metrics
        ? metrics.verification.files
        : files;
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
