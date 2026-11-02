import { describe, expect, it, vi } from "vitest";
vi.mock("@logging/logger", () => ({ log: vi.fn(), logerror: vi.fn() }));
vi.mock("@runtime/fatal", () => ({ fatal: vi.fn() }));
import { fatal } from "@runtime/fatal";
import { DownloadCancelledError, DownloadFailedError } from "@download/control";
import { ConnectionError } from "@services/connection-error";
import { TaskFailedError } from "@tasks/task-program";
import { createTaskRunner } from "@tasks/task-runner";
import { getDownloadTasks } from "@download/task-registry";

const locale = {
  get: (key: string) => key,
  format: (key: string, args: string[]) => `${key}:${args.join(",")}`,
} as never;
function harness() {
  const notifier = {
    taskCompleted: vi.fn(),
    taskCancelled: vi.fn(),
    taskFailed: vi.fn(),
    connectionError: vi.fn(),
  };
  return { notifier, runner: createTaskRunner({ locale, notifier }) };
}
describe("task errors and recovery", () => {
  it.each([
    [new DownloadCancelledError(), "taskCancelled"],
    [new DownloadFailedError("disk"), "taskFailed"],
    [new TaskFailedError("invalid manifest"), "taskFailed"],
    [new ConnectionError("offline"), "connectionError"],
    [new Error("User cancelled"), "taskFailed"],
  ] as const)(
    "reports an expected failure and releases its queue",
    async (error, notification) => {
      const { runner, notifier } = harness();
      const next = vi.fn();
      runner.enqueue({
        key: "game",
        name: "UPDATE",
        downloadTask: { title: "Update" },
        fn: async function* () {
          throw error;
        },
      });
      runner.enqueue({
        key: "game",
        fn: async function* () {
          next();
        },
      });
      await runner.waitForIdle("game");
      expect(notifier[notification]).toHaveBeenCalledOnce();
      expect(notifier.taskCompleted).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
      expect(runner.isBusy("game")).toBe(false);
      expect(getDownloadTasks()).toEqual([]);
    }
  );
  it("surfaces unexpected failures and still clears task state", async () => {
    const { runner } = harness();
    const error = new Error("unexpected");
    runner.enqueue({
      fn: async function* () {
        throw error;
      },
    });
    await runner.waitForIdle("__global__");
    expect(fatal).toHaveBeenCalledWith(error);
    expect(runner.isBusy("__global__")).toBe(false);
  });
  it("keeps independent games running while another game's task waits", async () => {
    const { runner } = harness();
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => {
      finish = resolve;
    });
    const done = vi.fn();
    runner.enqueue({
      key: "one",
      fn: async function* () {
        await blocked;
      },
    });
    runner.enqueue({
      key: "two",
      fn: async function* () {
        done();
      },
    });
    await runner.waitForIdle("two");
    expect(done).toHaveBeenCalledOnce();
    expect(runner.isBusy("one")).toBe(true);
    finish();
    await runner.waitForIdle("one");
  });
  it("updates download phase counters while a task is running", async () => {
    const { runner } = harness();
    const snapshots: unknown[] = [];
    runner.enqueue({
      key: "game",
      downloadTask: { title: "Update", showImmediately: true },
      fn: async function* () {
        yield [
          "setStateText",
          "DOWNLOADING_FILE_PROGRESS",
          "a",
          "b",
          "c",
          "d",
          "e",
          "2",
          "4",
        ];
        snapshots.push(getDownloadTasks()[0]);
        yield [
          "setStateText",
          "DOWNLOADING_ENVIRONMENT_SPEED",
          "a",
          "b",
          "c",
          "d",
          "3",
          "5",
        ];
        snapshots.push(getDownloadTasks()[0]);
        yield ["setUndeterminedProgress"];
      },
    });
    await runner.waitForIdle("game");
    expect(snapshots[0]).toMatchObject({
      fileIndex: 2,
      fileCount: 4,
      transferring: true,
    });
    expect(snapshots[1]).toMatchObject({
      fileIndex: 3,
      fileCount: 5,
      transferring: true,
    });
  });
});
