import {
  FormControl,
  FormLabel,
  Select,
  SelectContent,
  SelectIcon,
  SelectListbox,
  SelectOption,
  SelectOptionIndicator,
  SelectOptionText,
  SelectPlaceholder,
  SelectTrigger,
  SelectValue,
} from "@hope-ui/solid";
import { createEffect, createSignal, For } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
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
  } catch {}
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
  } catch {}
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
      { label: `${locale.get("SETTING_PREFERRED_MAX_FPS_AUTO")} (${displayRate} Hz)`, value: "0" },
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
          <FormLabel>{locale.get("SETTING_PREFERRED_MAX_FPS")}</FormLabel>
          <Select value={value()} onChange={setValue}>
            <SelectTrigger>
              <SelectPlaceholder>Choose an option</SelectPlaceholder>
              <SelectValue />
              <SelectIcon />
            </SelectTrigger>
            <SelectContent>
              <SelectListbox>
                <For each={options()}>
                  {item => (
                    <SelectOption value={item.value}>
                      <SelectOptionText>{item.label}</SelectOptionText>
                      <SelectOptionIndicator />
                    </SelectOption>
                  )}
                </For>
              </SelectListbox>
            </SelectContent>
          </Select>
        </FormControl>
      );
    },
  ] as const;
}
