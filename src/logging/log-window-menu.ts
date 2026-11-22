/**
 * Placement for the monitored-file menu.
 *
 * The menu is rendered outside the tab strip (in a portal) because the strip
 * scrolls horizontally, and a scroll container clips absolutely positioned
 * children. A portaled popup has to be positioned against the viewport, so the
 * geometry is computed here instead of leaning on CSS anchoring.
 */

export const LOG_WINDOW_MENU_GAP = 6;
export const LOG_WINDOW_MENU_MARGIN = 8;
export const LOG_WINDOW_MENU_PREFERRED_HEIGHT = 300;
export const LOG_WINDOW_MENU_MIN_HEIGHT = 96;

export interface LogWindowMenuRect {
  top: number;
  right: number;
  bottom: number;
}

export interface LogWindowMenuPlacement {
  /** Offset from the viewport's right edge, so the menu hangs off the anchor. */
  right: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function logWindowMenuPlacement(
  anchor: LogWindowMenuRect,
  viewport: { width: number; height: number }
): LogWindowMenuPlacement {
  const right = clamp(
    viewport.width - anchor.right,
    LOG_WINDOW_MENU_MARGIN,
    Math.max(LOG_WINDOW_MENU_MARGIN, viewport.width - LOG_WINDOW_MENU_MARGIN)
  );
  const below =
    viewport.height -
    anchor.bottom -
    LOG_WINDOW_MENU_GAP -
    LOG_WINDOW_MENU_MARGIN;
  const above = anchor.top - LOG_WINDOW_MENU_GAP - LOG_WINDOW_MENU_MARGIN;
  const placeBelow = below >= LOG_WINDOW_MENU_MIN_HEIGHT || below >= above;
  const space = placeBelow ? below : above;
  const maxHeight = Math.max(
    LOG_WINDOW_MENU_MIN_HEIGHT,
    Math.min(LOG_WINDOW_MENU_PREFERRED_HEIGHT, space)
  );
  if (placeBelow) {
    return {
      right,
      top: anchor.bottom + LOG_WINDOW_MENU_GAP,
      maxHeight,
    };
  }
  return {
    right,
    bottom: viewport.height - anchor.top + LOG_WINDOW_MENU_GAP,
    maxHeight,
  };
}
