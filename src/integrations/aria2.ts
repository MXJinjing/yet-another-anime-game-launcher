import { WebSocket as RPC } from "libaria2-ts";
import {
  beginControlledDownload,
  DownloadCancelledError,
  DownloadFailedError,
  endControlledDownload,
  updateControlledDownload,
} from "../download/control";
import {
  registerStream,
  unregisterStream,
  updateStream,
  pauseStream,
  resumeStream,
  cancelStream,
} from "../download/stream-scheduler";
import {
  resolveDownloadTaskId,
  updateDownloadTaskOverall,
} from "../download/task-registry";
import { log } from "../logging/logger";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "../runtime/format";
import { getActiveStorageNamespace, getKeyOrDefault } from "../runtime/storage";
import { sha256_16 } from "../runtime/binary";
import { timeout, wait } from "../runtime/async";
import { basename } from "path-browserify";
import { normalizeHttpProxy } from "../config/proxy";
import { applyGithubPrefix } from "./github";

type Aria2ErrorStatus = {
  errorCode?: number;
  errorMessage?: string;
};

async function getDownloadOptions() {
  const downloadProxyEnabled =
    (await getKeyOrDefault("config_downloadProxyEnabled", "false")) == "true";
  const downloadProxyHost = normalizeHttpProxy(
    await getKeyOrDefault("config_downloadProxyHost", "")
  );
  const downloadSpeedLimitEnabled =
    (await getKeyOrDefault("config_downloadSpeedLimitEnabled", "false")) ==
    "true";
  const downloadSpeedLimitKbps = Number(
    await getKeyOrDefault("config_downloadSpeedLimitValue", "0")
  );
  const downloadSpeedLimitUnit = await getKeyOrDefault(
    "config_downloadSpeedLimitUnit",
    "K"
  );

  const opts: { [key: string]: string | number | boolean } = {};
  if (downloadProxyEnabled && downloadProxyHost) {
    opts["all-proxy"] = downloadProxyHost;
  }
  if (
    downloadSpeedLimitEnabled &&
    Number.isFinite(downloadSpeedLimitKbps) &&
    downloadSpeedLimitKbps > 0
  ) {
    opts["max-download-limit"] = `${Math.floor(
      downloadSpeedLimitKbps
    )}${downloadSpeedLimitUnit}`;
  }
  return opts;
}

export async function createAria2({
  host,
  port,
  secret,
}: {
  host: string;
  port: number;
  secret?: string;
}) {
  await wait(500); // FIXME:
  const rpc = new RPC.Client({
    host,
    port,
    auth: secret ? { secret } : undefined,
  });
  const version = await Promise.race([rpc.getVersion(), timeout(3000)]);

  function shutdown() {
    return rpc.shutdown();
  }

  function isAria2TaskMissing(error: unknown) {
    return (
      typeof error == "object" &&
      error != null &&
      "code" in error &&
      error["code"] == 1
    );
  }

  function formatAria2DownloadError(status: Aria2ErrorStatus) {
    const details = [
      status.errorCode != null ? `code ${status.errorCode}` : null,
      status.errorMessage,
    ].filter(Boolean);
    if (details.length == 0) return "aria2 download failed";
    return `aria2 download failed: ${details.join(" - ")}`;
  }

  async function* doStreaming(
    gid: string,
    isCancelled: () => boolean,
    downloadKey?: string
  ) {
    let pausedYielded = false;
    while (true) {
      let status;
      try {
        status = await rpc.tellStatus(gid);
      } catch (error) {
        if (isCancelled()) {
          throw new DownloadCancelledError();
        }
        throw error;
      }
      if (isCancelled()) {
        throw new DownloadCancelledError();
      }
      if (status.status == "complete") {
        break;
      }
      if (status.status == "removed") {
        throw new DownloadCancelledError();
      }
      if (status.status == "error") {
        throw new DownloadFailedError(formatAria2DownloadError(status));
      }
      if (status.status == "paused") {
        updateControlledDownload(
          { paused: true, pauseRequested: true },
          downloadKey
        );
        if (!pausedYielded && status.totalLength > BigInt(0)) {
          pausedYielded = true;
          yield status;
        }
        await wait(250);
        continue;
      }
      updateControlledDownload({ paused: false }, downloadKey);
      pausedYielded = false;
      if (status.totalLength == BigInt(0)) {
        await wait(250);
        continue;
      }
      yield status;
      await wait(100);
    }
  }

  async function* doStreamingDownload(options: {
    uri: string;
    absDst: string;
    /** Associates the download with a per-game download control key. */
    downloadKey?: string;
  }) {
    const requestUri = applyGithubPrefix(options.uri);
    const gid = await sha256_16(`${requestUri}:${options.absDst}`);
    const downloadOptions = await getDownloadOptions();
    let cancelled = false;
    let shouldAddDownload = false;
    try {
      const status = await rpc.tellStatus(gid);
      if (status.status == "paused") {
        await rpc.changeOption(gid, downloadOptions);
        await rpc.unpause(gid);
      } else if (status.status == "complete") {
        return;
      } else if (status.status == "removed" || status.status == "error") {
        await log(
          `清理上次未完成的下载状态：${basename(options.absDst)}（${
            status.status
          }）`
        );
        try {
          await rpc.removeDownloadResult(gid);
        } catch (cleanupError) {
          await log(`清理下载状态失败，将继续重试：${String(cleanupError)}`);
        }
        shouldAddDownload = true;
      } else if (status.status == "active" || status.status == "waiting") {
        await rpc.changeOption(gid, downloadOptions);
      } else {
        throw new Error("FIXME: implmenet me (aria2.ts) " + status.status);
      }
    } catch (e: unknown) {
      if (isAria2TaskMissing(e)) {
        shouldAddDownload = true;
      } else {
        throw e;
      }
    }
    if (shouldAddDownload) {
      await rpc.addUri(requestUri, {
        gid,
        "max-connection-per-server": 16,
        out: options.absDst,
        continue: false,
        "allow-overwrite": true, // in case control file broken
        ...downloadOptions,
      });
    }
    if (downloadOptions["all-proxy"]) {
      await log(`下载代理已启用：${downloadOptions["all-proxy"]}`);
    }
    if (downloadOptions["max-download-limit"]) {
      await log(`下载限速已启用：${downloadOptions["max-download-limit"]}`);
    }
    await log(`正在下载 ${basename(options.absDst)}（${requestUri}）`);
    let nextProgressLogAt = 0;
    async function syncDownloadPauseState() {
      let status;
      try {
        status = await rpc.tellStatus(gid);
      } catch (error) {
        if (isAria2TaskMissing(error)) {
          await log(`下载任务已不在 aria2 队列中：${basename(options.absDst)}`);
          return null;
        }
        throw error;
      }
      if (status.status == "paused") {
        updateControlledDownload(
          { paused: true, pauseRequested: true },
          options.downloadKey
        );
        return status;
      }
      if (status.status == "active" || status.status == "waiting") {
        updateControlledDownload({ paused: false }, options.downloadKey);
        return status;
      }
      return status;
    }
    async function pauseRaw() {
      const status = await syncDownloadPauseState();
      if (!status) return;
      if (status.status == "paused") return;
      if (status.status == "active" || status.status == "waiting") {
        try {
          await rpc.forcePause(gid);
        } catch (error) {
          const refreshedStatus = await syncDownloadPauseState();
          if (refreshedStatus?.status == "paused" || !refreshedStatus) {
            return;
          }
          throw error;
        }
        updateControlledDownload({ pauseRequested: true }, options.downloadKey);
        return;
      }
      await log(
        status.status == "error"
          ? `下载任务已失败，无法暂停：${basename(
              options.absDst
            )}（${formatAria2DownloadError(status)}）`
          : `忽略暂停请求：${basename(options.absDst)} 当前 aria2 状态为 ${
              status.status
            }`
      );
    }
    async function resumeRaw() {
      const status = await syncDownloadPauseState();
      if (!status) return;
      if (status.status == "active" || status.status == "waiting") return;
      if (status.status == "paused") {
        try {
          await rpc.unpause(gid);
        } catch (error) {
          const refreshedStatus = await syncDownloadPauseState();
          if (
            refreshedStatus?.status == "active" ||
            refreshedStatus?.status == "waiting" ||
            !refreshedStatus
          ) {
            return;
          }
          throw error;
        }
        updateControlledDownload(
          { paused: false, pauseRequested: false },
          options.downloadKey
        );
        return;
      }
      await log(
        status.status == "error"
          ? `下载任务已失败，无法继续：${basename(
              options.absDst
            )}（${formatAria2DownloadError(status)}）`
          : `忽略继续请求：${basename(options.absDst)} 当前 aria2 状态为 ${
              status.status
            }`
      );
    }
    async function cancelRaw() {
      cancelled = true;
      try {
        await rpc.forceRemove(gid);
      } catch (error) {
        await log(`取消下载时 aria2 已无活动任务：${String(error)}`);
      }
    }
    async function setSpeedLimitRaw(bps: number) {
      await rpc.changeOption(gid, {
        "max-download-limit": String(Math.floor(bps)),
      });
    }
    const streamId = `aria2:${gid}`;
    registerStream({
      id: streamId,
      kind: "aria2",
      taskId: gid,
      key: options.downloadKey ?? getActiveStorageNamespace() ?? undefined,
      title: basename(options.absDst),
      status: "active",
      progress: 0,
      speed: 0,
      downloaded: 0,
      total: 0,
      canPause: true,
      canResume: true,
      canCancel: true,
      pause: pauseRaw,
      resume: resumeRaw,
      cancel: cancelRaw,
      setSpeedLimit: setSpeedLimitRaw,
    });
    beginControlledDownload(
      {
        pause: async () => {
          await pauseStream(streamId);
        },
        resume: async () => {
          await resumeStream(streamId);
        },
        cancel: async () => {
          await cancelStream(streamId);
        },
      },
      options.downloadKey
    );
    try {
      for await (const status of doStreaming(
        gid,
        () => cancelled,
        options.downloadKey
      )) {
        const total = Number(status.totalLength);
        const progress =
          total > 0
            ? Math.min(
                100,
                Math.max(0, (Number(status.completedLength) / total) * 100)
              )
            : 0;
        updateStream(streamId, {
          progress,
          speed: Number(status.downloadSpeed),
          downloaded: Number(status.completedLength),
          total,
          canPause: true,
          canResume: true,
          canCancel: true,
        });
        const now = Date.now();
        if (now >= nextProgressLogAt) {
          await log(
            [
              `下载进度：${basename(options.absDst)}`,
              `${humanFileSize(Number(status.completedLength))}/${humanFileSize(
                Number(status.totalLength)
              )}`,
              downloadPercent(status.completedLength, status.totalLength),
              `当前速度：${formatDownloadSpeed(Number(status.downloadSpeed))}`,
            ].join("，")
          );
          nextProgressLogAt = now + 5000;
        }
        yield status;
      }
    } finally {
      unregisterStream(streamId);
      endControlledDownload(options.downloadKey);
    }
    await log(`下载进度 100%：${basename(options.absDst)}`);
  }

  return {
    version,
    shutdown,
    doStreamingDownload,
  };
}

export type Aria2 = ReturnType<typeof createAria2> extends Promise<infer T>
  ? T
  : never;

/** Tracks overall progress across a sequence of `doStreamingDownload` calls so
 *  the reported percentage covers the whole set, not just the current file.
 *
 *  Feed each streamed status to `step()`/`current()` and call `finishFile()`
 *  after every file's stream completes. When the grand total is known up front
 *  (e.g. from the version-info API) pass it to the constructor so the
 *  percentage is correct from the very first byte. */
export class Aria2OverallProgress {
  private completed = BigInt(0);
  private knownTotal: bigint | null;
  private runningTotal = BigInt(0);
  private lastTotal = BigInt(0);
  private taskId = resolveDownloadTaskId(
    getActiveStorageNamespace() ?? undefined
  );

  constructor(totalBytes?: bigint) {
    this.knownTotal = totalBytes ?? null;
  }

  /** Returns { completed, total } including the current status. */
  current(status: { completedLength: bigint; totalLength: bigint }): {
    completed: bigint;
    total: bigint;
  } {
    this.lastTotal = status.totalLength;
    const total = this.knownTotal ?? this.runningTotal + status.totalLength;
    const current = {
      completed: this.completed + status.completedLength,
      total,
    };
    updateDownloadTaskOverall(this.taskId, {
      progress:
        total > BigInt(0)
          ? Number((current.completed * BigInt(10000)) / total) / 100
          : 0,
      downloaded: Number(current.completed),
      total: Number(total),
      totalKnown: this.knownTotal !== null,
    });
    return current;
  }

  /** Returns the overall percent (0-100) including the current status. */
  step(status: { completedLength: bigint; totalLength: bigint }): number {
    const { completed, total } = this.current(status);
    if (total === BigInt(0)) return 0;
    return Number((completed * BigInt(10000)) / total) / 100;
  }

  /** Adds the just-finished file's size to the running totals. */
  finishFile(): void {
    this.completed += this.lastTotal;
    if (this.knownTotal === null) {
      this.runningTotal += this.lastTotal;
    }
  }
}

export async function createAria2Retry({
  host,
  port,
  secret,
}: {
  host: string;
  port: number;
  secret?: string;
}): Promise<Aria2> {
  for (let i = 0; i < 30; i++) {
    try {
      return await createAria2({ host, port, secret });
    } catch (e) {
      await log("Fail to create aria2 rpc, retrying... " + e);
    }
  }
  throw new Error("Fail to create aria2 rpc");
}
