import { CommonUpdateProgram } from "@common-update-ui";
import { isDownloadCancelledError } from "../download-control";
import { Locale, LocaleTextKey } from "@locale";
import { fatal, log, logerror } from "@utils";
import { createSignal } from "solid-js";

const SKIP_LOG_STATE_KEYS = new Set(["DOWNLOADING_ENVIRONMENT_SPEED"]);

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

  const taskQueue: AsyncGenerator<unknown, void, () => CommonUpdateProgram> =
    (async function* () {
      while (true) {
        const task = yield 0;
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
            }
          }
          await log("Task completed");
        } catch (e) {
          onStateKey?.(null);
          if (isDownloadCancelledError(e)) {
            await log("Task cancelled");
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
