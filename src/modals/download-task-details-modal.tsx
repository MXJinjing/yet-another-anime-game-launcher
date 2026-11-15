import { Progress, ProgressIndicator } from "@hope-ui/solid";
import { For, Show } from "solid-js";
import { AppModal } from "../components/app-modal";
import type { DownloadTaskSnapshot } from "../download/types";
import type { Locale } from "../locale";
import { formatDownloadSpeed, humanFileSize } from "../runtime/format";
import { SophonDownloadDetails } from "./sophon-download-details";
import "./download-task-details-modal.css";

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function DownloadTaskDetailsModal(props: {
  task?: DownloadTaskSnapshot;
  locale: Locale;
  onClose: () => void;
}) {
  const hasSophonMetrics = () => Boolean(props.task?.sophonActivities?.size);

  return (
    <AppModal
      opened={props.task !== undefined}
      onClose={props.onClose}
      title={props.task?.title ?? ""}
      maxWidth={hasSophonMetrics() ? 1040 : 640}
      height={hasSophonMetrics() ? "min(780px, calc(100vh - 48px))" : undefined}
      contentClass="download-task-details-modal"
    >
      <Show when={props.task}>
        {task => (
          <div class="download-task-details">
            <div class="download-queue-engine">
              {props.locale.get("DOWNLOAD_TASK_ENGINE")}:{" "}
              {task()
                .engines.map(engine =>
                  engine === "sophon" ? "Sophon" : "aria2"
                )
                .join(" + ")}
            </div>
            <Show when={task().files.length > 0}>
              <div class="download-queue-files">
                <For each={task().files.slice(0, 8)}>
                  {file => (
                    <div class="download-queue-file">
                      <div class="download-queue-file-header">
                        <span
                          class="download-queue-file-name"
                          title={file.name}
                        >
                          {fileName(file.name)}
                        </span>
                        <div class="download-queue-file-meta">
                          <span>
                            {Math.min(100, Math.max(0, file.progress)).toFixed(
                              1
                            )}
                            %
                          </span>
                          <span>{formatDownloadSpeed(file.speed)}</span>
                          <span>
                            {humanFileSize(file.downloaded)} /{" "}
                            {file.total > 0
                              ? humanFileSize(file.total)
                              : props.locale.get("DOWNLOAD_TASK_UNKNOWN_SIZE")}
                          </span>
                        </div>
                      </div>
                      <Progress
                        class="download-queue-file-progress"
                        value={file.progress}
                        indeterminate={file.total <= 0}
                        size="sm"
                        borderRadius={6}
                      >
                        <ProgressIndicator
                          style={"transition: none;"}
                          borderRadius={6}
                        />
                      </Progress>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <For each={Array.from(task().sophonActivities?.keys() ?? [])}>
              {activityId => (
                <Show when={task().sophonActivities?.get(activityId)}>
                  {activity => (
                    <SophonDownloadDetails
                      activity={activity()}
                      locale={props.locale}
                      paused={task().status === "paused"}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>
        )}
      </Show>
    </AppModal>
  );
}
