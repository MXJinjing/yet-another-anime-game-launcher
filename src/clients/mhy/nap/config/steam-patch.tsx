import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "@runtime/assertions";
import { globalStorage, type Storage } from "@runtime/storage";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";

declare module "@config/config-def" {
  interface Config {
    steamPatch: boolean;
  }
}

const CONFIG_KEY = "config_steam_patch";

export default async function ({
  locale,
  config,
  storage = globalStorage,
}: {
  config: Partial<Config>;
  locale: Locale;
  storage?: Storage;
}) {
  const { getKey, setKey } = storage;
  try {
    config.steamPatch = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.steamPatch = false; // default value
  }

  const [value, setValue] = createSignal(config.steamPatch);

  async function onSave(apply: boolean) {
    assertValueDefined(config.steamPatch);
    if (!apply) {
      setValue(config.steamPatch);
      return NOOP;
    }
    if (config.steamPatch == value()) return NOOP;
    config.steamPatch = value();
    await setKey(CONFIG_KEY, config.steamPatch ? "true" : "false");
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      const description = locale.currentLanguage.startsWith("zh")
        ? "通过 Steam 运行库启动游戏，解决部分启动器兼容问题。"
        : "Launch through Steam runtime libraries to work around compatibility issues.";
      return (
        <SettingSwitch
          id="steamPatch"
          label={locale.get("SETTING_TURN_ON_STEAM_PATCH")}
          description={description}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
