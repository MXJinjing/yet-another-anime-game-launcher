import { afterEach, describe, expect, it } from "vitest";
import type { DownloadStream } from "@download/types";
import {
  attachDownloadStream,
  beginDownloadTask,
  detachDownloadStream,
  endDownloadTask,
  getDownloadTasks,
  resolveDownloadTaskId,
  updateDownloadStream,
  updateDownloadTaskOverall,
  updateDownloadTaskPhase,
} from "@download/task-registry";

const createdTasks: string[] = [];

function createTask(title = "Game 1.0.0") {
  const id = beginDownloadTask({ title, key: "game" });
  createdTasks.push(id);
  return id;
}

function makeStream(
  ownerTaskId: string,
  overrides: Partial<DownloadStream> = {}
): DownloadStream {
  return {
    id: "stream",
    kind: "aria2",
    taskId: "backend-task",
    ownerTaskId,
    key: "game",
    title: "part-1.zip",
    status: "active",
    progress: 25,
    speed: 1024,
    downloaded: 25,
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
}

afterEach(() => {
  for (const id of createdTasks.splice(0)) endDownloadTask(id);
});

describe("download task snapshots", () => {
  it("keeps task-wide totals separate from the current aria2 file", () => {
    const taskId = createTask();
    const stream = makeStream(taskId);
    attachDownloadStream(stream);
    updateDownloadTaskOverall(taskId, {
      progress: 40,
      downloaded: 400,
      total: 1000,
      totalKnown: true,
    });

    const task = getDownloadTasks()[0];
    expect(task).toMatchObject({
      id: taskId,
      title: "Game 1.0.0",
      progress: 40,
      downloaded: 400,
      total: 1000,
      indeterminate: false,
    });
    expect(task.files).toHaveLength(1);
    expect(task.files[0]).toMatchObject({ name: "part-1.zip", progress: 25 });
  });

  it("shows at most eight concurrent Sophon files", () => {
    const taskId = createTask();
    const stream = makeStream(taskId, {
      kind: "sophon",
      files: Array.from({ length: 10 }, (_, index) => ({
        id: `file-${index}`,
        name: `file-${index}.bin`,
        progress: index,
        speed: 100,
        downloaded: index,
        total: 100,
      })),
    });
    attachDownloadStream(stream);
    updateDownloadStream(stream);

    const task = getDownloadTasks()[0];
    expect(task.engines).toEqual(["sophon"]);
    expect(task.files).toHaveLength(8);
    expect(task.files[7].name).toBe("file-7.bin");
  });

  it("uses stream state for the badge and never turns zero speed into pause", () => {
    const taskId = createTask();
    const stream = makeStream(taskId, { speed: 0, status: "active" });
    attachDownloadStream(stream);
    updateDownloadTaskPhase(taskId, "Downloading", true);

    expect(getDownloadTasks()[0]).toMatchObject({
      status: "active",
      speed: 0,
      phase: "Downloading",
      transferring: true,
    });
  });

  it("resolves concurrent streams by their control key", () => {
    const first = createTask("Game A");
    const second = beginDownloadTask({ title: "Game B", key: "other-game" });
    createdTasks.push(second);

    expect(resolveDownloadTaskId("game")).toBe(first);
    expect(resolveDownloadTaskId("other-game")).toBe(second);
  });

  it("returns the generated owner id when a stream has no registered owner", () => {
    const stream = makeStream("missing-task", {
      id: "orphan-stream",
      ownerTaskId: undefined,
      key: "orphan-game",
    });

    const ownerTaskId = attachDownloadStream(stream);

    expect(ownerTaskId).toMatch(/^download-task:/);
    expect(stream.ownerTaskId).toBe(ownerTaskId);
    detachDownloadStream(stream);
  });
});
