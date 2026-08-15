import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config, NOOP } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    leftCmd: boolean;
  }
}

export async function createLeftCmdConfig({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.leftCmd = (await store.read(configEntries.leftCmd)) ?? false;
  } catch {
    config.leftCmd = false; // default value
  }

  const [value, setValue] = createSignal(config.leftCmd);

  async function onSave(apply: boolean) {
    assertValueDefined(config.leftCmd);
    if (!apply) {
      setValue(config.leftCmd);
      return NOOP;
    }
    if (config.leftCmd == value()) return NOOP;
    config.leftCmd = value();
    await store.write(configEntries.leftCmd, config.leftCmd);
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
          id="leftCmd"
          label={locale.get("SETTING_LEFT_CMD")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
