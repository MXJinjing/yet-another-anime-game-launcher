import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";

declare module "@config/config-def" {
  interface Config {
    blockNet: boolean;
  }
}

const CONFIG_KEY = "config_block_net";

export default async function ({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.blockNet = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.blockNet = false; // default value
  }

  const [value, setValue] = createSignal(config.blockNet);

  async function onSave(apply: boolean) {
    assertValueDefined(config.blockNet);
    if (!apply) {
      setValue(config.blockNet);
      return NOOP;
    }
    if (config.blockNet == value()) return NOOP;
    config.blockNet = value();
    await setKey(CONFIG_KEY, config.blockNet ? "true" : "false");
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <SettingSwitch
          id="blockNet"
          label={locale.get("SETTING_BLOCK_NET")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
