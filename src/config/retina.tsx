import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { SettingSwitch } from "../components/setting-switch";
import { Config, NOOP } from "./config-def";

declare module "./config-def" {
  interface Config {
    retina: boolean;
  }
}

export async function createRetinaConfig({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.retina = (await getKey("config_retina")) == "true";
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
    await setKey("config_retina", config.retina ? "true" : "false");
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
