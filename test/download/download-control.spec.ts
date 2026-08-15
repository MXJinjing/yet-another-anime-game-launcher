import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeStream = Record<string, unknown>;

vi.mock("@download/stream-scheduler", () => {
  const streams: FakeStream[] = [];
  const listeners = new Set<(streams: readonly unknown[]) => void>();
  const pauseStream = vi.fn(async () => undefined);
  const resumeStream = vi.fn(async () => undefined);
  const cancelStream = vi.fn(async () => undefined);
  return {
    __state: {
      streams,
      listeners,
      pauseStream,
      resumeStream,
      cancelStream,
      emit: () => {
        for (const listener of listeners) {
          listener([...streams]);
        }
      },
    },
    getStreams: () => [...streams],
    getStreamsByKey: (key: string) =>
      streams.filter(stream => (stream.key ?? "") === key),
    subscribe: (listener: (streams: readonly unknown[]) => void) => {
      listeners.add(listener);
      listener([...streams]);
      return () => {
        listeners.delete(listener);
      };
    },
    pauseStream,
    resumeStream,
    cancelStream,
  };
});

vi.mock("@runtime/storage", () => ({
  getActiveStorageNamespace: () => "",
}));

import * as downloadQueueModule from "@download/stream-scheduler";
import {
  cancelControlledDownload,
  getDownloadControlState,
  hasActiveDownloads,
  pauseControlledDownload,
  resumeControlledDownload,
  subscribeDownloadControl,
} from "@download/control";

const mock = (
  downloadQueueModule as unknown as {
    __state: {
      streams: FakeStream[];
      listeners: Set<(streams: readonly unknown[]) => void>;
      pauseStream: ReturnType<typeof vi.fn>;
      resumeStream: ReturnType<typeof vi.fn>;
      cancelStream: ReturnType<typeof vi.fn>;
      emit: () => void;
    };
  }
).__state;

function makeStream(overrides: Record<string, unknown> = {}) {
  return {
    id: "test",
    kind: "aria2",
    taskId: "t",
    title: "t",
    status: "active",
    progress: 0,
    speed: 0,
    downloaded: 0,
    total: 0,
    canPause: true,
    canResume: true,
    canCancel: true,
    pause: async () => undefined,
    resume: async () => undefined,
    cancel: async () => undefined,
    setSpeedLimit: async () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  mock.streams.length = 0;
  mock.listeners.clear();
  mock.pauseStream.mockClear();
  mock.resumeStream.mockClear();
  mock.cancelStream.mockClear();
});

describe("download-control projection over the queue manager", () => {
  it("derives state from streams matching the key", () => {
    mock.streams.push(makeStream({ id: "s1", key: "game1" }));
    mock.emit();

    expect(getDownloadControlState("game1")).toMatchObject({
      active: true,
      paused: false,
      pauseRequested: false,
      canPause: true,
      canResume: false,
      canCancel: true,
    });
    expect(getDownloadControlState("game2")).toMatchObject({
      active: false,
      canPause: false,
      canResume: false,
    });
  });

  it("treats paused and queued streams correctly", () => {
    mock.streams.push(makeStream({ id: "s1", key: "g", status: "paused" }));
    mock.emit();
    const paused = getDownloadControlState("g");
    expect(paused.active).toBe(true);
    expect(paused.paused).toBe(true);
    expect(paused.pauseRequested).toBe(true);
    expect(paused.canPause).toBe(false);
    expect(paused.canResume).toBe(true);

    mock.streams.length = 0;
    mock.streams.push(makeStream({ id: "s2", key: "g", status: "queued" }));
    mock.emit();
    const queued = getDownloadControlState("g");
    expect(queued.active).toBe(true);
    expect(queued.paused).toBe(false);
    expect(queued.canPause).toBe(false);
    expect(queued.canResume).toBe(false);
  });

  it("only enables resume for resumable paused streams", () => {
    mock.streams.push(
      makeStream({
        id: "paused1",
        key: "g",
        status: "paused",
        canResume: false,
      })
    );
    expect(getDownloadControlState("g").canResume).toBe(false);

    mock.streams.push(
      makeStream({ id: "paused2", key: "g", status: "paused" })
    );
    expect(getDownloadControlState("g").canResume).toBe(true);
  });

  it("clears active for terminal statuses", () => {
    mock.streams.push(
      makeStream({ id: "s1", key: "g", status: "completed" }),
      makeStream({ id: "s2", key: "g", status: "error" })
    );
    mock.emit();
    expect(getDownloadControlState("g").active).toBe(false);
    expect(hasActiveDownloads()).toBe(false);
  });

  it("reports hasActiveDownloads for queued/paused/active streams", () => {
    mock.streams.push(makeStream({ id: "s1", key: "g", status: "queued" }));
    mock.emit();
    expect(hasActiveDownloads()).toBe(true);
  });

  it("subscribeDownloadControl emits immediately and on queue updates", () => {
    const seen: Array<ReturnType<typeof getDownloadControlState>> = [];
    const unsubscribe = subscribeDownloadControl(
      state => seen.push(state),
      "g"
    );
    // The initial emit fires at least once with the idle state (the queue
    // subscribe callback and the local emitKey can both fire once).
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].active).toBe(false);

    mock.streams.push(makeStream({ id: "s1", key: "g", status: "paused" }));
    mock.emit();
    expect(seen[seen.length - 1].paused).toBe(true);

    const afterPaused = seen.length;
    unsubscribe();
    mock.streams[0].status = "active";
    mock.emit();
    expect(seen.length).toBe(afterPaused);
  });

  it("pauseControlledDownload pauses only active streams and tracks transient state", async () => {
    mock.streams.push(
      makeStream({ id: "active1", key: "g" }),
      makeStream({ id: "queued1", key: "g", status: "queued" })
    );
    mock.emit();

    await pauseControlledDownload("g");
    expect(mock.pauseStream).toHaveBeenCalledWith("active1");
    expect(mock.pauseStream).not.toHaveBeenCalledWith("queued1");
    // The queue mock records the call but does not mutate stream status;
    // pauseRequested must not persist separately from that queue status.
    expect(getDownloadControlState("g").pauseRequested).toBe(false);
    expect(getDownloadControlState("g").actionPending).toBe(false);
  });

  it("resumeControlledDownload resumes paused streams", async () => {
    mock.streams.push(
      makeStream({ id: "paused1", key: "g", status: "paused" })
    );
    mock.emit();

    await resumeControlledDownload("g");
    expect(mock.resumeStream).toHaveBeenCalledWith("paused1");
  });

  it("cancelControlledDownload cancels non-terminal streams", async () => {
    mock.streams.push(
      makeStream({ id: "a", key: "g" }),
      makeStream({ id: "done", key: "g", status: "completed" })
    );
    mock.emit();

    await cancelControlledDownload("g");
    expect(mock.cancelStream).toHaveBeenCalledWith("a");
    expect(mock.cancelStream).not.toHaveBeenCalledWith("done");
  });
});
