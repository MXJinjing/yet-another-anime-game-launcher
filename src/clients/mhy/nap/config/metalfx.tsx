import { createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { SettingSwitch } from "../../../../components/setting-switch";
import { MetalFxFactorSlider } from "../../../../components/metalfx-factor-slider";
import { type ConfigStore } from "@config";
import { Config } from "@config/config-def";
import { globalStorage, type Storage } from "@runtime/storage";
import {
  readNapMetalFxEnabled,
  readNapMetalFxFactor,
  writeNapMetalFxEnabled,
  writeNapMetalFxFactor,
} from "./metalfx-storage";

declare module "@config/config-def" {
  interface Config {
    napMetalFxEnable: boolean;
    metalFxFactor: number;
  }
}

export default async function ({
  locale,
  config,
  storage = globalStorage,
  store,
  renderBackend,
}: {
  config: Partial<Config>;
  locale: Locale;
  storage?: Storage;
  store: ConfigStore;
  /** Which bridge implements MetalFX for the selected Wine runtime. */
  renderBackend?: () => "dxmt" | "d3dmetal" | undefined;
}) {
  config.napMetalFxEnable = await readNapMetalFxEnabled(storage);
  const initialFactor = await readNapMetalFxFactor(store);
  config.metalFxFactor = initialFactor;
  const [enabled, setEnabled] = createSignal(config.napMetalFxEnable);
  const [factor, setFactor] = createSignal(initialFactor);

  const onChange = async (next: boolean) => {
    config.napMetalFxEnable = next;
    setEnabled(next);
    await writeNapMetalFxEnabled(storage, next);
  };

  const onFactorChange = async (next: number) => {
    setFactor(next);
    config.metalFxFactor = await writeNapMetalFxFactor(store, next);
  };

  // One switch drives both implementations: DXMT ships its own NGX bridge,
  // while a D3DMetal runtime provides the DLSS-to-MetalFX bridge itself.
  const dxmtSelected = () => renderBackend?.() == "dxmt";
  const requirement = () =>
    dxmtSelected()
      ? locale.get("SETTING_NAP_METALFX_DXMT_NOTE")
      : locale.get("SETTING_NAP_METALFX_RUNTIME_NOTE");

  return [
    function UI() {
      return (
        <SettingSwitch
          id="napMetalFx"
          label={locale.get("SETTING_NAP_METALFX")}
          description={locale.get("SETTING_NAP_METALFX_DESC")}
          checked={enabled()}
          onChange={value => void onChange(value)}
        >
          <span class="setting-switch-requirement">{requirement()}</span>
          <Show when={enabled()}>
            <MetalFxFactorSlider
              locale={locale}
              value={factor()}
              disabled={!dxmtSelected()}
              note={
                dxmtSelected()
                  ? undefined
                  : locale.get("SETTING_METALFX_DXMT_ONLY")
              }
              onChange={value => void onFactorChange(value)}
            />
          </Show>
        </SettingSwitch>
      );
    },
  ] as const;
}
