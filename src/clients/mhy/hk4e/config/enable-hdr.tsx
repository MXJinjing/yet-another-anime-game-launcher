import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "@runtime/assertions";
import { getKey, setKey } from "@runtime/storage";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";

declare module "@config/config-def" {
  interface Config {
    hk4eEnableHDR: boolean;
  }
}

const CONFIG_KEY = "config_hk4e_enable_hdr";

export async function createEnableHDRConfig({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.hk4eEnableHDR = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.hk4eEnableHDR = false;
  }

  const [value, setValue] = createSignal(config.hk4eEnableHDR);

  async function onSave(apply: boolean) {
    assertValueDefined(config.hk4eEnableHDR);
    if (!apply) {
      setValue(config.hk4eEnableHDR);
      return NOOP;
    }
    if (config.hk4eEnableHDR == value()) return NOOP;
    config.hk4eEnableHDR = value();
    await setKey(CONFIG_KEY, config.hk4eEnableHDR ? "true" : "false");
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
          id="hk4eEnableHDR"
          label={locale.get("SETTING_ENABLE_HDR")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
