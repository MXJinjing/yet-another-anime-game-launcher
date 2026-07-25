import { FormControl, FormLabel, Box, Checkbox } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config } from "./config-def";

declare module "./config-def" {
  interface Config {
    vsyncDisable: boolean;
  }
}

const CONFIG_KEY = "config_vsync_disable";

export default async function ({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.vsyncDisable = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.vsyncDisable = false;
  }

  const [value, setValue] = createSignal(config.vsyncDisable);

  async function onSave(apply: boolean) {
    assertValueDefined(config.vsyncDisable);
    if (!apply) {
      setValue(config.vsyncDisable);
      return;
    }
    if (config.vsyncDisable == value()) return;
    config.vsyncDisable = value();
    await setKey(CONFIG_KEY, config.vsyncDisable ? "true" : "false");
    return;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl>
          <FormLabel>{locale.get("SETTING_VSYNC_DISABLE")}</FormLabel>
          <Box>
            <Checkbox
              checked={value()}
              onChange={() => setValue(x => !x)}
              size="md"
            >
              {locale.get("SETTING_ENABLED")}
            </Checkbox>
          </Box>
        </FormControl>
      );
    },
  ] as const;
}
