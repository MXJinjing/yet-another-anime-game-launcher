import { describe, expect, it } from "vitest";
import {
  LOG_WINDOW_MENU_GAP,
  LOG_WINDOW_MENU_MARGIN,
  LOG_WINDOW_MENU_MIN_HEIGHT,
  LOG_WINDOW_MENU_PREFERRED_HEIGHT,
  logWindowMenuPlacement,
} from "@src/logging/log-window-menu";

describe("logWindowMenuPlacement", () => {
  it("hangs the menu below the anchor and aligns its right edge", () => {
    const placement = logWindowMenuPlacement(
      { top: 44, right: 700, bottom: 70 },
      { width: 1000, height: 800 }
    );
    expect(placement).toEqual({
      right: 300,
      top: 70 + LOG_WINDOW_MENU_GAP,
      maxHeight: LOG_WINDOW_MENU_PREFERRED_HEIGHT,
    });
  });

  it("keeps the menu inside the viewport when the anchor is at the edge", () => {
    const nearEdge = logWindowMenuPlacement(
      { top: 44, right: 993, bottom: 70 },
      { width: 1000, height: 800 }
    );
    expect(nearEdge.right).toBe(LOG_WINDOW_MENU_MARGIN);

    const pastEdge = logWindowMenuPlacement(
      { top: 44, right: 1200, bottom: 70 },
      { width: 1000, height: 800 }
    );
    expect(pastEdge.right).toBe(LOG_WINDOW_MENU_MARGIN);
  });

  it("flips above the anchor when nothing fits below", () => {
    const placement = logWindowMenuPlacement(
      { top: 250, right: 700, bottom: 280 },
      { width: 1000, height: 300 }
    );
    expect(placement.top).toBeUndefined();
    expect(placement.bottom).toBe(300 - 250 + LOG_WINDOW_MENU_GAP);
    expect(placement.maxHeight).toBe(250 - LOG_WINDOW_MENU_GAP - 8);
  });

  it("caps the menu height and keeps it usable in a short window", () => {
    const tall = logWindowMenuPlacement(
      { top: 40, right: 700, bottom: 60 },
      { width: 1000, height: 2000 }
    );
    expect(tall.maxHeight).toBe(LOG_WINDOW_MENU_PREFERRED_HEIGHT);

    const short = logWindowMenuPlacement(
      { top: 40, right: 700, bottom: 60 },
      { width: 1000, height: 120 }
    );
    expect(short.maxHeight).toBe(LOG_WINDOW_MENU_MIN_HEIGHT);
    expect(short.top).toBe(60 + LOG_WINDOW_MENU_GAP);
  });
});
