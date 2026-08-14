import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { SettingSwitch } from "../components/setting-switch";
import { Config, NOOP } from "./config-def";

declare module "./config-def" {
  interface Config {
    disableVideoBackground: boolean;
  }
}

export const VIDEO_BACKGROUND_DISABLED_KEY = "config_disable_video_background";

export async function createDisableVideoBackgroundConfig({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.disableVideoBackground =
      (await getKey(VIDEO_BACKGROUND_DISABLED_KEY)) == "true";
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
    await setKey(
      VIDEO_BACKGROUND_DISABLED_KEY,
      config.disableVideoBackground ? "true" : "false"
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
