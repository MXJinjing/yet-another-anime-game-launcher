import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { SettingSwitch } from "../components/setting-switch";
import { Config, NOOP } from "./config-def";

declare module "./config-def" {
  interface Config {
    metalHud: boolean;
  }
}

export async function createMetalHUDConfig({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.metalHud = (await getKey("config_metalHud")) == "true";
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
    await setKey("config_metalHud", config.metalHud ? "true" : "false");
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
          id="metalHud"
          label={locale.get("SETTING_MTL_HUD")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
