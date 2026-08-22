import { log } from "../logging/logger";
import { getActiveStorageNamespace, getKeyOrDefault } from "../runtime/storage";
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
import type { DownloadFileSnapshot } from "../download/types";

// Client-side record of tasks whose cancellation was requested through the
// stream scheduler (the per-game cancel path uses a local flag inside
// streamOperationProgress instead). Kept so a server "job_error(cancelled)"
// surfaces as DownloadCancelledError instead of a generic failure.
const cancelledTaskIds = new Set<string>();

interface GameOperationOptions {
  gamedir: string;
  game_type: string; // "hk4e" or "nap"
  tempdir?: string; // sophon manifest and intermediate files
  download_speed_limit?: number; // bytes/s, 0 = unlimited
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

interface SophonOperationResponse {
  task_id: string;
  status: string;
  message: string;
}

interface SophonTaskStatus {
  task_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "";
  error?: string;
}

export interface SophonProgressEvent {
  type: string;
  task_id: string;
  [key: string]: any;
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
  private wsUrl: string;

  constructor(host: string, port = 6969) {
    this.baseUrl = `http://${host}:${port}`;
    this.wsUrl = this.baseUrl
      .replace("http://", "ws://")
      .replace("https://", "wss://");
  }

  async healthCheck({ logFailures = true } = {}): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        if (logFailures) {
          log(`Health check failed with status: ${response.status}`);
        }
        return false;
      }
      await response.json();
      return true;
    } catch (error) {
      if (logFailures) {
        log(`Health check error: ${error}`);
      }
      return false;
    }
  }

  async startGameOperation(
    type: "install" | "repair" | "update",
    options: SophonInstallOptions | SophonRepairOptions | SophonUpdateOptions
  ): Promise<string> {
    log(`Starting ${type} operation with options: ${JSON.stringify(options)}`);

    const enabled =
      (await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_ENABLED_KEY, "false")) ===
      "true";
    const value = Number(
      await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_VALUE_KEY, "0")
    );
    const unit = await getKeyOrDefault(DOWNLOAD_SPEED_LIMIT_UNIT_KEY, "K");
    const bps = speedLimitConfigToBps(enabled, value, unit);
    const body = JSON.stringify({ ...options, download_speed_limit: bps });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/${type}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (error) {
      throw new ConnectionError(
        `Failed to reach the Sophon server while starting ${type}: ${error}`
      );
    }

    if (!response.ok) {
      throw new ConnectionError(
        `${type} request failed: ${response.statusText}`
      );
    }

    const result: SophonOperationResponse = await response.json();
    const taskId = result.task_id;

    registerStream({
      id: `sophon:${taskId}`,
      kind: "sophon",
      taskId,
      key: getActiveStorageNamespace() ?? undefined,
      title: `${type} (${options.game_type})`,
      phaseKind: type === "repair" ? "verifying" : "transferring",
      status: "active",
      progress: 0,
      speed: 0,
      downloaded: 0,
      total: 0,
      files: [],
      canPause: true,
      canResume: true,
      canCancel: true,
      pause: async () => {
        await this.pauseTask(taskId);
      },
      resume: async () => {
        await this.resumeTask(taskId);
      },
      cancel: async () => {
        await this.cancelTask(taskId);
      },
      setSpeedLimit: async (bps: number) => {
        await this.setDownloadSpeedLimit(bps);
      },
    });

    return taskId;
  }

  async startInstallation(options: SophonInstallOptions): Promise<string> {
    return this.startGameOperation("install", options);
  }

  async startRepair(options: SophonRepairOptions): Promise<string> {
    return this.startGameOperation("repair", options);
  }

  async startUpdate(options: SophonUpdateOptions): Promise<string> {
    return this.startGameOperation("update", options);
  }

  async *streamOperationProgress(
    taskId: string
  ): AsyncGenerator<SophonProgressEvent> {
    const ws = new WebSocket(`${this.wsUrl}/ws/${taskId}`);

    const messageQueue: SophonProgressEvent[] = [];
    let isConnected = false;
    let isCompleted = false;
    let error: string | null = null;
    let cancelled = false;
    let messageResolver: ((value: unknown) => void) | null = null;

    const wakeMessageWaiter = () => {
      const resolver = messageResolver;
      messageResolver = null;
      resolver?.(null);
    };

    const reconcileTaskStatus = async () => {
      if (isCompleted) return;
      try {
        const response = await fetch(
          `${this.baseUrl}/api/tasks/${taskId}/status`
        );
        if (!response.ok || isCompleted) return;
        const status = (await response.json()) as SophonTaskStatus;
        let terminal: SophonProgressEvent | null = null;
        if (status.status === "completed") {
          terminal = { type: "job_end", task_id: taskId };
        } else if (status.status === "failed") {
          terminal = {
            type: "error",
            task_id: taskId,
            error: status.error || "Operation failed",
          };
        } else if (status.status === "cancelled") {
          terminal = {
            type: "job_error",
            task_id: taskId,
            error: "cancelled",
          };
        }
        if (terminal && !isCompleted) {
          messageQueue.push(terminal);
          isCompleted = true;
          if (terminal.type !== "job_end") {
            error = terminal.error as string;
          }
          wakeMessageWaiter();
        }
      } catch {
        // The WebSocket remains authoritative while it is open. A later
        // status poll or close event will surface an actual connection loss.
      }
    };

    ws.onopen = () => {
      isConnected = true;
      void reconcileTaskStatus();
    };

    ws.onmessage = event => {
      const message = JSON.parse(event.data) as SophonProgressEvent;
      messageQueue.push(message);

      wakeMessageWaiter();

      if (
        message.type === "job_end" ||
        message.type === "job_error" ||
        message.type === "error" ||
        message.type === "completed"
      ) {
        isCompleted = true;
        if (message.type === "job_error" || message.type === "error") {
          error = message.error || "Unknown error";
        }
      }
    };

    ws.onerror = event => {
      error = "WebSocket connection error";
      isCompleted = true;
      wakeMessageWaiter();
    };

    ws.onclose = () => {
      if (!isCompleted) {
        error = "WebSocket connection closed before the operation completed";
      }
      isCompleted = true;
      wakeMessageWaiter();
    };

    // Keep the download control active for the whole operation so the UI can
    // offer cancel consistently (and doesn't flicker between download/install
    // states) during non-download phases like file allocation, hashing, or
    // diffing between files. The server checks the cancel event between every
    // chunk, so cancelling outside the pure download phase still aborts the
    // operation promptly.
    beginControlledDownload({
      pause: async () => {
        await this.pauseOperation(taskId);
      },
      resume: async () => {
        await this.resumeOperation(taskId);
      },
      cancel: async () => {
        cancelled = true;
        await this.cancelOperation(taskId);
      },
    });
    try {
      // Wait for connection
      while (!isConnected && !error) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (error) {
        throw new ConnectionError(error);
      }

      while (!isCompleted || messageQueue.length > 0) {
        if (messageQueue.length > 0) {
          // Array is not empty. message is not null.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const message = messageQueue.shift()!;

          if (
            message.type === "file_download_start" ||
            message.type === "ldiff_download_start" ||
            message.type === "chunk_progress" ||
            message.type === "ldiff_download_complete"
          ) {
            updateStream(`sophon:${taskId}`, {
              phaseKind: "transferring",
            });
          }

          if (message.overall_progress) {
            const op = message.overall_progress;
            const progressPatch: {
              progress?: number;
              speed?: number;
              downloaded?: number;
              total?: number;
              files?: DownloadFileSnapshot[];
            } = {};
            const isTransferProgress =
              typeof op.downloaded_size === "number" ||
              typeof op.total_size === "number" ||
              typeof op.download_speed === "number";
            if (isTransferProgress && typeof op.overall_percent === "number") {
              progressPatch.progress = op.overall_percent;
            }
            if (typeof op.download_speed === "number") {
              progressPatch.speed = op.download_speed;
            }
            if (typeof op.downloaded_size === "number") {
              progressPatch.downloaded = op.downloaded_size;
            }
            if (typeof op.total_size === "number") {
              progressPatch.total = op.total_size;
            }
            if (Array.isArray(message.active_files)) {
              progressPatch.files = message.active_files
                .slice(0, 8)
                .filter(
                  (file: any) => file && typeof file.filename === "string"
                )
                .map((file: any) => ({
                  id: String(file.id ?? file.filename),
                  name: file.filename,
                  progress: Number(file.progress_percent) || 0,
                  speed: Number(file.download_speed) || 0,
                  downloaded: Number(file.downloaded_size) || 0,
                  total: Number(file.total_size) || 0,
                }));
            }
            if (Object.keys(progressPatch).length > 0) {
              updateStream(`sophon:${taskId}`, {
                ...progressPatch,
                canPause: true,
                canResume: true,
                canCancel: true,
              });
            }
          } else if (Array.isArray(message.active_files)) {
            updateStream(`sophon:${taskId}`, {
              files: message.active_files.slice(0, 8).map((file: any) => ({
                id: String(file.id ?? file.filename),
                name: String(file.filename ?? ""),
                progress: Number(file.progress_percent) || 0,
                speed: Number(file.download_speed) || 0,
                downloaded: Number(file.downloaded_size) || 0,
                total: Number(file.total_size) || 0,
              })),
            });
          }

          yield message;

          if (message.type === "error" || message.type === "job_error") {
            if (cancelled || cancelledTaskIds.has(taskId)) {
              throw new DownloadCancelledError();
            }
            const messageError = message.error || "Operation failed";
            throw isConnectionErrorMessage(messageError)
              ? new ConnectionError(messageError)
              : new Error(messageError);
          }
        } else {
          await new Promise<void>(resolve => {
            const timeout = setTimeout(() => {
              if (messageResolver === resolveMessage) {
                messageResolver = null;
              }
              resolve();
            }, 1000);
            const resolveMessage = () => {
              clearTimeout(timeout);
              resolve();
            };
            messageResolver = resolveMessage;
          });
          if (!isCompleted && messageQueue.length === 0) {
            await reconcileTaskStatus();
          }
        }
      }
    } finally {
      ws.close();
      endControlledDownload();
      unregisterStream(`sophon:${taskId}`);
      cancelledTaskIds.delete(taskId);
    }
    if (cancelled) {
      throw new DownloadCancelledError();
    }
    if (error) {
      throw new ConnectionError(error);
    }
  }

  async cancelOperation(taskId: string): Promise<void> {
    // Partial support at python server side
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Failed to cancel operation: ${response.statusText}`);
    }
  }

  async pauseOperation(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/pause`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Failed to pause operation: ${response.statusText}`);
    }
  }

  async resumeOperation(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/resume`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Failed to resume operation: ${response.statusText}`);
    }
  }

  async pauseTask(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/pause`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Failed to pause task: ${response.statusText}`);
    }
  }

  async resumeTask(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/resume`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Failed to resume task: ${response.statusText}`);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    cancelledTaskIds.add(taskId);
    const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Failed to cancel task: ${response.statusText}`);
    }
  }

  async setDownloadSpeedLimit(bps: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/limit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ download_speed_limit: bps }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to set download speed limit: ${response.statusText}`
      );
    }
  }

  async getLatestOnlineGameInfo(
    reltype: "os" | "cn" | "bb",
    game: string
  ): Promise<SophonOnlineGameInfo> {
    // Currently only supports "hk4e" for game, "os", "cn", or "bb" for reltype
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/api/game/online_info?game=${game}&reltype=${reltype}`
      );
    } catch (error) {
      throw new ConnectionError(
        `Failed to reach the Sophon server while fetching game info: ${error}`
      );
    }

    if (!response.ok) {
      throw new ConnectionError(
        `Failed to get game info: ${response.statusText}`
      );
    }

    return response.json();
  }
}

export async function createSophon(
  host: string,
  port: number
): Promise<SophonClient> {
  const client = new SophonClient(host, port);

  if (!(await client.healthCheck())) {
    throw new Error(`Failed to connect to Sophon server at ${host}:${port}`);
  }
  return client;
}

export type Sophon = SophonClient;

export async function createSophonRetry(
  host: string,
  port: number
): Promise<Sophon> {
  const client = new SophonClient(host, port);
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
