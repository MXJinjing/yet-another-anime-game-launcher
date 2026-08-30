import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "@runtime/assertions";
import { globalStorage, type Storage } from "@runtime/storage";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";

declare module "@config/config-def" {
  interface Config {
    patchOff: boolean;
  }
}

const CONFIG_KEY = "config_patch_off";

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
    config.patchOff = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.patchOff = false; // default value
  }

  const [value, setValue] = createSignal(config.patchOff);

  async function onSave(apply: boolean) {
    assertValueDefined(config.patchOff);
    if (!apply) {
      setValue(config.patchOff);
      return NOOP;
    }
    if (config.patchOff == value()) return NOOP;
    config.patchOff = value();
    await setKey(CONFIG_KEY, config.patchOff ? "true" : "false");
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      const description = locale.currentLanguage.startsWith("zh")
        ? "跳过游戏文件补丁，适合游戏补丁冲突或失效时使用。"
        : "Skip game file patching when it causes conflicts or fails.";
      return (
        <SettingSwitch
          id="patchOff"
          label={locale.get("SETTING_TURN_OFF_AC_PATCH")}
          description={description}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
