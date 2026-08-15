import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_SPEED_LIMIT_ENABLED_KEY,
  DOWNLOAD_SPEED_LIMIT_VALUE_KEY,
  DOWNLOAD_SPEED_LIMIT_UNIT_KEY,
  MAX_CONCURRENT_DOWNLOADS_KEY,
} from "@download/config";
import type { DownloadStream } from "@download/types";
import * as queue from "@download/stream-scheduler";
import { log } from "@logging/logger";
import { getKeyOrDefault } from "@runtime/storage";

vi.mock("@logging/logger", () => ({
  log: vi.fn(),
}));

vi.mock("@runtime/storage", () => ({
  getKeyOrDefault: vi.fn(),
}));

const createdStreams: DownloadStream[] = [];
let streamCounter = 0;

function createStream(overrides: Partial<DownloadStream> = {}) {
  const stats = {
    pause: 0,
    resume: 0,
    cancel: 0,
    setSpeedLimit: 0,
    limits: [] as number[],
  };
  const stream: DownloadStream = {
    id: `stream-${streamCounter}`,
    kind: "aria2",
    taskId: `task-${streamCounter}`,
    title: `Stream ${streamCounter}`,
    status: "queued",
    progress: 0,
    speed: 0,
    downloaded: 0,
    total: 100,
    canPause: true,
    canResume: true,
    canCancel: true,
    pause: async () => {
      stats.pause += 1;
    },
    resume: async () => {
      stats.resume += 1;
    },
    cancel: async () => {
      stats.cancel += 1;
    },
    setSpeedLimit: async (bps: number) => {
      stats.setSpeedLimit += 1;
      stats.limits.push(bps);
    },
    ...overrides,
  };
  streamCounter += 1;
  createdStreams.push(stream);
  return { stream, stats };
}

async function setConfig(
  options: {
    enabled?: string;
    value?: string;
    unit?: string;
    maxConcurrent?: string;
  } = {}
) {
  vi.mocked(getKeyOrDefault).mockImplementation(
    async (key: string, defaultValue: string) => {
      switch (key) {
        case DOWNLOAD_SPEED_LIMIT_ENABLED_KEY:
          return options.enabled ?? "false";
        case DOWNLOAD_SPEED_LIMIT_VALUE_KEY:
          return options.value ?? "0";
        case DOWNLOAD_SPEED_LIMIT_UNIT_KEY:
          return options.unit ?? "K";
        case MAX_CONCURRENT_DOWNLOADS_KEY:
          return options.maxConcurrent ?? "0";
        default:
          return defaultValue;
      }
    }
  );
  await queue.reloadConfig();
}

async function flushAsyncActions() {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.mocked(getKeyOrDefault).mockReset();
  vi.mocked(getKeyOrDefault).mockResolvedValue("0");
  vi.mocked(log).mockReset();
});

afterEach(() => {
  queue.setGlobalTaskActive(false);
  for (const stream of createdStreams) {
    queue.unregisterStream(stream.id);
  }
  createdStreams.length = 0;
  streamCounter = 0;
});

describe("download queue concurrency", () => {
  it("pauses every active or queued stream owned by one launcher task", async () => {
    await setConfig({ maxConcurrent: "1" });
    const first = createStream({ ownerTaskId: "download-task:1" });
    const second = createStream({ ownerTaskId: "download-task:1" });
    queue.registerStream(first.stream);
    queue.registerStream(second.stream);

    await queue.pauseDownloadTask("download-task:1");

    expect(first.stream.status).toBe("paused");
    expect(second.stream.status).toBe("paused");
  });

  it("queues the second stream at the limit and promotes it after unregister", async () => {
    await setConfig({ maxConcurrent: "1" });
    const first = createStream();
    const second = createStream();

    queue.registerStream(first.stream);
    queue.registerStream(second.stream);

    expect(first.stream.status).toBe("active");
    expect(second.stream.status).toBe("queued");
    expect(second.stats.pause).toBe(1);
    expect(first.stats.pause).toBe(0);

    queue.unregisterStream(first.stream.id);
    await flushAsyncActions();

    expect(queue.getStreams().some(s => s.id === first.stream.id)).toBe(false);
    expect(second.stream.status).toBe("active");
    expect(second.stats.resume).toBe(1);
  });

  it("pauseStream releases a slot and promotes a queued stream", async () => {
    await setConfig({ maxConcurrent: "1" });
    const first = createStream();
    const second = createStream();
    queue.registerStream(first.stream);
    queue.registerStream(second.stream);

    expect(second.stream.status).toBe("queued");

    await queue.pauseStream(first.stream.id);

    expect(first.stream.status).toBe("paused");
    expect(second.stream.status).toBe("active");
    expect(second.stats.resume).toBe(1);
    expect(queue.getActiveStreamCount()).toBe(1);
  });

  it("resumeStream queues when the slot is full and auto-promotes when a slot frees", async () => {
    await setConfig({ maxConcurrent: "1" });
    const first = createStream();
    const second = createStream();
    queue.registerStream(first.stream);
    queue.registerStream(second.stream);

    // second is queued; pausing it while queued just marks it paused.
    await queue.pauseStream(second.stream.id);
    expect(second.stream.status).toBe("paused");
    expect(second.stats.pause).toBe(1);

    // Slot is still occupied by first, so resume only re-queues second.
    await queue.resumeStream(second.stream.id);
    expect(second.stream.status).toBe("queued");
    expect(second.stats.resume).toBe(0);

    // Freeing first's slot auto-promotes second.
    await queue.pauseStream(first.stream.id);
    expect(first.stream.status).toBe("paused");
    expect(second.stream.status).toBe("active");
    expect(second.stats.resume).toBe(1);
  });

  it("releases the slot on a terminal status reported by the adapter", async () => {
    await setConfig({ maxConcurrent: "1" });
    const first = createStream();
    const second = createStream();
    queue.registerStream(first.stream);
    queue.registerStream(second.stream);

    queue.updateStream(first.stream.id, { status: "completed" });
    await flushAsyncActions();

    expect(first.stream.status).toBe("completed");
    expect(second.stream.status).toBe("active");
    expect(second.stats.resume).toBe(1);
  });
});

describe("download queue bandwidth budget", () => {
  it("splits the budget evenly among active streams and resets to 0 when disabled", async () => {
    await setConfig({
      maxConcurrent: "2",
      enabled: "true",
      value: "100",
      unit: "K",
    });
    const first = createStream();
    const second = createStream();
    const third = createStream();

    queue.registerStream(first.stream);
    queue.registerStream(second.stream);
    queue.registerStream(third.stream);

    expect(first.stream.status).toBe("active");
    expect(second.stream.status).toBe("active");
    expect(third.stream.status).toBe("queued");
    // first saw the full budget alone (102400), then half (51200) with second.
    expect(first.stats.limits).toEqual([102400, 51200]);
    expect(second.stats.limits).toEqual([51200]);
    expect(third.stats.setSpeedLimit).toBe(0);

    await setConfig({
      maxConcurrent: "2",
      enabled: "false",
      value: "100",
      unit: "K",
    });

    expect(first.stats.limits[first.stats.limits.length - 1]).toBe(0);
    expect(second.stats.limits[second.stats.limits.length - 1]).toBe(0);
    expect(third.stats.setSpeedLimit).toBe(0);
  });

  it("only pushes setSpeedLimit when the share changes", async () => {
    await setConfig({
      maxConcurrent: "2",
      enabled: "true",
      value: "100",
      unit: "K",
    });
    const first = createStream();
    const second = createStream();
    queue.registerStream(first.stream);
    queue.registerStream(second.stream);

    expect(first.stats.limits).toEqual([102400, 51200]);
    expect(second.stats.limits).toEqual([51200]);

    // Progress updates do not re-push limits.
    queue.updateStream(first.stream.id, { progress: 50 });
    expect(first.stats.setSpeedLimit).toBe(2);
    expect(second.stats.setSpeedLimit).toBe(1);

    // Reloading the same config does not re-push limits.
    await setConfig({
      maxConcurrent: "2",
      enabled: "true",
      value: "100",
      unit: "K",
    });
    expect(first.stats.setSpeedLimit).toBe(2);
    expect(second.stats.setSpeedLimit).toBe(1);

    // A smaller budget changes the share for both active streams.
    await setConfig({
      maxConcurrent: "2",
      enabled: "true",
      value: "50",
      unit: "K",
    });
    expect(first.stats.limits).toEqual([102400, 51200, 25600]);
    expect(second.stats.limits).toEqual([51200, 25600]);

    // Disabling the limit resets active streams to unlimited (0).
    await setConfig({
      maxConcurrent: "2",
      enabled: "false",
      value: "50",
      unit: "K",
    });
    expect(first.stats.limits).toEqual([102400, 51200, 25600, 0]);
    expect(second.stats.limits).toEqual([51200, 25600, 0]);
  });
});

describe("download queue notifications", () => {
  it("unregisters streams and notifies subscribers with a fresh snapshot", async () => {
    await setConfig({ maxConcurrent: "1" });
    const first = createStream();
    const second = createStream();
    queue.registerStream(first.stream);
    queue.registerStream(second.stream);

    const snapshots: (readonly DownloadStream[])[] = [];
    const unsubscribe = queue.subscribe(snapshot => {
      snapshots.push(snapshot);
    });

    queue.unregisterStream(second.stream.id);

    expect(queue.getStreams().some(s => s.id === second.stream.id)).toBe(false);
    expect(snapshots.length).toBeGreaterThan(1);
    expect(
      snapshots[snapshots.length - 1].some(s => s.id === second.stream.id)
    ).toBe(false);
    unsubscribe();
  });

  it("subscribes immediately and stops notifying after unsubscribe", () => {
    const notifications: number[] = [];
    const unsubscribe = queue.subscribe(snapshot => {
      notifications.push(snapshot.length);
    });

    expect(notifications).toEqual([0]);

    const first = createStream();
    queue.registerStream(first.stream);
    expect(notifications).toEqual([0, 1]);

    unsubscribe();
    const second = createStream();
    queue.registerStream(second.stream);
    expect(notifications).toEqual([0, 1]);
  });
});

describe("global task priority", () => {
  it("queues per-game streams registered during a global task", async () => {
    await setConfig({ maxConcurrent: "0" });
    queue.setGlobalTaskActive(true);
    const game = createStream({ key: "game1" });
    const global = createStream({ key: "" });

    queue.registerStream(game.stream);
    queue.registerStream(global.stream);

    expect(game.stream.status).toBe("queued");
    expect(game.stats.pause).toBe(1);
    expect(global.stream.status).toBe("active");
    expect(global.stats.pause).toBe(0);

    queue.setGlobalTaskActive(false);
    expect(game.stream.status).toBe("active");
    await flushAsyncActions();
    expect(game.stats.resume).toBe(1);
  });

  it("keeps user-paused streams paused when the global task ends", async () => {
    await setConfig({ maxConcurrent: "0" });
    const game = createStream({ key: "game1" });
    queue.registerStream(game.stream);
    await queue.pauseStream(game.stream.id);

    queue.setGlobalTaskActive(true);
    queue.setGlobalTaskActive(false);

    expect(game.stream.status).toBe("paused");
    expect(game.stats.resume).toBe(0);
  });

  it("only restores scheduler-queued streams sharing a game key", async () => {
    await setConfig({ maxConcurrent: "0" });
    const userPaused = createStream({ key: "game1" });
    const running = createStream({ key: "game1" });
    queue.registerStream(userPaused.stream);
    queue.registerStream(running.stream);
    await queue.pauseStream(userPaused.stream.id);

    queue.setGlobalTaskActive(true);
    expect(userPaused.stream.status).toBe("paused");
    expect(running.stream.status).toBe("queued");

    queue.setGlobalTaskActive(false);
    await flushAsyncActions();
    expect(userPaused.stream.status).toBe("paused");
    expect(userPaused.stats.resume).toBe(0);
    expect(running.stream.status).toBe("active");
    expect(running.stats.resume).toBe(1);
  });

  it("serializes global pause and resume for the same stream", async () => {
    await setConfig({ maxConcurrent: "0" });
    const actions: string[] = [];
    let finishPause: (() => void) | undefined;
    const pauseFinished = new Promise<void>(resolve => {
      finishPause = resolve;
    });
    const game = createStream({
      key: "game1",
      pause: async () => {
        actions.push("pause:start");
        await pauseFinished;
        actions.push("pause:end");
      },
      resume: async () => {
        actions.push("resume");
      },
    });
    queue.registerStream(game.stream);

    queue.setGlobalTaskActive(true);
    queue.setGlobalTaskActive(false);
    expect(actions).toEqual(["pause:start"]);

    finishPause?.();
    await flushAsyncActions();
    expect(actions).toEqual(["pause:start", "pause:end", "resume"]);
  });

  it("refuses resume/cancel for per-game streams while a global task runs", async () => {
    await setConfig({ maxConcurrent: "0" });
    const game = createStream({ key: "game1" });
    const global = createStream({ key: "" });
    queue.registerStream(game.stream);
    queue.registerStream(global.stream);

    await queue.pauseStream(game.stream.id);
    await queue.pauseStream(global.stream.id);

    queue.setGlobalTaskActive(true);
    expect(queue.getGlobalTaskActive()).toBe(true);

    await queue.resumeStream(game.stream.id);
    await queue.cancelStream(game.stream.id);
    expect(game.stats.resume).toBe(0);
    expect(game.stats.cancel).toBe(0);
    expect(game.stream.status).toBe("paused");

    // Global streams (no key) are not locked.
    await queue.resumeStream(global.stream.id);
    expect(global.stats.resume).toBe(1);
    expect(global.stream.status).toBe("active");

    queue.setGlobalTaskActive(false);
    await queue.resumeStream(game.stream.id);
    expect(game.stats.resume).toBe(1);
    expect(game.stream.status).toBe("active");
  });

  it("allows a queued stream to be marked as user-paused during a global task", async () => {
    await setConfig({ maxConcurrent: "0" });
    const game = createStream({ key: "game1" });
    queue.registerStream(game.stream);

    queue.setGlobalTaskActive(true);
    await queue.pauseStream(game.stream.id);
    expect(game.stats.pause).toBe(1);
    expect(game.stream.status).toBe("paused");

    queue.setGlobalTaskActive(false);
    expect(game.stream.status).toBe("paused");
    expect(game.stats.resume).toBe(0);
  });

  it("does not auto-promote per-game queued streams during a global task", async () => {
    await setConfig({ maxConcurrent: "1" });
    const global1 = createStream({ key: "" });
    const game = createStream({ key: "game1" });
    queue.registerStream(global1.stream);
    queue.registerStream(game.stream);
    expect(game.stream.status).toBe("queued");

    queue.setGlobalTaskActive(true);
    // The global stream finishes, freeing its slot.
    queue.updateStream(global1.stream.id, { status: "completed" });
    expect(game.stream.status).toBe("queued");
    expect(game.stats.resume).toBe(0);

    // Once the global task ends, the slot can be handed to the game download.
    queue.setGlobalTaskActive(false);
    expect(game.stream.status).toBe("active");
    await flushAsyncActions();
    expect(game.stats.resume).toBe(1);
  });
});
