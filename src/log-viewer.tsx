import {
  Box,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
} from "@hope-ui/solid";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
} from "solid-js";
import { Locale } from "./locale";
import { getRuntimeLogFilePath } from "./log-file";
import { RuntimeLogEntry, subscribeRuntimeLogs } from "./runtime-log";
import { exec2 } from "./utils";

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
        <Modal opened={opened()} onClose={() => setOpened(false)} size="xl">
          <ModalOverlay />
          <ModalContent maxWidth={900}>
            <ModalCloseButton />
            <ModalHeader>{locale.get("LOG_VIEWER_TITLE")}</ModalHeader>
            <ModalBody pb={20}>
              <Box
                ref={logContainer}
                height={420}
                overflowY="auto"
                bg="$neutral3"
                border="1px solid $neutral6"
                borderRadius={6}
                p={"$3"}
                fontFamily="monospace"
                fontSize={12}
                userSelect="text"
                style={{ "white-space": "pre-wrap", cursor: "text" }}
              >
                <For
                  each={formattedEntries()}
                  fallback={
                    <Text color="$neutral10">
                      {locale.get("LOG_VIEWER_EMPTY")}
                    </Text>
                  }
                >
                  {entry => (
                    <Box
                      userSelect="text"
                      color={
                        entry.level === "ERROR"
                          ? "$danger11"
                          : entry.level === "WARNING"
                          ? "$warning11"
                          : "$neutral12"
                      }
                    >
                      {entry.text}
                    </Box>
                  )}
                </For>
              </Box>
            </ModalBody>
            <ModalFooter justifyContent="space-between">
              <Checkbox
                checked={followScroll()}
                size="sm"
                onChange={() => setFollowScroll(x => !x)}
              >
                {locale.get("LOG_VIEWER_FOLLOW_SCROLL")}
              </Checkbox>
              <Box>
                <Button variant="ghost" size="sm" mr={"$2"} onClick={copyLogs}>
                  {locale.get("LOG_VIEWER_COPY")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    exec2(
                      ["open", getRuntimeLogFilePath()],
                      {},
                      false,
                      "/dev/null"
                    )
                  }
                >
                  {locale.get("LOG_VIEWER_OPEN_FILE")}
                </Button>
              </Box>
            </ModalFooter>
          </ModalContent>
        </Modal>
      );
    },
  };
}
