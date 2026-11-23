import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import {
  METALFX_FACTOR_DEFAULT,
  normalizeMetalFxFactor,
} from "@config/metalfx-factor";
import { isMetalFxRuntimeUnavailable } from "@config/metalfx-runtime";
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
  renderBackend,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
  /** True for clients whose MetalFX is DXMT's swapchain upscale. */
  dxmtOnly?: boolean;
  /** Render backend of the Wine selected for this client, if known. */
  renderBackend?: () => string | undefined;
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

  // These clients implement MetalFX with DXMT's swapchain upscale. Any other
  // backend (D3DMetal, a custom Wine without DXMT) cannot apply the setting, so
  // the switch is disabled instead of silently saving a value that never runs.
  const runtimeDisabled = () =>
    isMetalFxRuntimeUnavailable(dxmtOnly, renderBackend?.());

  return [
    function UI(opts?: { disabled?: boolean }) {
      const disabled = opts?.disabled ?? !config.advancedEnable;

      return (
        <SettingSwitch
          id="metalFxUpscale"
          label={locale.get("SETTING_METALFX_UPSCALE")}
          checked={enabled()}
          onChange={setEnabled}
          disabled={disabled || runtimeDisabled()}
        >
          <Show when={() => dxmtOnly && (!renderBackend || runtimeDisabled())}>
            <span class="setting-switch-requirement">
              {locale.get("SETTING_METALFX_DXMT_ONLY")}
            </span>
          </Show>
          {enabled() ? (
            <MetalFxFactorSlider
              locale={locale}
              value={factor()}
              disabled={disabled || runtimeDisabled()}
              onChange={setFactor}
            />
          ) : null}
        </SettingSwitch>
      );
    },
  ] as const;
}
