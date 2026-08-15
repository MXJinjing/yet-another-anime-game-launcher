import { createSignal } from "solid-js";
import { SettingSwitch } from "../../../components/setting-switch";
import { Locale } from "@locale";
import { configEntries, type ConfigStore } from "@config";

/**
 * Debug mode toggle shown in the game settings' "Launch" tab.
 *
 * When enabled, launching a game auto-opens the launcher log viewer and
 * streams the game's Unity log (`output_log.txt` inside the Wine prefix) in
 * real time so startup problems are visible immediately. The preference is
 * stored globally (`config_debug_mode` is not namespaced), so it applies to
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
        ? "启动游戏时自动打开日志窗口，实时显示游戏的 Unity 日志（output_log.txt），便于排查启动问题。"
        : "Auto-open the log viewer when launching and stream the game's Unity log (output_log.txt) live for troubleshooting.";
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
