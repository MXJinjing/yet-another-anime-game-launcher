import {
  FormControl,
  FormLabel,
  Box,
  Checkbox,
  Button,
} from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey, exec, resolve } from "@utils";
import { Config } from "./config-def";

declare module "./config-def" {
  interface Config {
    reshade: boolean;
  }
}

const CONFIG_KEY = "config_reshade";

export default async function ({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.reshade = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.reshade = false; // default value
  }

  const [value, setValue] = createSignal(config.reshade);

  async function onSave(apply: boolean) {
    assertValueDefined(config.reshade);
    if (!apply) {
      setValue(config.reshade);
      return;
    }
    if (config.reshade == value()) return;
    config.reshade = value();
    await setKey(CONFIG_KEY, config.reshade ? "true" : "false");
    return;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI(opts?: { disabled?: boolean }) {
      const disabled = opts?.disabled ?? !config.advancedEnable;

      async function openShadersFolder() {
        try {
          const shadersDir = resolve("./reshade/Shaders");
          // Ensure the directory exists before opening
          await exec(["mkdir", "-p", shadersDir], {}, false, "/dev/null");
          await exec(["open", shadersDir], {}, false, "/dev/null");
        } catch {
          // ignore errors when opening folder
        }
      }

      return (
        <FormControl>
          <FormLabel>ReShade</FormLabel>
          <Box>
            <Checkbox
              checked={value()}
              onChange={() => setValue((x) => !x)}
              size="md"
              disabled={disabled}
            >
              {locale.get("SETTING_ENABLED")}
            </Checkbox>
          </Box>
          <Box mt="$2">
            <Button
              size="sm"
              variant="ghost"
              onClick={openShadersFolder}
            >
              {locale.get("SETTING_OPEN_SHADERS_FOLDER")}
            </Button>
          </Box>
        </FormControl>
      );
    },
  ] as const;
}