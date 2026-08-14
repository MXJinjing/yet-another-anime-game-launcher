import { FormControl, FormLabel, HStack } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { AppSelect } from "../components/app-select";
import { Config } from "./config-def";

declare module "./config-def" {
  interface Config {
    preferredMaxFps: number;
  }
}

const CONFIG_KEY = "config_preferred_max_fps";
const PRESETS = [30, 60, 75, 90, 120, 144, 165, 170, 180, 240, 360];

async function detectRefreshRate(): Promise<number> {
  try {
    const displays = await Neutralino.computer.getDisplays();
    if (displays.length > 0 && displays[0].refreshRate > 0) {
      return displays[0].refreshRate;
    }
  } catch {
    // Refresh rate detection is best-effort; fall back to 60.
  }
  return 60;
}

export default async function ({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  const displayRate = await detectRefreshRate();

  let stored = 0;
  try {
    stored = Math.round(parseFloat(await getKey(CONFIG_KEY)));
  } catch {
    // No stored value yet; treat as unset.
  }
  if (!stored || stored < 30 || stored > 360) {
    stored = 0;
  }

  const effectiveValue = stored || displayRate;
  config.preferredMaxFps = effectiveValue;

  const [value, setValue] = createSignal(stored ? String(stored) : "0");

  async function onSave(apply: boolean) {
    assertValueDefined(config.preferredMaxFps);
    if (!apply) {
      setValue(String(config.preferredMaxFps));
      return;
    }
    const numValue = parseInt(value(), 10);
    const effective = numValue || displayRate;
    if (config.preferredMaxFps == effective) return;
    config.preferredMaxFps = effective;
    await setKey(CONFIG_KEY, value());
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  const options = () => {
    const list = [
      {
        label: `${locale.get(
          "SETTING_PREFERRED_MAX_FPS_AUTO"
        )} (${displayRate} Hz)`,
        value: "0",
      },
    ];
    for (const p of PRESETS) {
      if (p === displayRate) continue;
      list.push({ label: `${p} Hz`, value: String(p) });
    }
    return list;
  };

  return [
    function UI() {
      return (
        <FormControl>
          <HStack w="100%" justifyContent="space-between" alignItems="center">
            <FormLabel mb={0}>
              {locale.get("SETTING_PREFERRED_MAX_FPS")}
            </FormLabel>
            <AppSelect
              value={value()}
              onChange={setValue}
              width={180}
              options={options().map(item => ({
                value: item.value,
                label: item.label,
              }))}
            />
          </HStack>
        </FormControl>
      );
    },
  ] as const;
}
