import { log } from "../logging/logger";
import { TaskFailedError } from "@tasks/task-program";
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
import { getDownloadProxy } from "../download/proxy";

import {
  resolveSophonInstallOptions,
  sophonInstallSize,
  type SophonConfigMetadata,
  type SophonBranchMetadata,
  type SophonBuildMetadata,
  type SophonInstallSelection,
} from "./sophon-install-options";

import {
  readSophonSettings,
  sophonOperationSettings,
  sophonPredownloadPath,
} from "./sophon-settings";

import { recordSophonActivity, type SophonActivity } from "./sophon-activity";

export type SophonRegion = "os" | "cn" | "bb";
export type SophonGameType = "hk4e" | "hkrpg" | "nap";

const gameID = (game: string, region: SophonRegion) =>
  region === "bb" && game === "hk4e"
    ? "T2S0Gz4Dr2"
    : `${game}_${region === "os" ? "global" : "cn"}`;

interface GameOperationOptions {
  gamedir: string;
  game_type: SophonGameType;
  tempdir?: string; // sophon manifest and intermediate files
  installedVersion?: string;
  predownloadRoot?: string;
}

export interface SophonInstallOptions extends GameOperationOptions {
  selection?: SophonInstallSelection;
  install_reltype: string; // "os", "cn", or "bb"
}

export interface SophonRepairOptions extends GameOperationOptions {
  // "quick" or "reliable"
  // "quick" does file size check, "reliable" does hash check
  repair_mode: string;
}

export interface SophonUpdateOptions extends GameOperationOptions {
  predownload: boolean;
  targetVersion?: string;
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
  game_type: SophonGameType | "";
  version: string;
  install_size: number;
  updatable_versions: string[];
  release_type: "os" | "cn" | "bb";
  pre_download: boolean;
  pre_download_version?: string;
  pre_download_from?: string[];
  needs_resume?: boolean;
  error?: string;
}

export class SophonClient {
  private baseUrl: string;
  private nextID = 0;
  private cancelled = new Set<string>();
  private activity = new Map<string, SophonActivity>();

  constructor(
    host: string,
    port = 6969,
    private region: SophonRegion = "os",
    private token?: string
  ) {
    this.baseUrl = `http://${host}:${port}/rpc`;
  }

  private async rpc<T>(
    method: string,
    params: object = {},
    timeoutMs = 45_000
  ): Promise<T> {
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
        signal: AbortSignal.timeout(timeoutMs),
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
    if (reply.error) throw new TaskFailedError(reply.error.message);
    if (reply.result === undefined) {
      throw new ConnectionError(`Missing Sophon RPC result for ${method}`);
    }
    return reply.result;
  }

  private async remoteRPC<T>(method: string, params: object): Promise<T> {
    return this.rpc<T>(method, {
      ...params,
      httpProxy: await getDownloadProxy(),
    });
  }

  async healthCheck({
    logFailures = true,
    timeoutMs = 45_000,
  } = {}): Promise<boolean> {
    try {
      const { methods } = await this.rpc<{ methods: string[] }>(
        "rpc.discover",
        {},
        timeoutMs
      );
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
    downloadKey: string | undefined,
    activity: Pick<
      SophonActivity,
      "kind" | "predownload" | "sourceVersion" | "targetVersion"
    >
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
    const { operationID: taskId } = await this.remoteRPC<{
      operationID: string;
    }>(method, { ...params, bytesPerSecond });
    const sophonActivity: SophonActivity = {
      ...activity,
      id: taskId,
      status: "starting",
      history: [],
    };
    this.activity.set(taskId, sophonActivity);
    registerStream({
      id: `sophon:${taskId}`,
      kind: "sophon",
      taskId,
      key: downloadKey,
      title,
      phaseKind: activity.kind === "repair" ? "verifying" : "transferring",
      status: "active",
      progress: 0,
      speed: 0,
      downloaded: 0,
      total: 0,
      files: [],
      sophonActivity,
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
        ? (options.install_reltype as SophonRegion)
        : this.region;
    const selection = "selection" in options ? options.selection : undefined;
    const cacheOnly = "predownload" in options && options.predownload;
    const settings = await readSophonSettings();
    const rpcSettings = sophonOperationSettings(settings);
    const directory = await sophonPredownloadPath(
      options.predownloadRoot ?? "",
      options.gamedir
    );
    return this.startOperation(
      `${type}.start`,
      {
        game: gameID(options.game_type, region),
        region,
        directory: options.gamedir,
        predownload: cacheOnly,
        cacheOnly,
        mode: selection?.mode,
        voicePacks: selection?.voicePacks,
        targetVersion:
          "targetVersion" in options
            ? options.targetVersion
            : selection?.version,
        sourceVersion: type === "update" ? options.installedVersion : undefined,
        installedVersion: options.installedVersion,
        resolveAction: true,
        quickVerify:
          "repair_mode" in options && options.repair_mode === "quick",
        ...rpcSettings,
        transfer: {
          ...rpcSettings.transfer,
          predownloadDirectory:
            directory ??
            `${options.tempdir ?? `${options.gamedir}/.tmp`}/swift`,
        },
      },
      `${type} (${options.game_type})`,
      downloadKey,
      {
        kind: type,
        predownload: cacheOnly,
        sourceVersion: options.installedVersion,
        targetVersion:
          "targetVersion" in options
            ? options.targetVersion
            : selection?.version,
      }
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
        const previous = this.activity.get(taskId);
        const activity = previous && recordSophonActivity(previous, status);
        if (activity) this.activity.set(taskId, activity);
        if (status.progress) {
          const event = progressEvent(taskId, status.progress);
          const serialized = JSON.stringify(event);
          if (event && serialized !== lastSnapshot) {
            lastSnapshot = serialized;
            const progress = event.overall_progress;
            const transferring = event.type === "chunk_progress";
            updateStream(`sophon:${taskId}`, {
              sophonActivity: activity,
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
          } else if (activity) {
            updateStream(`sophon:${taskId}`, { sophonActivity: activity });
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
            : new TaskFailedError(error);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } finally {
      endControlledDownload();
      unregisterStream(`sophon:${taskId}`);
      this.cancelled.delete(taskId);
      this.activity.delete(taskId);
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

  async getInstallOptions(game: SophonGameType, directory: string) {
    const region = this.region;
    const params = { game: gameID(game, region), region, cn: region !== "os" };
    const [config, branches, build, next] = await Promise.all([
      this.remoteRPC<SophonConfigMetadata>("api.configs", params),
      this.remoteRPC<SophonBranchMetadata>("api.branches", params),
      this.remoteRPC<SophonBuildMetadata>("api.sophonBuild", params),
      this.remoteRPC<{
        action: string;
        targetVersion: string;
        mode: "CATEGORY_SCENARIO_BASE" | "CATEGORY_SCENARIO_FULL";
        voicePacks: string[];
      }>("game.nextAction", { ...params, directory }),
    ]);
    const options = resolveSophonInstallOptions(config, branches, build);
    if (next.action === "resumeInstall") {
      const resume: SophonInstallSelection = {
        mode: next.mode === "CATEGORY_SCENARIO_BASE" ? "base" : "full",
        voicePacks: next.voicePacks,
        version: next.targetVersion,
      };
      sophonInstallSize(options, resume);
      return { ...options, resume };
    }
    return options;
  }

  async getLatestOnlineGameInfo(
    reltype: SophonRegion,
    game: SophonOnlineGameInfo["game_type"],
    directory?: string
  ): Promise<SophonOnlineGameInfo> {
    try {
      const info = await this.remoteRPC<{
        version: string;
        installSize: number;
        updatableVersions: string[];
        predownloadVersion: string | null;
        predownloadFrom?: string[] | null;
        needsResume?: boolean;
      }>("game.online", {
        game: gameID(game, reltype),
        region: reltype,
        directory,
      });
      return {
        game_type: game,
        version: info.version,
        install_size: info.installSize,
        updatable_versions: info.updatableVersions,
        release_type: reltype,
        pre_download: reltype !== "bb" && Boolean(info.predownloadVersion),
        pre_download_version: info.predownloadVersion ?? undefined,
        pre_download_from: info.predownloadFrom ?? undefined,
        needs_resume: info.needsResume,
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
    return this.remoteRPC("files.list", {
      ...query,
      game: gameID("hk4e", this.region),
      region: this.region,
    });
  }

  async downloadFiles(
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
        ...sophonOperationSettings(await readSophonSettings()),
        region: this.region,
        game: gameID("hk4e", this.region),
      },
      "Selected files",
      undefined,
      { kind: "install", predownload: false, targetVersion: version }
    );
  }
}

export async function createSophon(
  host: string,
  port: number,
  region?: SophonRegion,
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
  region?: SophonRegion,
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
