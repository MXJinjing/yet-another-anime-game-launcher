import { describe, expect, it } from "vitest";
import {
  GLOBAL_WINE_PROP_KEYS,
  readGlobalWineProps,
} from "@src/wine/global-props";

describe("global wine props", () => {
  it("reads both switches from the launcher-wide store", async () => {
    const seen: string[] = [];
    const props = await readGlobalWineProps(async (key, fallback) => {
      seen.push(`${key}=${fallback}`);
      return "true";
    });

    expect(props).toEqual({ leftCmd: true, gameControllerFix: true });
    expect(seen).toEqual([
      `${GLOBAL_WINE_PROP_KEYS.leftCmd}=false`,
      `${GLOBAL_WINE_PROP_KEYS.gameControllerFix}=false`,
    ]);
  });

  it("treats anything but an explicit true as disabled", async () => {
    const props = await readGlobalWineProps(async () => "1");

    expect(props).toEqual({ leftCmd: false, gameControllerFix: false });
  });

  it("falls back to disabled when the store cannot be read", async () => {
    const props = await readGlobalWineProps(async () => {
      throw new Error("storage unavailable");
    });

    expect(props).toEqual({ leftCmd: false, gameControllerFix: false });
  });
});
