import { Progress, ProgressIndicator } from "@hope-ui/solid";
import { For, Show, createSignal, onCleanup } from "solid-js";
import { AppModal } from "../components/app-modal";
import {
  cancelStream,
  DownloadStream,
  getGlobalTaskActive,
  getStreams,
  pauseStream,
  resumeStream,
  subscribe,
} from "../download-queue";
import { Locale, LocaleTextKey } from "../locale";
import { formatDownloadSpeed, humanFileSize } from "@utils";

const STATUS_LOCALE_KEYS: Record<DownloadStream["status"], LocaleTextKey> = {
  queued: "DOWNLOAD_STATUS_QUEUED",
  active: "DOWNLOAD_STATUS_ACTIVE",
  paused: "DOWNLOAD_STATUS_PAUSED",
  completed: "DOWNLOAD_STATUS_COMPLETED",
  error: "DOWNLOAD_STATUS_ERROR",
  cancelled: "DOWNLOAD_STATUS_CANCELLED",
};

export function DownloadQueueModal({
  opened,
  onClose,
  locale,
}: {
  opened: boolean;
  onClose: () => void;
  locale: Locale;
}) {
  const [streams, setStreams] = createSignal<readonly DownloadStream[]>(
    getStreams()
  );
  const [globalTaskActive, setGlobalTaskActive] = createSignal(
    getGlobalTaskActive()
  );
  onCleanup(
    subscribe(next => {
      // The queue mutates stream objects in place and re-emits the same
      // references on every update, so copy each entry to give the list fresh
      // identities and keep row content (status/progress/speed/sizes) in sync.
      setGlobalTaskActive(getGlobalTaskActive());
      setStreams(next.map(stream => ({ ...stream })));
    })
  );
  // While a launcher-global task runs, per-game downloads are locked (the
  // queue manager refuses resume/cancel and holds queued streams), so hide
  // their action buttons. Global-task streams (no key) stay manageable.
  const isLocked = (stream: DownloadStream) =>
    globalTaskActive() && Boolean(stream.key);

  return (
    <AppModal
      opened={opened}
      onClose={onClose}
      title={locale.get("DOWNLOAD_MANAGER")}
      maxWidth={720}
      height={520}
      bodyClass="download-queue-body"
    >
      <Show when={globalTaskActive()}>
        <div class="download-queue-global-hint">
          {locale.get("DOWNLOAD_MANAGER_GLOBAL_TASK_WAITING")}
        </div>
      </Show>
      <Show when={streams().length === 0}>
        <div class="download-queue-empty">
          {locale.get("DOWNLOAD_MANAGER_EMPTY")}
        </div>
      </Show>
      <Show when={streams().length > 0}>
        <div class="download-queue-list">
          <For each={streams()}>
            {stream => (
              <div class="download-queue-item">
                <div class="download-queue-item-header">
                  <div class="download-queue-item-titles">
                    <div class="download-queue-item-title" title={stream.title}>
                      {stream.title}
                    </div>
                    <div class="download-queue-item-task">
                      <span class="download-queue-item-task-label">
                        {locale.get("DOWNLOAD_TASK_ID")}:
                      </span>
                      <span class="download-queue-item-task-id">
                        {stream.taskId}
                      </span>
                    </div>
                  </div>
                  <span
                    classList={{
                      "download-queue-badge": true,
                      [`download-queue-badge--${stream.status}`]: true,
                    }}
                  >
                    {locale.get(STATUS_LOCALE_KEYS[stream.status])}
                  </span>
                </div>
                <Progress
                  class="download-queue-progress"
                  value={stream.progress}
                  indeterminate={false}
                  size="sm"
                  borderRadius={8}
                >
                  <ProgressIndicator
                    style={"transition: none;"}
                    borderRadius={8}
                  />
                </Progress>
                <div class="download-queue-item-meta">
                  <span>{formatDownloadSpeed(stream.speed)}</span>
                  <span>
                    {humanFileSize(stream.downloaded)} /{" "}
                    {humanFileSize(stream.total)}
                  </span>
                </div>
                <div class="download-queue-item-actions">
                  <Show
                    when={
                      stream.status === "active" &&
                      stream.canPause &&
                      !isLocked(stream)
                    }
                  >
                    <button
                      type="button"
                      class="download-queue-action"
                      onClick={() => void pauseStream(stream.id)}
                    >
                      {locale.get("DOWNLOAD_PAUSE")}
                    </button>
                  </Show>
                  <Show
                    when={
                      (stream.status === "paused" ||
                        stream.status === "queued") &&
                      stream.canResume &&
                      !isLocked(stream)
                    }
                  >
                    <button
                      type="button"
                      class="download-queue-action"
                      onClick={() => void resumeStream(stream.id)}
                    >
                      {locale.get("DOWNLOAD_RESUME")}
                    </button>
                  </Show>
                  <Show when={stream.canCancel && !isLocked(stream)}>
                    <button
                      type="button"
                      class="download-queue-action download-queue-action--cancel"
                      onClick={() => void cancelStream(stream.id)}
                    >
                      {locale.get("CANCEL_DOWNLOAD")}
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </AppModal>
  );
}
