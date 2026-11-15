import {
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  Text,
} from "@hope-ui/solid";
import { createResource, createSignal, Show } from "solid-js";
import type { Locale } from "@locale";
import { openDir } from "@platform/neutralino";
import type { Storage } from "@runtime/storage";
import {
  readSophonPredownloadDirectory,
  saveSophonPredownloadDirectory,
} from "../../../integrations/sophon-settings";
import { sophonDownloaderText } from "../../../locale/sophon-downloader";

export function SophonPredownloadDirectory(props: {
  locale: Locale;
  storage: Storage;
}) {
  const text = () => sophonDownloaderText(props.locale.currentLanguage);
  const [directory, { mutate }] = createResource(() =>
    readSophonPredownloadDirectory(props.storage)
  );
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const disabled = () => directory.loading || pending();

  async function changeDirectory(choose: () => Promise<string | undefined>) {
    if (disabled()) return;
    setPending(true);
    setError("");
    try {
      const next = await choose();
      if (next === undefined) return;
      await saveSophonPredownloadDirectory(props.storage, next);
      mutate(next);
    } catch (error) {
      setError(String(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormControl id="sophon-predownload-directory">
      <FormLabel>{text().directory}</FormLabel>
      <Input
        readOnly
        value={directory() ?? ""}
        placeholder={text().gameDirectory}
      />
      <HStack spacing="$2" mt="$2" flexWrap="wrap">
        <Button
          type="button"
          size="sm"
          disabled={disabled()}
          onClick={() =>
            void changeDirectory(
              async () => (await openDir(text().chooseDirectory)) || undefined
            )
          }
        >
          {text().browse}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="subtle"
          disabled={disabled() || !directory()}
          onClick={() => void changeDirectory(async () => "")}
        >
          {text().useDefault}
        </Button>
      </HStack>
      <FormHelperText>{text().directoryHelp}</FormHelperText>
      <Show when={error()}>
        <Text size="sm" color="$danger11" role="alert">
          {error()}
        </Text>
      </Show>
    </FormControl>
  );
}
