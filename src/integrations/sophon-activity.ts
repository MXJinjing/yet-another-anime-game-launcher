import type { SophonMetric, SophonSnapshot } from "./sophon-progress";

export const activityMetrics = [
  ["common.network", "Network download", "bytes"],
  ["common.read", "File reads", "bytes"],
  ["common.write", "Output", "bytes"],
  ["common.files", "Completed files", "files"],
  ["common.metadata.manifests", "All manifests", "manifests"],
  [
    "common.metadata.installationManifests",
    "Installation manifests",
    "manifests",
  ],
  ["common.metadata.diffManifests", "Diff manifests", "manifests"],
  ["common.metadata.planning", "Planning", "steps"],
  ["common.resources.target.read", "Game-file reads", "bytes"],
  ["common.resources.target.write", "Game-file writes", "bytes"],
  ["common.resources.memoryCache.read", "Memory-cache reads", "bytes"],
  ["common.resources.memoryCache.write", "Memory-cache writes", "bytes"],
  ["common.resources.diskCache.read", "Disk-cache reads", "bytes"],
  ["common.resources.diskCache.write", "Disk-cache writes", "bytes"],
  ["verification.bytes", "Verification: assessed bytes", "bytes"],
  ["verification.chunks", "Verification: chunks", "chunks"],
  ["verification.files", "Verification: files", "files"],
  ["trimming", "Trimmed files", "files"],
  ["download", "Download payload", "bytes"],
  ["processing.chunks", "Processed chunks", "chunks"],
  ["patch.data", "Patch payload", "bytes"],
  ["patch.network", "New patch traffic", "bytes"],
  ["repair.download", "Repair download", "bytes"],
  ["repair.write", "Repair output", "bytes"],
  ["deletion.files", "Deleted files", "files"],
  ["deletion.bytes", "Deleted bytes", "bytes"],
] as const;

export function activityMetric(
  progress: SophonSnapshot | undefined,
  key: string
) {
  if (
    key === "common.resources.target.read" &&
    !progress?.metrics.common.resources
  )
    return progress?.metrics.common.read;
  let value: unknown = progress?.metrics;
  for (const part of key.split(".")) {
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[part]
        : undefined;
  }
  return value as SophonMetric | undefined;
}

export interface ActivitySample {
  time: number;
  values: Record<string, number | undefined>;
}

export interface SophonActivity {
  id: string;
  kind: "install" | "update" | "repair";
  predownload: boolean;
  sourceVersion?: string;
  targetVersion?: string;
  status: "starting" | "running" | "completed" | "failed" | "cancelled";
  progress?: SophonSnapshot;
  error?: string;
  history: ActivitySample[];
}

export function recordSophonActivity(
  previous: SophonActivity,
  status: Pick<SophonActivity, "status" | "progress" | "error">
): SophonActivity {
  const latest = {
    ...previous,
    ...status,
    progress: status.progress ?? previous.progress,
  };
  const progress = latest.progress;
  const time = progress?.metrics.common.timing.elapsedSeconds;
  if (!progress || time === undefined || !Number.isFinite(time)) return latest;

  const samples = previous.history;
  const last = samples[samples.length - 1];
  if (
    last &&
    Math.floor(time) === Math.floor(last.time) &&
    previous.status === latest.status &&
    previous.progress?.phase === progress.phase &&
    latest.status === "running"
  )
    return latest;

  const values: ActivitySample["values"] = {};
  for (const [key] of activityMetrics)
    values[key] = activityMetric(progress, key)?.rate;
  const resources = progress.metrics.common.resources;
  if (resources) {
    values.memory = resources.memoryBytes;
    values.reserved = resources.diskReservedBytes;
    values.stored = resources.devices.reduce(
      (sum, device) => sum + device.cacheBytes,
      0
    );
    const rates = resources.devices.map(device => device.write.rate);
    values["disk.write"] =
      rates.length && rates.every(rate => rate !== undefined)
        ? rates.reduce<number>((sum, rate) => sum + (rate ?? 0), 0)
        : undefined;
    for (const direction of ["read", "write"] as const) {
      for (const device of resources.devices) {
        values[`volume:${device.id}:${direction}`] = device[direction].rate;
      }
    }
  }
  latest.history = [
    ...(!last || time < last.time
      ? []
      : samples.filter(
          sample =>
            time - sample.time <= 60 &&
            Math.floor(sample.time) < Math.floor(time)
        )),
    { time, values },
  ].slice(-61);
  return latest;
}
