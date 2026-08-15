import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config, NOOP } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    disableVideoBackground: boolean;
  }
}

export const VIDEO_BACKGROUND_DISABLED_KEY =
  configEntries.disableVideoBackground.key;

export async function createDisableVideoBackgroundConfig({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.disableVideoBackground =
      (await store.read(configEntries.disableVideoBackground)) ?? false;
  } catch {
    config.disableVideoBackground = false; // default: video backgrounds enabled
  }

  const [value, setValue] = createSignal(config.disableVideoBackground);

  async function onSave(apply: boolean) {
    assertValueDefined(config.disableVideoBackground);
    if (!apply) {
      setValue(config.disableVideoBackground);
      return NOOP;
    }
    if (config.disableVideoBackground == value()) return NOOP;
    config.disableVideoBackground = value();
    await store.write(
      configEntries.disableVideoBackground,
      config.disableVideoBackground
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
          id="disableVideoBackground"
          label={locale.get("SETTING_DISABLE_VIDEO_BACKGROUND")}
          description={locale.get("SETTING_DISABLE_VIDEO_BACKGROUND_DESC")}
          checked={value()}
          onChange={setValue}
        />
      );
    },
    () => value(),
  ] as const;
}
