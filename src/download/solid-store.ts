import { reconcile } from "solid-js/store";
import type { DownloadStream, DownloadTaskSnapshot } from "./types";

export function reconcileDownloadStreams(next: readonly DownloadStream[]) {
  return reconcile(
    next.map(stream => ({ ...stream })),
    { key: "id" }
  );
}

export function reconcileDownloadTasks(next: readonly DownloadTaskSnapshot[]) {
  return reconcile(
    next.map(task => ({
      ...task,
      engines: [...task.engines],
      files: task.files.map(file => ({ ...file })),
    })),
    { key: "id" }
  );
}
