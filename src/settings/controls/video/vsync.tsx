import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    vsyncDisable: boolean;
  }
}

export default async function ({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.vsyncDisable =
      (await store.read(configEntries.vsyncDisable)) ?? false;
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
    await store.write(configEntries.vsyncDisable, config.vsyncDisable);
    return;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <SettingSwitch
          id="vsyncDisable"
          label={locale.get("SETTING_VSYNC_DISABLE")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
