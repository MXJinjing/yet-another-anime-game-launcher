import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { CURRENT_YAAGL_VERSION } from "../../../constants";
import { configEntries, type ConfigStore } from "@config";
import { Config, NOOP } from "../../../config/config-def";
import { assertValueDefined } from "../../../runtime/assertions";
import { SettingSwitch } from "../../../components/setting-switch";
import "./auto-update.css";

declare module "../../../config/config-def" {
  interface Config {
    autoUpdateEnabled: boolean;
  }
}

export async function createAutoUpdateConfig({
  config,
  locale,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.autoUpdateEnabled =
      (await store.read(configEntries.autoUpdateEnabled)) ?? true;
  } catch {
    config.autoUpdateEnabled = true;
  }

  const [value, setValue] = createSignal(config.autoUpdateEnabled);
  const isDevelopment = CURRENT_YAAGL_VERSION === "development";

  async function onSave() {
    assertValueDefined(config.autoUpdateEnabled);
    if (config.autoUpdateEnabled == value()) return NOOP;
    config.autoUpdateEnabled = value();
    await store.write(
      configEntries.autoUpdateEnabled,
      config.autoUpdateEnabled
    );
    return NOOP;
  }

  createEffect(() => {
    value();
    void onSave();
  });

  return [
    function UI() {
      return (
        <SettingSwitch
          id="autoUpdate"
          label={locale.get("SETTING_AUTO_UPDATE")}
          control={
            isDevelopment ? (
              <span
                class="auto-update-warning"
                data-tooltip={locale.get("SETTING_AUTO_UPDATE_DEV_TOOLTIP")}
                aria-label={locale.get("SETTING_AUTO_UPDATE_DEV_TOOLTIP")}
                tabIndex={0}
              >
                !
              </span>
            ) : undefined
          }
          checked={!isDevelopment && value()}
          disabled={isDevelopment}
          onChange={setValue}
        />
      );
    },
  ] as const;
}
