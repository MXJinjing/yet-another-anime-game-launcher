import { describe, expect, it } from "vitest";
import {
  GameAlreadyRunningError,
  GameVersionUnreadableError,
  isGameAlreadyRunningError,
  isGameVersionUnreadableError,
} from "@src/clients/launch-errors";

describe("client launch errors", () => {
  it("carries the executable path of a running game", () => {
    const error = new GameAlreadyRunningError("/game/TargetGame.exe");
    expect(isGameAlreadyRunningError(error)).toBe(true);
    expect(error.executablePath).toBe("/game/TargetGame.exe");
    expect(error.message).toContain("/game/TargetGame.exe");
  });

  it("recognizes only its own typed errors", () => {
    const unreadable = new GameVersionUnreadableError("pattern not found");
    expect(isGameVersionUnreadableError(unreadable)).toBe(true);
    expect(isGameAlreadyRunningError(unreadable)).toBe(false);
    expect(isGameVersionUnreadableError(new Error("pattern not found"))).toBe(
      false
    );
  });
});
