import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config, NOOP } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    metalHud: boolean;
  }
}

export async function createMetalHUDConfig({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.metalHud = (await store.read(configEntries.metalHud)) ?? false;
  } catch {
    config.metalHud = false; // default value
  }

  const [value, setValue] = createSignal(config.metalHud);

  async function onSave(apply: boolean) {
    assertValueDefined(config.metalHud);
    if (!apply) {
      setValue(config.metalHud);
      return NOOP;
    }
    if (config.metalHud == value()) return NOOP;
    config.metalHud = value();
    await store.write(configEntries.metalHud, config.metalHud);
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      const label = locale.currentLanguage.startsWith("zh")
        ? "启用 Metal HUD"
        : "Enable Metal HUD";
      return (
        <SettingSwitch
          id="metalHud"
          label={label}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
