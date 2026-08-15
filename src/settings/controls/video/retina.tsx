import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config, NOOP } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    retina: boolean;
  }
}

export async function createRetinaConfig({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.retina = (await store.read(configEntries.retina)) ?? false;
  } catch {
    config.retina = false; // default value
  }

  const [value, setValue] = createSignal(config.retina);

  async function onSave(apply: boolean) {
    assertValueDefined(config.retina);
    if (!apply) {
      setValue(config.retina);
      return NOOP;
    }
    if (config.retina == value()) return NOOP;
    config.retina = value();
    await store.write(configEntries.retina, config.retina);
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
          id="retina"
          label={locale.get("SETTING_RETINA")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
