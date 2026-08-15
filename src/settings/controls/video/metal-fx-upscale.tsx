import { Box, HStack, IconButton, Text } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";
import { createIcon } from "@hope-ui/solid";
import { SettingSwitch } from "../../../components/setting-switch";
import { Config } from "../../../config/config-def";

declare module "../../../config/config-def" {
  interface Config {
    metalFxEnable: boolean;
    metalFxFactor: number;
  }
}

const MIN_FACTOR = 1.1;
const MAX_FACTOR = 3.0;
const DEFAULT_FACTOR = 2.0;
const STEP = 0.05;

const IconReset = createIcon({
  viewBox: "0 0 24 24",
  path() {
    return (
      <path
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"
      />
    );
  },
});

export default async function ({
  locale,
  config,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.metalFxEnable =
      (await store.read(configEntries.metalFxEnable)) ?? false;
  } catch {
    config.metalFxEnable = false;
  }

  try {
    config.metalFxFactor =
      (await store.read(configEntries.metalFxFactor)) ?? DEFAULT_FACTOR;
    if (
      isNaN(config.metalFxFactor) ||
      config.metalFxFactor < MIN_FACTOR ||
      config.metalFxFactor > MAX_FACTOR
    ) {
      config.metalFxFactor = DEFAULT_FACTOR;
    }
  } catch {
    config.metalFxFactor = DEFAULT_FACTOR;
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
          {enabled() ? (
            <Box mt="$3">
              <HStack justifyContent="space-between" mb="$1">
                <Text fontSize="sm">
                  {locale.get("SETTING_METALFX_FACTOR")}: {factor().toFixed(2)}x
                  ({MIN_FACTOR.toFixed(1)}x–{MAX_FACTOR.toFixed(1)}x)
                </Text>
                <IconButton
                  size="xs"
                  variant="ghost"
                  disabled={factor() === DEFAULT_FACTOR || disabled}
                  aria-label={locale.get("SETTING_PREFERRED_MAX_FPS_RESET")}
                  icon={<IconReset />}
                  onClick={() => setFactor(DEFAULT_FACTOR)}
                />
              </HStack>
              <input
                type="range"
                min={MIN_FACTOR}
                max={MAX_FACTOR}
                step={STEP}
                value={factor()}
                onInput={e => setFactor(Number(e.currentTarget.value))}
                disabled={disabled}
                style={{ width: "100%" }}
              />
            </Box>
          ) : null}
        </SettingSwitch>
      );
    },
  ] as const;
}
