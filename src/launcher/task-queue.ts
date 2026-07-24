import { CommonUpdateProgram } from "@common-update-ui";
import {
  isDownloadCancelledError,
  isDownloadFailedError,
} from "../download-control";
import { Locale, LocaleTextKey } from "@locale";
import { fatal, log, logerror } from "@utils";
import { createSignal } from "solid-js";
import { notificationService } from "@hope-ui/solid";

const SKIP_LOG_STATE_KEYS = new Set(["DOWNLOADING_ENVIRONMENT_SPEED"]);

type TaskEntry = {
  fn: () => CommonUpdateProgram;
  name?: LocaleTextKey;
};

export function createTaskQueueState({
  locale,
  onStateKey,
}: {
  locale: Locale;
  onStateKey?: (key: LocaleTextKey | null) => void;
}) {
  const [statusText, setStatusText] = createSignal("");
  const [progress, setProgress] = createSignal(0);
  const [programBusy, setBusy] = createSignal(false);

  const taskQueue: AsyncGenerator<unknown, void, TaskEntry> =
    (async function* () {
      while (true) {
        const entry = yield undefined!;
        const { fn: task, name: taskName } = entry;
        setBusy(true);
        await log("Task started");
        try {
          for await (const text of task()) {
            switch (text[0]) {
              case "setProgress":
                setProgress(text[1]);
                break;
              case "setUndeterminedProgress":
                setProgress(0);
                break;
              case "setStateText":
                onStateKey?.(text[1]);
                setStatusText(locale.format(text[1], text.slice(2)));
                if (!SKIP_LOG_STATE_KEYS.has(text[1])) {
                  await log(locale.format(text[1], text.slice(2)));
                }
                break;
              case "setRawStateText":
                onStateKey?.(null);
                setStatusText(text[1]);
                await log(text[1]);
                break;
            }
          }
          await log("Task completed");
          if (taskName) {
            notificationService.show({
              status: "success",
              title: locale.get(taskName),
              description: "已完成",
            });
          }
        } catch (e) {
          onStateKey?.(null);
          if (isDownloadCancelledError(e)) {
            await log("Task cancelled");
            if (taskName) {
              notificationService.show({
                status: "warning",
                title: locale.get(taskName),
                description: "已取消",
              });
            }
            setBusy(false);
            continue;
          }
          if (isDownloadFailedError(e)) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            await logerror(errorMessage);
            if (taskName) {
              notificationService.show({
                status: "danger",
                title: locale.get(taskName),
                description: `已失败 — ${errorMessage}`,
              });
            } else {
              notificationService.show({
                status: "danger",
                title: "Download failed",
                description: errorMessage,
              });
            }
            setBusy(false);
            continue;
          }
          await logerror(e instanceof Error ? e.message : String(e));
          // fatal
          await fatal(e);
          return;
        }
        onStateKey?.(null);
        setBusy(false);
      }
    })();
  taskQueue.next(); // ignored anyway

  return [statusText, progress, programBusy, taskQueue] as const;
}