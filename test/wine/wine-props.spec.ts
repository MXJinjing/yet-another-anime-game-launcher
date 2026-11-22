import { describe, expect, it } from "vitest";
import { buildWinePropsScript } from "@src/wine/wine-props";

function registryValue(script: string, key: string) {
  const match = new RegExp(`/v "?${key}"? /t [A-Z_]+ /d (\\S+) /f`).exec(
    script
  );
  return match?.[1];
}

describe("wine props registry script", () => {
  it("maps the display options to the Mac driver keys", () => {
    const script = buildWinePropsScript({ retina: true, leftCmd: false });

    expect(registryValue(script, "RetinaMode")).toBe("y");
    expect(registryValue(script, "LeftCommandIsCtrl")).toBe("n");
  });

  it("enables SDL and disables hidraw when the controller fix is on", () => {
    const script = buildWinePropsScript({
      retina: false,
      leftCmd: false,
      gameControllerFix: true,
    });

    expect(script).toContain("Services\\winebus");
    expect(registryValue(script, "DisableHidraw")).toBe("1");
    expect(registryValue(script, "Enable SDL")).toBe("1");
  });

  it("leaves winebus untouched when the fix is off", () => {
    const script = buildWinePropsScript({ retina: false, leftCmd: true });

    expect(script).not.toContain("winebus");
    expect(registryValue(script, "DisableHidraw")).toBeUndefined();
    expect(registryValue(script, "LeftCommandIsCtrl")).toBe("y");
  });

  it("always ends with a clean exit code", () => {
    for (const fix of [true, false]) {
      const script = buildWinePropsScript({
        retina: true,
        leftCmd: true,
        gameControllerFix: fix,
      });
      expect(script.trimEnd().endsWith("exit /b 0")).toBe(true);
    }
  });
});
