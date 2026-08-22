/** Shared download-domain data. This module deliberately has no runtime
 * dependencies so the scheduler and task registry can depend on it without
 * depending on each other. */
export type DownloadStreamKind = "aria2" | "sophon";

export type DownloadTaskPhase = "verifying" | "transferring";

export type DownloadStatus =
  | "queued"
  | "active"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export type DownloadFileSnapshot = {
  id: string;
  name: string;
  progress: number;
  speed: number;
  downloaded: number;
  total: number;
};

export interface DownloadStream {
  id: string;
  kind: DownloadStreamKind;
  taskId: string;
  /** Stable launcher task that owns this low-level transfer stream. */
  ownerTaskId?: string;
  /** Per-game control namespace. Undefined streams are launcher-global. */
  key?: string;
  title: string;
  phaseKind?: DownloadTaskPhase;
  status: DownloadStatus;
  progress: number;
  speed: number;
  downloaded: number;
  total: number;
  files?: DownloadFileSnapshot[];
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  setSpeedLimit: (bps: number) => Promise<void>;
}

export type DownloadTaskSnapshot = {
  id: string;
  key?: string;
  title: string;
  phaseKind?: DownloadTaskPhase;
  phase: string;
  transferring: boolean;
  status: DownloadStatus;
  progress: number;
  indeterminate: boolean;
  speed: number;
  downloaded: number;
  total: number;
  fileIndex?: number;
  fileCount?: number;
  engines: DownloadStreamKind[];
  files: DownloadFileSnapshot[];
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
};

export type DownloadTaskMetadata = { title: string; key?: string };

export type DownloadStreamUpdate = Partial<
  Pick<
    DownloadStream,
    | "phaseKind"
    | "status"
    | "progress"
    | "speed"
    | "downloaded"
    | "total"
    | "files"
    | "canPause"
    | "canResume"
    | "canCancel"
  >
>;

export type DownloadTaskOverallUpdate = {
  progress: number;
  downloaded: number;
  total: number;
  totalKnown?: boolean;
};
