import { Button, Progress, ProgressIndicator, Center } from "@hope-ui/solid";
import { Box, VStack, Image } from "@hope-ui/solid";
import { createSignal, onMount, Show } from "solid-js";
import { fatal, _safeRelaunch } from "./utils";
import { log, logerror } from "./utils";
import { Locale, LocaleTextKey } from "./locale";
import { UPDATE_UI_IMAGE } from "./clients";
import { createLogViewer } from "./log-viewer";
import { isDownloadCancelledError } from "./download-control";

const SKIP_LOG_STATE_KEYS = new Set(["DOWNLOADING_ENVIRONMENT_SPEED"]);

export function createCommonUpdateUI(
  locale: Locale,
  program: () => CommonUpdateProgram
) {
  let confirmRestart: (v: unknown) => void;
  const confirmRestartPromise = new Promise(res => {
    confirmRestart = res;
  });
  return function CommonUpdateUI() {
    const [progress, setProgress] = createSignal(0);
    const [statusText, setStatusText] = createSignal("");
    const [done, setDone] = createSignal(false);
    const { LogViewer, openLogs } = createLogViewer(locale);

    onMount(() => {
      (async () => {
        await log("Task started");
        for await (const text of program()) {
          switch (text[0]) {
            case "setProgress":
              setProgress(text[1]);
              break;
            case "setUndeterminedProgress":
              setProgress(0);
              break;
            case "setStateText":
              setStatusText(locale.format(text[1], text.slice(2)));
              if (!SKIP_LOG_STATE_KEYS.has(text[1])) {
                await log(locale.format(text[1], text.slice(2)));
              }
              break;
            case "setRawStateText":
              setStatusText(text[1]);
              await log(text[1]);
              break;
          }
        }
        await log("Task completed");
        setDone(true);
        await confirmRestartPromise;
        await _safeRelaunch();
      })()
        .then()
        .catch(async e => {
          if (isDownloadCancelledError(e)) {
            await log("Task cancelled");
            setDone(true);
            return;
          }
          await logerror(e instanceof Error ? e.message : String(e));
          await fatal(e);
        });
    });

    return (
      <Center h="100vh" w="100vw">
        <VStack alignItems="stretch" spacing="$8" w="80vw">
          <Center>
            <Image boxSize={280} src={UPDATE_UI_IMAGE}></Image>
          </Center>
          <h1
            onClick={openLogs}
            title={locale.get("LOG_VIEWER_OPEN_HINT")}
            style="text-align: center; cursor: pointer"
          >
            {statusText()}
          </h1>
          <Box height={100}>
            <Show
              when={!done()}
              fallback={
                <Center>
                  <Button onClick={confirmRestart}>
                    {locale.get("RESTART_TO_INSTALL")}
                  </Button>
                </Center>
              }
            >
              <Box
                role="button"
                title={locale.get("LOG_VIEWER_OPEN_HINT")}
                onClick={openLogs}
              >
                <Progress value={progress()} indeterminate={progress() == 0}>
                  <ProgressIndicator animated striped />
                </Progress>
              </Box>
            </Show>
          </Box>
        </VStack>
        <LogViewer />
      </Center>
    );
  };
}

export type CommonUpdateProgram<Ret = void> = AsyncGenerator<
  CommonProgressUICommand,
  Ret
>;

export type CommonProgressUICommand =
  | ["setProgress", number]
  | ["setStateText", LocaleTextKey, ...string[]]
  | ["setRawStateText", string]
  | ["setUndeterminedProgress"];
