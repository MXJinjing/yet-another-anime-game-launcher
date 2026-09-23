import { createSignal } from "solid-js";
import { Locale } from "@locale";
import { configEntries, type ConfigStore } from "@config";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    exitOnWindowClose: boolean;
  }
}

export async function createExitOnWindowCloseConfig({
  locale,
  config,
  store,
}: {
  locale: Locale;
  config: Partial<Config>;
  store: ConfigStore;
}) {
  config.exitOnWindowClose =
    (await store.read(configEntries.exitOnWindowClose)) ?? false;
  const [value, setValue] = createSignal(config.exitOnWindowClose);

  function onChange(next: boolean) {
    setValue(next);
    config.exitOnWindowClose = next;
    void store.write(configEntries.exitOnWindowClose, next);
  }

  return function UI() {
    const chinese = locale.currentLanguage.startsWith("zh");
    return (
      <SettingSwitch
        id="exitOnWindowClose"
        label={
          chinese
            ? "窗口关闭时自动结束 Wine 进程"
            : "End Wine processes when the game window closes"
        }
        description={
          chinese
            ? "窗口持续不可见时结束当前 Wine 环境中的全部进程。全屏游戏在后台运行时可能被误判；下次启动生效。"
            : "Ends all processes in this game's Wine environment when its window stays hidden. A fullscreen game in the background may be misdetected; takes effect on the next launch."
        }
        checked={value()}
        onChange={onChange}
      />
    );
  };
}
