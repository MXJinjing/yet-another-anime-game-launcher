import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadStream } from "@download/types";
import * as queue from "@download/stream-scheduler";
import {
  DownloadControlState,
  pauseControlledDownload,
  resumeControlledDownload,
  subscribeDownloadControl,
} from "@download/control";

vi.mock("@runtime/storage", () => ({
  getKeyOrDefault: vi.fn(async (_key: string, fallback: string) => fallback),
}));

vi.mock("@logging/logger", () => ({
  log: vi.fn(),
}));

const streamIds: string[] = [];

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}

function makeStream(overrides: Partial<DownloadStream> = {}): DownloadStream {
  const stream: DownloadStream = {
    id: `stream-${streamIds.length}`,
    kind: "aria2",
    taskId: `task-${streamIds.length}`,
    key: "game-1",
    title: "Download",
    status: "active",
    progress: 0,
    speed: 0,
    downloaded: 0,
    total: 100,
    canPause: true,
    canResume: true,
    canCancel: true,
    pause: async () => undefined,
    resume: async () => undefined,
    cancel: async () => undefined,
    setSpeedLimit: async () => undefined,
    ...overrides,
  };
  streamIds.push(stream.id);
  return stream;
}

afterEach(() => {
  for (const id of streamIds) queue.unregisterStream(id);
  streamIds.length = 0;
});

describe("download manager and primary action synchronization", () => {
  it("projects modal pause and resume immediately from queue status", async () => {
    const pause = deferred();
    const resume = deferred();
    const stream = makeStream({
      pause: () => pause.promise,
      resume: () => resume.promise,
    });
    const states: DownloadControlState[] = [];
    const unsubscribe = subscribeDownloadControl(
      state => states.push(state),
      "game-1"
    );
    queue.registerStream(stream);

    const pausing = queue.pauseStream(stream.id);
    expect(states[states.length - 1]).toMatchObject({
      active: true,
      paused: true,
      pauseRequested: true,
      canPause: false,
      canResume: true,
      actionPending: false,
    });

    pause.resolve();
    await pausing;

    const resuming = queue.resumeStream(stream.id);
    expect(states[states.length - 1]).toMatchObject({
      active: true,
      paused: false,
      pauseRequested: false,
      canPause: true,
      canResume: false,
      actionPending: false,
    });

    resume.resolve();
    await resuming;
    unsubscribe();
  });

  it("clears the primary pause projection when the modal resumes it", async () => {
    const stream = makeStream();
    const states: DownloadControlState[] = [];
    const unsubscribe = subscribeDownloadControl(
      state => states.push(state),
      "game-1"
    );
    queue.registerStream(stream);

    await pauseControlledDownload("game-1");
    expect(states[states.length - 1]).toMatchObject({
      paused: true,
      pauseRequested: true,
      canPause: false,
      canResume: true,
      actionPending: false,
    });

    await queue.resumeStream(stream.id);
    expect(states[states.length - 1]).toMatchObject({
      paused: false,
      pauseRequested: false,
      canPause: true,
      canResume: false,
      actionPending: false,
    });
    unsubscribe();
  });

  it("lets the primary control resume a download paused in the modal", async () => {
    const stream = makeStream();
    const states: DownloadControlState[] = [];
    const unsubscribe = subscribeDownloadControl(
      state => states.push(state),
      "game-1"
    );
    queue.registerStream(stream);

    await queue.pauseStream(stream.id);
    expect(states[states.length - 1]).toMatchObject({
      paused: true,
      pauseRequested: true,
      canPause: false,
      canResume: true,
      actionPending: false,
    });

    await resumeControlledDownload("game-1");
    expect(states[states.length - 1]).toMatchObject({
      paused: false,
      pauseRequested: false,
      canPause: true,
      canResume: false,
      actionPending: false,
    });
    unsubscribe();
  });
});
