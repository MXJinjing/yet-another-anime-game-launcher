import { configEntries, createConfigStore } from "@config";

export const THEME_COLOR_STORAGE_KEY = "config_theme_color";

export const PRESET_THEME_HEX: Record<string, string> = {
  amber: "#FFB224",
  blue: "#0091FF",
  crimson: "#E93D82",
  cyan: "#00A2C7",
  green: "#30A46C",
  indigo: "#3E63DD",
  lime: "#BDEA11",
  orange: "#F76B15",
  pink: "#D6409F",
  plum: "#AB4ABA",
  purple: "#8E4EC6",
  red: "#E5484D",
  sky: "#7CE2FE",
  teal: "#12A594",
  tomato: "#E54D2E",
  violet: "#6344AF",
  yellow: "#FBE50B",
};

const DEFAULT_THEME_HEX = "#FFB224";
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

export async function getThemeColorHex(): Promise<string> {
  try {
    const value = await createConfigStore().read(configEntries.themeColor);
    if (!value) return DEFAULT_THEME_HEX;
    if (value.startsWith("custom:")) {
      const hex = value.slice("custom:".length);
      return HEX_PATTERN.test(hex) ? hex : DEFAULT_THEME_HEX;
    }
    return PRESET_THEME_HEX[value] ?? DEFAULT_THEME_HEX;
  } catch {
    return DEFAULT_THEME_HEX;
  }
}

export function getContrastText(hex: string): "#333333" | "#ffffff" {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#333333"
    : "#ffffff";
}
