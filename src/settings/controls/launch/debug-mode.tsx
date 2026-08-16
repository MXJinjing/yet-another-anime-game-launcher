import { createSignal } from "solid-js";
import { SettingSwitch } from "../../../components/setting-switch";
import { Locale } from "@locale";
import { configEntries, type ConfigStore } from "@config";

/**
 * Debug mode toggle shown in the game settings' "Launch" tab.
 *
 * When enabled, launching a game opens the game's configured runtime/error log
 * file directly. The preference is stored globally
 * (`config_debug_mode` is not namespaced), so it applies to
 * every game and stays active in release builds.
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
        ? "显示游戏的实时日志以便调试。"
        : "Open the game's configured runtime log file when launching for troubleshooting.";
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
