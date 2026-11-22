import { describe, expect, it } from "vitest";
import {
  nextLogWindowTheme,
  normalizeLogWindowTheme,
} from "@src/logging/log-window-theme";

describe("log window theme", () => {
  it("defaults to dark for unknown stored values", () => {
    expect(normalizeLogWindowTheme("light")).toBe("light");
    expect(normalizeLogWindowTheme("dark")).toBe("dark");
    expect(normalizeLogWindowTheme(undefined)).toBe("dark");
    expect(normalizeLogWindowTheme("")).toBe("dark");
    expect(normalizeLogWindowTheme("system")).toBe("dark");
  });

  it("toggles between light and dark", () => {
    expect(nextLogWindowTheme("dark")).toBe("light");
    expect(nextLogWindowTheme("light")).toBe("dark");
  });
});
