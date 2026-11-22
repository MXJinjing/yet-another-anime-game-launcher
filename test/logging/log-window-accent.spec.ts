import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOG_WINDOW_ACCENT,
  logWindowAccentText,
  normalizeLogWindowAccent,
} from "@src/logging/log-window-accent";

describe("log window accent", () => {
  it("accepts only six digit hex colours", () => {
    expect(normalizeLogWindowAccent("#0091FF")).toBe("#0091FF");
    expect(normalizeLogWindowAccent("#ffb224")).toBe("#ffb224");
    expect(normalizeLogWindowAccent("#fff")).toBeUndefined();
    expect(normalizeLogWindowAccent("0091ff")).toBeUndefined();
    expect(normalizeLogWindowAccent("red")).toBeUndefined();
    expect(normalizeLogWindowAccent(undefined)).toBeUndefined();
    expect(DEFAULT_LOG_WINDOW_ACCENT).toBe("#FFB224");
  });

  it("picks readable text for light and dark accents", () => {
    expect(logWindowAccentText("#FFB224")).toBe("#333333");
    expect(logWindowAccentText("#FBE50B")).toBe("#333333");
    expect(logWindowAccentText("#3E63DD")).toBe("#ffffff");
    expect(logWindowAccentText("#16181D")).toBe("#ffffff");
  });
});
