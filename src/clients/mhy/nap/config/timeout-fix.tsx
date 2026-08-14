import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";

declare module "@config/config-def" {
  interface Config {
    timeoutFix: boolean;
  }
}

const CONFIG_KEY = "config_timeout_fix";

export default async function ({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.timeoutFix = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.timeoutFix = false; // default value
  }

  const [value, setValue] = createSignal(config.timeoutFix);

  async function onSave(apply: boolean) {
    assertValueDefined(config.timeoutFix);
    if (!apply) {
      setValue(config.timeoutFix);
      return NOOP;
    }
    if (config.timeoutFix == value()) return NOOP;
    config.timeoutFix = value();
    await setKey(CONFIG_KEY, config.timeoutFix ? "true" : "false");
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      const description = locale.currentLanguage.startsWith("zh")
        ? "启用 Wine 超时绕过，缓解启动或网络连接超时问题。"
        : "Enable Wine timeout bypass to reduce startup or network timeout issues.";
      return (
        <SettingSwitch
          id="timeoutFix"
          label={locale.get("SETTING_TIMEOUT_FIX")}
          description={description}
          checked={value()}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
