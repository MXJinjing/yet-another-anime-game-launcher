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
  Input,
  HStack,
  Box,
} from "@hope-ui/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Locale } from "../locale";
import { getKey, setKey, assertValueDefined } from "../utils";

// Radix presets (light variants - matching the launcher's color theme)
import amber from "@radix-ui/colors/amber.css?inline";
import blue from "@radix-ui/colors/blue.css?inline";
import green from "@radix-ui/colors/green.css?inline";
import red from "@radix-ui/colors/red.css?inline";
import violet from "@radix-ui/colors/violet.css?inline";
import cyan from "@radix-ui/colors/cyan.css?inline";
import teal from "@radix-ui/colors/teal.css?inline";
import plum from "@radix-ui/colors/plum.css?inline";
import tomato from "@radix-ui/colors/tomato.css?inline";

// --- Preset color definitions ---
// Each preset maps its radix color step (e.g. amber1) to CSS variable
// --hope-colors-primaryN format.
interface PresetColor {
  id: string;
  label: string;
  color: string; // representative HEX color
}

export const PRESET_COLORS: PresetColor[] = [
  { id: "amber", label: "Amber", color: "#FFB224" },
  { id: "blue", label: "Blue", color: "#0091FF" },
  { id: "green", label: "Green", color: "#30A46C" },
  { id: "red", label: "Red", color: "#E5484D" },
  { id: "violet", label: "Violet", color: "#6344AF" },
  { id: "cyan", label: "Cyan", color: "#00A2C7" },
  { id: "teal", label: "Teal", color: "#12A594" },
  { id: "plum", label: "Plum", color: "#AB4ABA" },
  { id: "tomato", label: "Tomato", color: "#E54D2E" },
];

// CSS variable injection helpers
const CSS_VAR_PREFIX = "--hope-colors-primary";

/**
 * Parse a CSS variable string exported by Vite's `?inline` import.
 * radix dark CSS files define variables like:
 *   --amber-1: hsl(...);
 *   --amber-2: hsl(...); ...
 * We extract these and map them to --hope-colors-primary1 .. primary12.
 */
function parseRadixCss(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  // radix dark CSS uses names like --amber1: hsl(...); (no hyphen between name and number)
  const re = /--([a-z]+)(\d+):\s*(hsl\([^)]+\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1]; // e.g. "amber"
    const step = m[2]; // e.g. "1"
    const value = m[3]; // e.g. "hsl(36, 100%, 6.1%)"
    map[`${name}${step}`] = value;
  }
  return map;
}

// Parse all preset CSS
const presetCssSources: Record<string, string> = {
  amber: amber,
  blue: blue,
  green: green,
  red: red,
  violet: violet,
  cyan: cyan,
  teal: teal,
  plum: plum,
  tomato: tomato,
};

const presetColorMaps: Record<string, Record<string, string>> = {};
for (const [name, css] of Object.entries(presetCssSources)) {
  presetColorMaps[name] = parseRadixCss(css);
}

/**
 * Generate a 12-step HSL color scale from a base hue.
 * Approximates radix-ui's scale for light themes:
 * - steps 1-6: high lightness (light backgrounds), lower saturation
 * - steps 7-8: border/muted colors
 * - step 9: main brand color (the base hue)
 * - steps 10-12: darker variants for text/strong contrast
 */
function generateColorScale(
  baseH: number,
  baseS: number,
  baseL: number
): Record<string, string> {
  const sat = Math.min(baseS, 100);
  return {
    [`primary1`]: `hsl(${baseH}, ${Math.min(sat * 0.65, 70)}%, 99%)`,
    [`primary2`]: `hsl(${baseH}, ${Math.min(sat * 0.8, 80)}%, 96.5%)`,
    [`primary3`]: `hsl(${baseH}, ${sat * 0.9}%, 91.7%)`,
    [`primary4`]: `hsl(${baseH}, ${sat * 0.95}%, 86.8%)`,
    [`primary5`]: `hsl(${baseH}, ${sat}%, 81%)`,
    [`primary6`]: `hsl(${baseH}, ${sat}%, 74%)`,
    [`primary7`]: `hsl(${baseH}, ${sat}%, 65%)`,
    [`primary8`]: `hsl(${baseH}, ${sat}%, 55%)`,
    [`primary9`]: `hsl(${baseH}, ${sat}%, ${baseL}%)`,
    [`primary10`]: `hsl(${baseH}, ${sat}%, ${Math.max(baseL - 8, 30)}%)`,
    [`primary11`]: `hsl(${baseH}, ${Math.min(sat * 0.85, 90)}%, ${Math.max(baseL - 16, 20)}%)`,
    [`primary12`]: `hsl(${baseH}, ${Math.min(sat * 0.5, 60)}%, ${Math.max(baseL - 24, 12)}%)`,
  };
}

/**
 * Convert HEX color to HSL components.
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let r = 0,
    g = 0,
    b = 0;
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Apply theme color by writing CSS custom properties to document root.
 */
export function applyThemeColor(
  scale: Record<string, string>
): void {
  const root = document.body;
  for (let i = 1; i <= 12; i++) {
    const key = `primary${i}`;
    root.style.setProperty(`${CSS_VAR_PREFIX}${i}`, scale[key] ?? "");
  }
}

// --- Config module ---

declare module "./config-def" {
  interface Config {
    themeColor: string; // preset id or "custom:HEX"
  }
}

const CONFIG_KEY = "config_theme_color";
const DEFAULT_COLOR = "amber";

export default async function createThemeColorConfig({
  locale,
  config,
}: {
  locale: Locale;
  config: Partial<{
    themeColor: string;
  }>;
}) {
  // Load persisted value
  try {
    config.themeColor = (await getKey(CONFIG_KEY)) || DEFAULT_COLOR;
  } catch {
    config.themeColor = DEFAULT_COLOR;
  }

  const [value, setValue] = createSignal(config.themeColor);
  const [customColor, setCustomColor] = createSignal("#FFB224");

  const isCustom = () => value().startsWith("custom:");
  const selectedPreset = () =>
    isCustom() ? "custom" : value();

  // Initialize customColor from saved value if it's a custom one
  if (isCustom()) {
    const hex = value().replace("custom:", "");
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      setCustomColor(hex);
    }
  }

  function resolveCurrentScale(): Record<string, string> {
    if (isCustom()) {
      const hex = customColor();
      const { h, s, l } = hexToHsl(hex);
      return generateColorScale(h, s, Math.max(l, 45));
    }
    const presetScale = presetColorMaps[value()];
    if (!presetScale) return presetColorMaps[DEFAULT_COLOR];
    // Remap from "amber1" etc. to "primary1" etc.
    const prefix = value();
    const result: Record<string, string> = {};
    for (let i = 1; i <= 12; i++) {
      result[`primary${i}`] = presetScale[`${prefix}${i}`] ?? "";
    }
    return result;
  }

  async function onSave(save: boolean) {
    assertValueDefined(config.themeColor);
    if (!save) {
      setValue(config.themeColor);
      return;
    }
    if (config.themeColor === value()) return;
    config.themeColor = value();
    await setKey(CONFIG_KEY, config.themeColor);
    applyThemeColor(resolveCurrentScale());
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  // Apply on first load
  applyThemeColor(resolveCurrentScale());

  return [
    function UI() {
      return (
        <FormControl>
          <FormLabel>{locale.get("SETTING_THEME_COLOR")}</FormLabel>
          <HStack spacing="$3">
            <Box flex={1}>
              <Select
                value={selectedPreset()}
                onChange={(v: string) => {
                  if (v === "custom") {
                    setValue(`custom:${customColor()}`);
                  } else {
                    setValue(v);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectPlaceholder>Choose color</SelectPlaceholder>
                  <SelectValue />
                  <SelectIcon />
                </SelectTrigger>
                <SelectContent>
                  <SelectListbox>
                    <For each={PRESET_COLORS}>
                      {(item) => (
                        <SelectOption value={item.id}>
                          <HStack spacing="$2">
                            <Box
                              w="$4"
                              h="$4"
                              borderRadius="$sm"
                              style={{
                                "background-color": item.color,
                              }}
                            />
                            <SelectOptionText>{item.label}</SelectOptionText>
                          </HStack>
                          <SelectOptionIndicator />
                        </SelectOption>
                      )}
                    </For>
                    <SelectOption value="custom">
                      <SelectOptionText>
                        {locale.get("SETTING_THEME_COLOR_CUSTOM")}
                      </SelectOptionText>
                      <SelectOptionIndicator />
                    </SelectOption>
                  </SelectListbox>
                </SelectContent>
              </Select>
            </Box>
            <Show when={isCustom()}>
              <Input
                type="color"
                value={customColor()}
                onChange={(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const newColor = input.value;
                  setCustomColor(newColor);
                  setValue(`custom:${newColor}`);
                }}
                w="42px"
                h="42px"
                p="2px"
                border="none"
                cursor="pointer"
                style={{
                  "-webkit-appearance": "none",
                  "-moz-appearance": "none",
                  appearance: "none",
                  background: "transparent",
                }}
              />
            </Show>
          </HStack>
        </FormControl>
      );
    },
  ] as const;
}