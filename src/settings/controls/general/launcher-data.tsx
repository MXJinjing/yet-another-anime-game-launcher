import { Button, FormControl, FormLabel, HStack, Text } from "@hope-ui/solid";
import { createSignal, onMount, Show } from "solid-js";
import type { Locale } from "@locale";
import {
  clearLauncherData,
  getLauncherDataDirectory,
  openLauncherDataDirectory,
} from "@services/launcher-data";

export function LauncherDataControl(props: {
  locale: Locale;
  isBusy: () => boolean;
  gameDirectories: () => readonly string[];
}) {
  const [directory, setDirectory] = createSignal<string>();
  const [working, setWorking] = createSignal(false);
  const [error, setError] = createSignal("");
  const { locale } = props;

  onMount(async () => {
    try {
      setDirectory(await getLauncherDataDirectory());
    } catch (cause) {
      setError(String(cause));
    }
  });

  async function run(action: () => Promise<void>) {
    if (working()) return;
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  }

  async function confirmCleanup(path: string) {
    if (props.isBusy()) return;
    const confirmed = await locale.prompt(
      "SETTING_CLEAR_LAUNCHER_DATA",
      "SETTING_CLEAR_LAUNCHER_DATA_CONFIRM",
      [path]
    );
    if (confirmed) {
      await clearLauncherData(path, props.gameDirectories(), props.isBusy);
    }
  }

  return (
    <FormControl w="100%">
      <FormLabel>{locale.get("SETTING_LAUNCHER_DATA")}</FormLabel>
      <Show
        when={directory()}
        fallback={
          <Text size="xs" color="$neutral11">
            {locale.get("SETTING_LAUNCHER_DATA_UNAVAILABLE")}
          </Text>
        }
      >
        {path => (
          <>
            <Text
              size="xs"
              color="$neutral11"
              userSelect="text"
              style={{ "overflow-wrap": "anywhere" }}
            >
              {path()}
            </Text>
            <HStack mt="$2" spacing="$2" flexWrap="wrap">
              <Button
                size="xs"
                variant="ghost"
                disabled={working()}
                onClick={() => run(() => openLauncherDataDirectory(path()))}
              >
                {locale.get("SETTING_OPEN_LAUNCHER_DATA_IN_FINDER")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                colorScheme="danger"
                disabled={working() || props.isBusy()}
                onClick={() => run(() => confirmCleanup(path()))}
              >
                {locale.get("SETTING_CLEAR_LAUNCHER_DATA")}
              </Button>
            </HStack>
          </>
        )}
      </Show>
      <Show when={error()}>
        <Text
          size="xs"
          color="$danger10"
          role="alert"
          style={{ "overflow-wrap": "anywhere" }}
        >
          {error()}
        </Text>
      </Show>
    </FormControl>
  );
}
