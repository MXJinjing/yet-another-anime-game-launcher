import { getKeyOrDefault } from "@runtime/storage";

/**
 * Wine input properties that live in launcher-wide settings instead of the
 * per-game configuration. They are read on every launch so switching games or
 * prefixes does not lose them.
 */
export type GlobalWineProps = {
  leftCmd: boolean;
  gameControllerFix: boolean;
};

export const GLOBAL_WINE_PROP_KEYS = {
  leftCmd: "left_cmd",
  gameControllerFix: "config_game_controller_fix",
} as const;

export type ReadStoredString = (
  key: string,
  defaultValue: string
) => Promise<string>;

export async function readGlobalWineProps(
  read: ReadStoredString = getKeyOrDefault
): Promise<GlobalWineProps> {
  const [leftCmd, gameControllerFix] = await Promise.all([
    read(GLOBAL_WINE_PROP_KEYS.leftCmd, "false").catch(() => "false"),
    read(GLOBAL_WINE_PROP_KEYS.gameControllerFix, "false").catch(() => "false"),
  ]);
  return {
    leftCmd: leftCmd === "true",
    gameControllerFix: gameControllerFix === "true",
  };
}
