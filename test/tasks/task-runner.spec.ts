import { describe, expect, it, vi } from "vitest";

const completed = vi.fn();
const beginDownloadTask = vi.fn(() => "download-task");
const endDownloadTask = vi.fn();

vi.mock("@logging/logger", () => ({
  log: vi.fn(async () => undefined),
  logerror: vi.fn(async () => undefined),
}));

vi.mock("@runtime/fatal", () => ({
  fatal: vi.fn(),
}));

vi.mock("@download/control", () => ({
  isDownloadCancelledError: () => false,
  isDownloadFailedError: () => false,
}));

vi.mock("@download/task-registry", () => ({
  beginDownloadTask,
  endDownloadTask,
  updateDownloadTaskFileCounter: vi.fn(),
  updateDownloadTaskPhase: vi.fn(),
}));

import { createTaskRunner } from "@tasks/task-runner";
import type { TaskProgram } from "@tasks/task-program";

const locale = {
  get: (key: string) => key,
  format: (key: string, args: string[]) => `${key}:${args.join(",")}`,
} as never;

const notifier = {
  taskCompleted: completed,
  taskCancelled: vi.fn(),
  taskFailed: vi.fn(),
  connectionError: vi.fn(),
};

async function flushTasks() {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("createTaskRunner", () => {
  it("serializes tasks sharing a key while allowing completion notifications", async () => {
    const steps: string[] = [];
    const runner = createTaskRunner({ locale, notifier });
    runner.enqueue({
      key: "game",
      name: "UPDATE_GAME" as never,
      fn: async function* (): TaskProgram {
        steps.push("first-start");
        yield ["setProgress", 25];
        await Promise.resolve();
        steps.push("first-end");
      },
    });
    runner.enqueue({
      key: "game",
      fn: async function* (): TaskProgram {
        steps.push("second");
      },
    });

    await flushTasks();

    expect(steps).toEqual(["first-start", "first-end", "second"]);
    expect(runner.getState("game").progress()).toBe(25);
    expect(runner.getState("game").busy()).toBe(false);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(beginDownloadTask).toHaveBeenCalledTimes(2);
    expect(endDownloadTask).toHaveBeenCalledTimes(2);
  });
});
