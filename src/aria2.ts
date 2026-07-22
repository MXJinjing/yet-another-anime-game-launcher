import { WebSocket as RPC } from "libaria2-ts";
import {
  beginControlledDownload,
  DownloadCancelledError,
  endControlledDownload,
  updateControlledDownload,
} from "./download-control";
import {
  downloadPercent,
  formatDownloadSpeed,
  getKeyOrDefault,
  humanFileSize,
  log,
  sha256_16,
  wait,
  timeout,
} from "./utils";
import { basename } from "path-browserify";
import { normalizeHttpProxy } from "./config/proxy";

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
}: {
  host: string;
  port: number;
}) {
  await wait(500); // FIXME:
  const rpc = new RPC.Client({
    host,
    port,
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

  async function* doStreaming(gid: string, isCancelled: () => boolean) {
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
      if (status.status == "paused") {
        updateControlledDownload({ paused: true, pauseRequested: true });
        if (!pausedYielded && status.totalLength > BigInt(0)) {
          pausedYielded = true;
          yield status;
        }
        await wait(250);
        continue;
      }
      updateControlledDownload({ paused: false });
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
  }) {
    const gid = await sha256_16(`${options.uri}:${options.absDst}`);
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
      await rpc.addUri(options.uri, {
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
    await log(`正在下载 ${basename(options.absDst)}（${options.uri}）`);
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
        updateControlledDownload({ paused: true, pauseRequested: true });
        return status;
      }
      if (status.status == "active" || status.status == "waiting") {
        updateControlledDownload({ paused: false });
        return status;
      }
      return status;
    }
    beginControlledDownload({
      pause: async () => {
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
          updateControlledDownload({ pauseRequested: true });
          return;
        }
        await log(
          `忽略暂停请求：${basename(options.absDst)} 当前 aria2 状态为 ${
            status.status
          }`
        );
      },
      resume: async () => {
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
          updateControlledDownload({ paused: false, pauseRequested: false });
          return;
        }
        await log(
          `忽略继续请求：${basename(options.absDst)} 当前 aria2 状态为 ${
            status.status
          }`
        );
      },
      cancel: async () => {
        cancelled = true;
        try {
          await rpc.forceRemove(gid);
        } catch (error) {
          await log(`取消下载时 aria2 已无活动任务：${String(error)}`);
        }
      },
    });
    try {
      for await (const status of doStreaming(gid, () => cancelled)) {
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
      endControlledDownload();
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

export async function createAria2Retry({
  host,
  port,
}: {
  host: string;
  port: number;
}): Promise<Aria2> {
  for (let i = 0; i < 30; i++) {
    try {
      return await createAria2({ host, port });
    } catch (e) {
      await log("Fail to create aria2 rpc, retrying... " + e);
    }
  }
  throw new Error("Fail to create aria2 rpc");
}
