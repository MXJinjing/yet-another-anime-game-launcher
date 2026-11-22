import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import {
  METALFX_FACTOR_DEFAULT,
  normalizeMetalFxFactor,
} from "@config/metalfx-factor";
import { SettingSwitch } from "../../../components/setting-switch";
import { MetalFxFactorSlider } from "../../../components/metalfx-factor-slider";
import { Config } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    metalFxEnable: boolean;
    metalFxFactor: number;
  }
}

export default async function ({
  locale,
  config,
  store,
  dxmtOnly = false,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
  /** True for clients whose MetalFX is DXMT's swapchain upscale. */
  dxmtOnly?: boolean;
}) {
  try {
    config.metalFxEnable =
      (await store.read(configEntries.metalFxEnable)) ?? false;
  } catch {
    config.metalFxEnable = false;
  }

  try {
    config.metalFxFactor = normalizeMetalFxFactor(
      (await store.read(configEntries.metalFxFactor)) ?? METALFX_FACTOR_DEFAULT
    );
  } catch {
    config.metalFxFactor = METALFX_FACTOR_DEFAULT;
  }

  const [enabled, setEnabled] = createSignal(config.metalFxEnable);
  const [factor, setFactor] = createSignal(config.metalFxFactor);

  async function onSaveEnable(apply: boolean) {
    assertValueDefined(config.metalFxEnable);
    if (!apply) {
      setEnabled(config.metalFxEnable);
      return;
    }
    if (config.metalFxEnable == enabled()) return;
    config.metalFxEnable = enabled();
    await store.write(configEntries.metalFxEnable, config.metalFxEnable);
  }

  async function onSaveFactor(apply: boolean) {
    assertValueDefined(config.metalFxFactor);
    if (!apply) {
      setFactor(config.metalFxFactor);
      return;
    }
    if (config.metalFxFactor == factor()) return;
    config.metalFxFactor = factor();
    await store.write(configEntries.metalFxFactor, config.metalFxFactor);
  }

  createEffect(() => {
    enabled();
    onSaveEnable(true);
  });

  createEffect(() => {
    factor();
    onSaveFactor(true);
  });

  return [
    function UI(opts?: { disabled?: boolean }) {
      const disabled = opts?.disabled ?? !config.advancedEnable;

      return (
        <SettingSwitch
          id="metalFxUpscale"
          label={locale.get("SETTING_METALFX_UPSCALE")}
          checked={enabled()}
          onChange={setEnabled}
          disabled={disabled}
        >
          <Show when={dxmtOnly}>
            <span class="setting-switch-requirement">
              {locale.get("SETTING_METALFX_DXMT_ONLY")}
            </span>
          </Show>
          {enabled() ? (
            <MetalFxFactorSlider
              locale={locale}
              value={factor()}
              disabled={disabled}
              onChange={setFactor}
            />
          ) : null}
        </SettingSwitch>
      );
    },
  ] as const;
}
