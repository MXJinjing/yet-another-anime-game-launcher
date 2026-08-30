import { Switch } from "@hope-ui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
} from "solid-js";
import { AppModal, AppModalButton } from "../components/app-modal";
import { Locale } from "../locale";
import { getRuntimeLogFilePath } from "../logging/log-file";
import { RuntimeLogEntry, subscribeRuntimeLogs } from "../logging/runtime-log";
import { exec2 } from "../runtime/command-runner";
import "./log-viewer.css";

export function createLogViewer(locale: Locale) {
  const [opened, setOpened] = createSignal(false);
  const [entries, setEntries] = createSignal<RuntimeLogEntry[]>([]);
  const [followScroll, setFollowScroll] = createSignal(true);
  let logContainer: HTMLDivElement | undefined;

  const unsubscribe = subscribeRuntimeLogs(setEntries);
  onCleanup(unsubscribe);

  const formattedEntries = createMemo(() =>
    entries().map(entry => ({
      ...entry,
      text: `[${entry.time}] [${entry.level}] ${entry.message}`,
    }))
  );

  createEffect(() => {
    formattedEntries();
    if (!opened() || !followScroll()) return;
    queueMicrotask(() => {
      if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    });
  });

  function copyLogs() {
    return Neutralino.clipboard.writeText(
      formattedEntries()
        .map(entry => entry.text)
        .join("\n")
    );
  }

  return {
    openLogs: () => setOpened(true),
    LogViewer() {
      return (
        <AppModal
          opened={opened()}
          onClose={() => setOpened(false)}
          title={locale.get("LOG_VIEWER_TITLE")}
          maxWidth={900}
          height={620}
          bodyClass="app-modal-body-logs"
          footer={
            <div class="log-viewer-footer">
              <Switch
                checked={followScroll()}
                size="md"
                onChange={() => setFollowScroll(x => !x)}
              >
                {locale.get("LOG_VIEWER_FOLLOW_SCROLL")}
              </Switch>
              <div class="log-viewer-actions">
                <AppModalButton
                  variant="secondary"
                  onClick={() => void copyLogs()}
                >
                  {locale.get("LOG_VIEWER_COPY")}
                </AppModalButton>
                <AppModalButton
                  variant="secondary"
                  onClick={() =>
                    void exec2(
                      ["open", getRuntimeLogFilePath()],
                      {},
                      false,
                      "/dev/null"
                    )
                  }
                >
                  {locale.get("LOG_VIEWER_OPEN_FILE")}
                </AppModalButton>
              </div>
            </div>
          }
        >
          <div class="log-viewer-shell">
            <div
              class="log-viewer-console"
              ref={logContainer}
              on:contextmenu={event => event.stopPropagation()}
            >
              <For
                each={formattedEntries()}
                fallback={
                  <div class="log-viewer-empty">
                    {locale.get("LOG_VIEWER_EMPTY")}
                  </div>
                }
              >
                {entry => (
                  <div class="log-viewer-line" data-level={entry.level}>
                    <span class="log-viewer-time">{entry.time}</span>
                    <span
                      class={`log-viewer-level log-viewer-level--${entry.level.toLowerCase()}`}
                    >
                      {entry.level}
                    </span>
                    <span class="log-viewer-message">{entry.message}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </AppModal>
      );
    },
  };
}
