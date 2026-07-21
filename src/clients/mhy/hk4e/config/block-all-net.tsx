import { FormControl, FormLabel, Box, Checkbox } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";

declare module "@config/config-def" {
  interface Config {
    blockAllNet: boolean;
  }
}

const CONFIG_KEY = "config_block_all_net";

export default async function ({
  locale,
  config,
}: {
  locale: Locale;
  config: Partial<Config>;
}) {
  try {
    config.blockAllNet = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.blockAllNet = false; // default value
  }

  const [value, setValue] = createSignal(config.blockAllNet);

  async function onSave(apply: boolean) {
    assertValueDefined(config.blockAllNet);
    if (!apply) {
      setValue(config.blockAllNet);
      return NOOP;
    }
    if (config.blockAllNet == value()) return NOOP;
    config.blockAllNet = value();
    await setKey(CONFIG_KEY, config.blockAllNet ? "true" : "false");
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl id="blockAllNet">
          <FormLabel>{locale.get("SETTING_BLOCK_ALL_NET")}</FormLabel>
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
