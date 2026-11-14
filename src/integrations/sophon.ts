import { log } from "../logging/logger";
import { getKeyOrDefault } from "../runtime/storage";
import {
  ConnectionError,
  isConnectionErrorMessage,
} from "../services/connection-error";
import {
  DOWNLOAD_SPEED_LIMIT_ENABLED_KEY,
  DOWNLOAD_SPEED_LIMIT_UNIT_KEY,
  DOWNLOAD_SPEED_LIMIT_VALUE_KEY,
  speedLimitConfigToBps,
} from "../download/config";
import {
  registerStream,
  unregisterStream,
  updateStream,
} from "../download/stream-scheduler";
import {
  beginControlledDownload,
  DownloadCancelledError,
  endControlledDownload,
} from "../download/control";
import { progressEvent, type SophonSnapshot } from "./sophon-progress";

type Region = "os" | "cn" | "bb";

const gameID = (game: string, region: Region) =>
  region === "bb" && game === "hk4e"
    ? "T2S0Gz4Dr2"
    : `${game}_${region === "os" ? "global" : "cn"}`;

interface GameOperationOptions {
  gamedir: string;
  game_type: string; // "hk4e" or "nap"
  tempdir?: string; // sophon manifest and intermediate files
  installedVersion?: string;
}

export interface SophonInstallOptions extends GameOperationOptions {
  install_reltype: string; // "os", "cn", or "bb"
}

export interface SophonRepairOptions extends GameOperationOptions {
  // "quick" or "reliable"
  // "quick" does file size check, "reliable" does hash check
  repair_mode: string;
}

export interface SophonUpdateOptions extends GameOperationOptions {
  predownload: boolean;
}

interface OperationStatus {
  status: "starting" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  progress?: SophonSnapshot;
}

export interface SophonProgressEvent {
  type: string;
  task_id: string;
  error?: string;
  active_files?: unknown[];
  // Sophon emits several event-specific JSON shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface SophonFileQuery {
  version: string;
  category?: string;
  path?: string;
  pattern?: string;
  recursive?: boolean;
  offset?: number;
  limit?: number;
  refresh?: boolean;
}

export interface SophonFileListing {
  version: string;
  category: string;
  path: string;
  total: number;
  offset: number;
  files: {
    filename: string;
    name: string;
    type: "file" | "directory";
    size?: number;
    md5?: string;
  }[];
}

export interface SophonOnlineGameInfo {
  game_type: "hk4e" | "nap" | "";
  version: string;
  install_size: number;
  updatable_versions: string[];
  release_type: "os" | "cn" | "bb";
  pre_download: boolean;
  pre_download_version?: string;
  error?: string;
}

export class SophonClient {
  private baseUrl: string;
  private nextID = 0;
  private cancelled = new Set<string>();

  constructor(
    host: string,
    port = 6969,
    private region: Region = "os",
    private token?: string
  ) {
    this.baseUrl = `http://${host}:${port}/rpc`;
  }

  private async rpc<T>(method: string, params: object = {}): Promise<T> {
    const id = ++this.nextID;
    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      throw new ConnectionError(`Sophon RPC ${method}: ${error}`);
    }
    if (!response.ok) {
      throw new ConnectionError(
        `Sophon RPC ${method}: HTTP ${response.status}`
      );
    }
    const reply = (await response.json()) as {
      id: number;
      jsonrpc: string;
      result?: T;
      error?: { message: string };
    };
    if (reply.id !== id || reply.jsonrpc !== "2.0") {
      throw new ConnectionError(`Invalid Sophon RPC response for ${method}`);
    }
    if (reply.error) throw new Error(reply.error.message);
    if (reply.result === undefined) {
      throw new ConnectionError(`Missing Sophon RPC result for ${method}`);
    }
    return reply.result;
  }

  async healthCheck({ logFailures = true } = {}): Promise<boolean> {
    try {
      const { methods } = await this.rpc<{ methods: string[] }>("rpc.discover");
      return (
        methods.includes("files.download") && methods.includes("game.online")
      );
    } catch (error) {
      if (logFailures) void log(`Sophon health check failed: ${error}`);
      return false;
    }
  }

  private async startOperation(
    method: string,
    params: object,
    title: string,
    downloadKey?: string,
    verifying = false
  ): Promise<string> {
    const enabled =
      (await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_ENABLED_KEY, "false")) ===
      "true";
    const value = Number(
      await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_VALUE_KEY, "0")
    );
    const unit = await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_UNIT_KEY, "K");
    const bytesPerSecond = Math.round(
      speedLimitConfigToBps(enabled, value, unit)
    );
    const { operationID: taskId } = await this.rpc<{ operationID: string }>(
      method,
      { ...params, bytesPerSecond }
    );
    registerStream({
      id: `sophon:${taskId}`,
      kind: "sophon",
      taskId,
      key: downloadKey,
      title,
      phaseKind: verifying ? "verifying" : "transferring",
      status: "active",
      progress: 0,
      speed: 0,
      downloaded: 0,
      total: 0,
      files: [],
      canPause: true,
      canResume: true,
      canCancel: true,
      pause: () => this.pauseOperation(taskId),
      resume: () => this.resumeOperation(taskId),
      cancel: () => this.cancelOperation(taskId),
      setSpeedLimit: (bps: number) => this.setDownloadSpeedLimit(bps, taskId),
    });
    return taskId;
  }

  async startGameOperation(
    type: "install" | "repair" | "update",
    options: SophonInstallOptions | SophonRepairOptions | SophonUpdateOptions,
    downloadKey?: string
  ): Promise<string> {
    const region =
      "install_reltype" in options
        ? (options.install_reltype as Region)
        : this.region;
    const cacheOnly = "predownload" in options && options.predownload;
    return this.startOperation(
      `${type}.start`,
      {
        game: gameID(options.game_type, region),
        region,
        directory: options.gamedir,
        predownload: cacheOnly,
        cacheOnly,
        sourceVersion: type === "update" ? options.installedVersion : undefined,
        installedVersion: options.installedVersion,
        quickVerify:
          "repair_mode" in options && options.repair_mode === "quick",
        transfer: options.tempdir
          ? { predownloadDirectory: `${options.tempdir}/swift` }
          : undefined,
      },
      `${type} (${options.game_type})`,
      downloadKey,
      type === "repair"
    );
  }

  async startInstallation(
    options: SophonInstallOptions,
    downloadKey?: string
  ): Promise<string> {
    return this.startGameOperation("install", options, downloadKey);
  }

  async startRepair(
    options: SophonRepairOptions,
    downloadKey?: string
  ): Promise<string> {
    return this.startGameOperation("repair", options, downloadKey);
  }

  async startUpdate(
    options: SophonUpdateOptions,
    downloadKey?: string
  ): Promise<string> {
    return this.startGameOperation("update", options, downloadKey);
  }

  async *streamOperationProgress(
    taskId: string
  ): AsyncGenerator<SophonProgressEvent> {
    beginControlledDownload({
      pause: () => this.pauseOperation(taskId),
      resume: () => this.resumeOperation(taskId),
      cancel: () => this.cancelOperation(taskId),
    });
    try {
      let lastSnapshot = "";
      yield { type: "job_start", task_id: taskId };
      while (true) {
        const status = await this.rpc<OperationStatus>("operation.status", {
          operationID: taskId,
        });
        if (status.progress) {
          const event = progressEvent(taskId, status.progress);
          const serialized = JSON.stringify(event);
          if (event && serialized !== lastSnapshot) {
            lastSnapshot = serialized;
            const progress = event.overall_progress;
            const transferring = event.type === "chunk_progress";
            updateStream(`sophon:${taskId}`, {
              phaseKind: transferring ? "transferring" : "verifying",
              progress: progress.overall_percent,
              speed: progress.download_speed ?? 0,
              downloaded: progress.downloaded_size ?? 0,
              total: progress.total_size ?? 0,
              files: (event.active_files ?? []).map((value: unknown) => {
                const file = value as {
                  filename: string;
                  progress_percent: number;
                  downloaded_size: number;
                  total_size: number;
                };
                return {
                  id: file.filename,
                  name: file.filename,
                  progress: file.progress_percent,
                  speed: 0,
                  downloaded: file.downloaded_size,
                  total: file.total_size,
                };
              }),
            });
            yield event;
          }
        }
        if (status.status === "completed") {
          yield { type: "job_end", task_id: taskId };
          return;
        }
        if (
          status.status === "cancelled" ||
          (status.status === "failed" && this.cancelled.has(taskId))
        ) {
          throw new DownloadCancelledError();
        }
        if (status.status === "failed") {
          const error = status.error || "Operation failed";
          yield { type: "error", task_id: taskId, error };
          throw isConnectionErrorMessage(error)
            ? new ConnectionError(error)
            : new Error(error);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } finally {
      endControlledDownload();
      unregisterStream(`sophon:${taskId}`);
      this.cancelled.delete(taskId);
    }
  }

  async cancelOperation(taskId: string): Promise<void> {
    this.cancelled.add(taskId);
    try {
      await this.rpc("operation.cancel", { operationID: taskId });
    } catch (error) {
      this.cancelled.delete(taskId);
      throw error;
    }
  }

  async pauseOperation(taskId: string): Promise<void> {
    await this.rpc("operation.pause", { operationID: taskId });
  }

  async resumeOperation(taskId: string): Promise<void> {
    await this.rpc("operation.resume", { operationID: taskId });
  }

  async setDownloadSpeedLimit(bps: number, taskId?: string): Promise<void> {
    await this.rpc("operation.limit", {
      bytesPerSecond: Math.round(bps),
      operationID: taskId,
    });
  }

  async getLatestOnlineGameInfo(
    reltype: Region,
    game: SophonOnlineGameInfo["game_type"]
  ): Promise<SophonOnlineGameInfo> {
    try {
      const info = await this.rpc<{
        version: string;
        installSize: number;
        updatableVersions: string[];
        predownloadVersion: string | null;
      }>("game.online", { game: gameID(game, reltype), region: reltype });
      return {
        game_type: game,
        version: info.version,
        install_size: info.installSize,
        updatable_versions: info.updatableVersions,
        release_type: reltype,
        pre_download: reltype !== "bb" && Boolean(info.predownloadVersion),
        pre_download_version: info.predownloadVersion ?? undefined,
      };
    } catch (error) {
      return {
        game_type: "",
        version: "",
        install_size: 0,
        updatable_versions: [],
        release_type: reltype,
        pre_download: false,
        error: String(error),
      };
    }
  }

  listFiles(query: SophonFileQuery): Promise<SophonFileListing> {
    return this.rpc("files.list", {
      ...query,
      game: gameID("hk4e", this.region),
      region: this.region,
    });
  }

  downloadFiles(
    directory: string,
    version: string,
    files: string[],
    categories = ["game"]
  ): Promise<string> {
    return this.startOperation(
      "files.download",
      {
        directory,
        version,
        files,
        categories,
        region: this.region,
        game: gameID("hk4e", this.region),
      },
      "Selected files"
    );
  }
}

export async function createSophon(
  host: string,
  port: number,
  region?: Region,
  token?: string
): Promise<SophonClient> {
  const client = new SophonClient(host, port, region, token);

  if (!(await client.healthCheck())) {
    throw new Error(`Failed to connect to Sophon server at ${host}:${port}`);
  }
  return client;
}

export type Sophon = SophonClient;

export async function createSophonRetry(
  host: string,
  port: number,
  region?: Region,
  token?: string
): Promise<Sophon> {
  const client = new SophonClient(host, port, region, token);
  let lastError = "";

  for (let i = 0; i < 60; i++) {
    try {
      if (await client.healthCheck({ logFailures: false })) {
        return client;
      }
    } catch (error) {
      lastError = String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await client.healthCheck({ logFailures: true });
  throw new ConnectionError(
    `Failed to create sophon client after retries${
      lastError ? `: ${lastError}` : ""
    }`
  );
}
