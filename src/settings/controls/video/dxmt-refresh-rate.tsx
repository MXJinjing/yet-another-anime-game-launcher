import { Input } from "@hope-ui/solid";
import { createSignal } from "solid-js";
import type { Locale } from "@locale";
import type { Config, ConfigStore } from "@config";
import {
  dxmtRefreshRateEntry,
  loadDxmtRefreshRate,
  parseRefreshRate,
} from "@config/dxmt-refresh-rate";
import { SettingSwitch } from "../../../components/setting-switch";

export default async function ({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  const [setting, setSetting] = createSignal(await loadDxmtRefreshRate(store));
  config.dxmtRefreshRate = setting();
  let pendingWrite = Promise.resolve();

  function save(enabled: boolean, rate: number) {
    if (setting().enabled === enabled && setting().rate === rate) return;
    const next = { enabled, rate };
    setSetting(next);
    config.dxmtRefreshRate = next;
    pendingWrite = pendingWrite
      .then(() => store.write(dxmtRefreshRateEntry, next))
      .catch(error => console.error("Unable to save DXMT refresh rate", error));
  }

  return [
    function UI() {
      return (
        <SettingSwitch
          id="dxmtRefreshRate"
          label={locale.get("SETTING_DXMT_MAX_FRAMERATE")}
          description={locale.get("SETTING_DXMT_MAX_FRAMERATE_DESC")}
          checked={setting().enabled}
          onChange={enabled => save(enabled, setting().rate)}
          control={
            <Input
              aria-label={locale.get("SETTING_DXMT_MAX_FRAMERATE")}
              type="number"
              min={0}
              step={1}
              width="6rem"
              disabled={!setting().enabled}
              value={setting().rate}
              onChange={e => {
                const rate = parseRefreshRate(e.currentTarget.value);
                if (rate !== undefined) save(setting().enabled, rate);
                e.currentTarget.value = String(setting().rate);
              }}
            />
          }
        />
      );
    },
  ] as const;
}
