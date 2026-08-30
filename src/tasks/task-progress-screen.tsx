import { Box, Button, Center, Image, VStack } from "@hope-ui/solid";
import { createSignal, onMount, Show } from "solid-js";
import {
  isDownloadCancelledError,
  isDownloadFailedError,
} from "../download/control";
import { createLogViewer } from "../modals/log-viewer-modal";
import { type Locale } from "@locale";
import { log, logerror } from "../logging/logger";
import { fatal } from "../runtime/fatal";
import {
  downloadPercent,
  formatDownloadSpeed,
  humanFileSize,
} from "@runtime/format";
import { isConnectionError } from "../services/connection-error";
import { isAuthorizationCancelledError } from "../runtime/authorization";
import {
  isTaskFailedError,
  type TaskDownloadStats,
  type TaskProgram,
} from "./task-program";

const SKIP_LOG_STATE_KEYS = new Set(["DOWNLOADING_ENVIRONMENT_SPEED"]);

export type TaskProgressScreenOptions = {
  locale: Locale;
  program: () => TaskProgram;
  /** The image is supplied by the composition root, never by a client import. */
  image?: string;
  /** Called after a successfully completed task is acknowledged by the user. */
  onCompleted?: () => Promise<void> | void;
  /** Optional restart action supplied by the composition root. */
  onRestart?: () => Promise<void> | void;
  /** Called after a recoverable download failure has been reported. */
  onFailed?: (error: unknown) => Promise<void> | void;
  /** Called once the task program has settled (completed, cancelled, or failed). */
  onSettled?: () => Promise<void> | void;
  /** Triggered when the user presses the cancel button. */
  onCancel?: () => Promise<void> | void;
  /** Called after the user cancels the running task. */
  onCancelled?: () => Promise<void> | void;
};

/** A reusable full-screen progress surface for a TaskProgram. */
export function createTaskProgressScreen({
  locale,
  program,
  image,
  onCompleted,
  onRestart,
  onFailed,
  onSettled,
  onCancel,
  onCancelled,
}: TaskProgressScreenOptions) {
  let confirmCompletion: (() => void) | undefined;
  const confirmation = new Promise<void>(resolve => {
    confirmCompletion = resolve;
  });

  return function TaskProgressScreen() {
    const [progress, setProgress] = createSignal(0);
    const [statusText, setStatusText] = createSignal("");
    const [downloadStats, setDownloadStats] =
      createSignal<TaskDownloadStats | null>(null);
    const [done, setDone] = createSignal(false);
    const { LogViewer, openLogs } = createLogViewer(locale);

    onMount(() => {
      void (async () => {
        try {
          await log("Task started");
          for await (const command of program()) {
            switch (command[0]) {
              case "setProgress":
                setProgress(command[1]);
                break;
              case "setUndeterminedProgress":
                setProgress(0);
                break;
              case "setStateText": {
                const [_, key, ...args] = command;
                const text = locale.format(key, args);
                setStatusText(text);
                if (!SKIP_LOG_STATE_KEYS.has(key)) await log(text);
                break;
              }
              case "setRawStateText":
                setStatusText(command[1]);
                await log(command[1]);
                break;
              case "setDownloadStats":
                setDownloadStats(command[1]);
                break;
            }
          }
          await log("Task completed");
          setDone(true);
          await onSettled?.();
          await confirmation;
          await onCompleted?.();
          await onRestart?.();
        } catch (error) {
          if (isAuthorizationCancelledError(error)) {
            await logerror(
              error instanceof Error ? error.message : String(error)
            );
            await locale.alert(
              "NOTIFICATION_TASK_FAILED_TITLE",
              "NOTIFICATION_AUTHORIZATION_CANCELLED",
              [],
              "danger"
            );
            await onSettled?.();
            await onFailed?.(error);
            return;
          }
          if (isDownloadCancelledError(error)) {
            await log("Task cancelled");
            setDone(true);
            await onSettled?.();
            await onCancelled?.();
            return;
          }
          if (
            isTaskFailedError(error) ||
            isDownloadFailedError(error) ||
            isConnectionError(error)
          ) {
            await logerror(
              error instanceof Error ? error.message : String(error)
            );
            await locale.alert(
              "NOTIFICATION_TASK_FAILED_TITLE",
              "NOTIFICATION_TASK_FAILED",
              [],
              "danger"
            );
            await onSettled?.();
            await onFailed?.(error);
            return;
          }
          await logerror(
            error instanceof Error ? error.message : String(error)
          );
          await onSettled?.();
          await fatal(error);
        }
      })();
    });

    return (
      <Center h="100vh" w="100vw" style="background:#08090d">
        <VStack alignItems="stretch" spacing="$8" w="80vw">
          <Show when={image}>
            <Center>
              <Image boxSize={280} src={image}></Image>
            </Center>
          </Show>
          <h1
            onClick={openLogs}
            title={locale.get("LOG_VIEWER_OPEN_HINT")}
            style="text-align: center; cursor: pointer; color: white"
          >
            {statusText()}
          </h1>
          <Box height={180}>
            <Show
              when={!done()}
              fallback={
                <Center>
                  <Button onClick={() => confirmCompletion?.()}>
                    {locale.get("RESTART_TO_INSTALL")}
                  </Button>
                </Center>
              }
            >
              <VStack alignItems="stretch" spacing="$4">
                <Center>
                  <Box fontSize="26px" fontWeight="800" color="white">
                    {progress() > 0
                      ? `${Math.round(progress())}%`
                      : locale.get("PROCESSING")}
                  </Box>
                </Center>
                <Show when={downloadStats()} keyed>
                  {stats => (
                    <Center>
                      <VStack spacing="$1" alignItems="center">
                        <Show when={stats.fileName}>
                          <Box
                            fontSize="14px"
                            color="rgba(255, 255, 255, 0.85)"
                          >
                            {locale.get("DOWNLOAD_FILE")}: {stats.fileName}
                          </Box>
                        </Show>
                        <Box fontSize="14px" color="rgba(255, 255, 255, 0.85)">
                          {locale.get("DOWNLOAD_SPEED")}:{" "}
                          {formatDownloadSpeed(stats.speed)}
                        </Box>
                        <Box fontSize="14px" color="rgba(255, 255, 255, 0.85)">
                          {locale.get("DOWNLOADED")}:{" "}
                          {humanFileSize(stats.downloaded)} /{" "}
                          {humanFileSize(stats.total)}
                        </Box>
                        <Box fontSize="14px" color="rgba(255, 255, 255, 0.85)">
                          {locale.get("PROGRESS")}:{" "}
                          {downloadPercent(stats.downloaded, stats.total)}
                        </Box>
                      </VStack>
                    </Center>
                  )}
                </Show>
              </VStack>
            </Show>
          </Box>
          <Show when={!done()}>
            <Center>
              <Button
                variant="outline"
                colorScheme="danger"
                onClick={() => void onCancel?.()}
              >
                {locale.get("CANCEL_UPDATE")}
              </Button>
            </Center>
          </Show>
          <LogViewer />
        </VStack>
      </Center>
    );
  };
}
