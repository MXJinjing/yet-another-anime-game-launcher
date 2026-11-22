import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config, NOOP } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    gameControllerFix?: boolean;
  }
}

export async function createGameControllerFixConfig({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.gameControllerFix =
      (await store.read(configEntries.gameControllerFix)) ?? false;
  } catch {
    config.gameControllerFix = false; // default value
  }

  const [value, setValue] = createSignal(config.gameControllerFix);

  async function onSave(apply: boolean) {
    assertValueDefined(config.gameControllerFix);
    if (!apply) {
      setValue(config.gameControllerFix);
      return NOOP;
    }
    if (config.gameControllerFix == value()) return NOOP;
    config.gameControllerFix = value();
    await store.write(
      configEntries.gameControllerFix,
      config.gameControllerFix
    );
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
          id="gameControllerFix"
          label={locale.get("SETTING_GAME_CONTROLLER_FIX")}
          description={locale.get("SETTING_GAME_CONTROLLER_FIX_DESC")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
