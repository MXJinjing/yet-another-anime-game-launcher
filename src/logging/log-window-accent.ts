/**
 * Accent helpers for the standalone log window.
 *
 * The launcher owns the configurable theme colour, but the log window process
 * sits below it in the import graph, so the colour arrives through the session
 * payload instead of importing the settings layer.
 */
export const DEFAULT_LOG_WINDOW_ACCENT = "#FFB224";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function normalizeLogWindowAccent(value: unknown): string | undefined {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : undefined;
}

export function logWindowAccentText(hex: string): "#333333" | "#ffffff" {
  const clean = hex.replace("#", "");
  const channel = (offset: number) =>
    parseInt(clean.substring(offset, offset + 2), 16);
  const toLinear = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * toLinear(channel(0)) +
    0.7152 * toLinear(channel(2)) +
    0.0722 * toLinear(channel(4));
  // Same rule as the launcher: pick whichever of the two text colours has the
  // higher contrast ratio against the accent.
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#333333"
    : "#ffffff";
}
