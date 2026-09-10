import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "@runtime/assertions";
import { globalStorage, type Storage } from "@runtime/storage";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";

declare module "@config/config-def" {
  interface Config {
    useD3D12: boolean;
  }
}

const CONFIG_KEY = "config_use_d3d12";

export default async function ({
  locale,
  config,
  storage = globalStorage,
}: {
  config: Partial<Config>;
  locale: Locale;
  storage?: Storage;
}) {
  const { getKey, setKey } = storage;
  try {
    config.useD3D12 = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.useD3D12 = false;
  }

  const [value, setValue] = createSignal(config.useD3D12);

  async function onSave(apply: boolean) {
    assertValueDefined(config.useD3D12);
    if (!apply) {
      setValue(config.useD3D12);
      return NOOP;
    }
    if (config.useD3D12 == value()) return NOOP;
    config.useD3D12 = value();
    await setKey(CONFIG_KEY, config.useD3D12 ? "true" : "false");
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
          id="useD3D12"
          label={locale.get("SETTING_USE_D3D12")}
          description={locale.get("SETTING_USE_D3D12_DESC")}
          checked={value()}
          onChange={setValue}
        >
          <span class="setting-switch-requirement">
            {locale.get("SETTING_NAP_REQUIRES_GPTK3")}
          </span>
        </SettingSwitch>
      );
    },
  ] as const;
}
