import { FormControl, FormLabel, Box, Checkbox, Text, HStack, IconButton } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { createIcon } from "@hope-ui/solid";
import { Config } from "./config-def";

declare module "./config-def" {
  interface Config {
    metalFxEnable: boolean;
    metalFxFactor: number;
  }
}

const ENABLE_KEY = "config_metalfx_enable";
const FACTOR_KEY = "config_metalfx_factor";
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
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.metalFxEnable = (await getKey(ENABLE_KEY)) == "true";
  } catch {
    config.metalFxEnable = false;
  }

  try {
    config.metalFxFactor = parseFloat(await getKey(FACTOR_KEY));
    if (isNaN(config.metalFxFactor) || config.metalFxFactor < MIN_FACTOR || config.metalFxFactor > MAX_FACTOR) {
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
    await setKey(ENABLE_KEY, config.metalFxEnable ? "true" : "false");
  }

  async function onSaveFactor(apply: boolean) {
    assertValueDefined(config.metalFxFactor);
    if (!apply) {
      setFactor(config.metalFxFactor);
      return;
    }
    if (config.metalFxFactor == factor()) return;
    config.metalFxFactor = factor();
    await setKey(FACTOR_KEY, String(config.metalFxFactor));
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
        <FormControl>
          <FormLabel>{locale.get("SETTING_METALFX_UPSCALE")}</FormLabel>
          <Box>
            <Checkbox
              checked={enabled()}
              onChange={() => setEnabled(x => !x)}
              size="md"
              disabled={disabled}
            >
              {locale.get("SETTING_ENABLED")}
            </Checkbox>
          </Box>
          {enabled() ? (
            <Box mt="$3">
              <HStack justifyContent="space-between" mb="$1">
                <Text fontSize="sm">
                  {locale.get("SETTING_METALFX_FACTOR")}: {factor().toFixed(2)}x ({MIN_FACTOR.toFixed(1)}x–{MAX_FACTOR.toFixed(1)}x)
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
        </FormControl>
      );
    },
  ] as const;
}
