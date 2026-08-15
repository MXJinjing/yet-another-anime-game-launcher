import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@runtime/storage", () => ({
  getActiveStorageNamespace: () => "test",
  getKeyOrDefault: async (_key: string, fallback: string) => fallback,
}));

vi.mock("@logging/logger", () => ({
  log: vi.fn(),
}));

vi.mock("@download/config", () => ({
  DOWNLOAD_SPEED_LIMIT_ENABLED_KEY: "enabled",
  DOWNLOAD_SPEED_LIMIT_UNIT_KEY: "unit",
  DOWNLOAD_SPEED_LIMIT_VALUE_KEY: "value",
  speedLimitConfigToBps: () => 0,
}));

vi.mock("@download/stream-scheduler", () => ({
  registerStream: vi.fn(),
  unregisterStream: vi.fn(),
  updateStream: vi.fn(),
}));

vi.mock("@download/control", () => ({
  beginControlledDownload: vi.fn(),
  DownloadCancelledError: class DownloadCancelledError extends Error {},
  endControlledDownload: vi.fn(),
}));

import { SophonClient } from "@sophon";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  unexpectedClose() {
    this.close();
  }
}

describe("Sophon progress WebSocket lifecycle", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects instead of hanging when the socket closes while awaiting a message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ task_id: "task", status: "running" }),
      }))
    );
    const iterator = new SophonClient("127.0.0.1").streamOperationProgress(
      "task"
    );
    const next = iterator.next();
    const websocket = FakeWebSocket.instances[0];
    websocket.open();
    await new Promise(resolve => setTimeout(resolve, 150));
    websocket.unexpectedClose();

    await expect(next).rejects.toThrow(
      "WebSocket connection closed before the operation completed"
    );
  });

  it("uses task status as a terminal fallback for a task that finished early", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ task_id: "task", status: "completed" }),
      }))
    );
    const iterator = new SophonClient("127.0.0.1").streamOperationProgress(
      "task"
    );
    const next = iterator.next();
    FakeWebSocket.instances[0].open();

    await expect(next).resolves.toMatchObject({
      done: false,
      value: { type: "job_end", task_id: "task" },
    });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });
});
