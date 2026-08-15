import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config, NOOP } from "../../../config/config-def";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";

declare module "../../../config/config-def" {
  interface Config {
    proxyEnabled: boolean;
  }
}

export async function createProxyEnabledConfig({
  config,
  locale,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.proxyEnabled =
      (await store.read(configEntries.proxyEnabled)) ?? false;
  } catch {
    config.proxyEnabled = false; // default value
  }

  const [value, setValue] = createSignal(config.proxyEnabled);

  async function onSave(apply: boolean) {
    assertValueDefined(config.proxyEnabled);
    if (!apply) {
      setValue(config.proxyEnabled);
      return NOOP;
    }
    if (config.proxyEnabled == value()) return NOOP;
    config.proxyEnabled = value();
    await store.write(configEntries.proxyEnabled, config.proxyEnabled);
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
          id="proxyEnabled"
          label={locale.get("SETTING_PROXY_ENABLED")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
    value,
  ] as const;
}
