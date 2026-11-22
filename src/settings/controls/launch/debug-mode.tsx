import { createSignal } from "solid-js";
import { SettingSwitch } from "../../../components/setting-switch";
import { Locale } from "@locale";
import { configEntries, type ConfigStore } from "@config";

/**
 * Debug mode toggle shown in the game settings' "Launch" tab.
 *
 * When enabled, launching a game opens its logs in the launcher's log window.
 * The preference is stored globally and stays active in release builds.
 */
export async function createDebugModeConfig({
  locale,
  store,
}: {
  locale: Locale;
  store: ConfigStore;
}) {
  const initial = (await store.read(configEntries.debugMode)) ?? false;
  const [value, setValue] = createSignal(initial);

  function onSave(next: boolean) {
    setValue(next);
    void store.write(configEntries.debugMode, next);
  }

  return [
    function UI() {
      const label = locale.currentLanguage.startsWith("zh")
        ? "调试模式"
        : "Debug mode";
      const description = locale.currentLanguage.startsWith("zh")
        ? "启动游戏时，在启动器的日志界面打开游戏日志。"
        : "Open the game logs in the launcher's log window when starting the game.";
      return (
        <SettingSwitch
          id="debugMode"
          label={label}
          description={description}
          checked={value()}
          onChange={onSave}
        />
      );
    },
  ] as const;
}
