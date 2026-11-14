import { describe, expect, it, vi } from "vitest";
import { createConfigStore, type Config } from "@config";
import type { Storage } from "@runtime/storage";
import {
  applyRecommendedGameSettings,
  bindRecommendedSetting,
  getRecommendedGameSettings,
} from "@settings/recommended-settings";

describe("recommended game settings", () => {
  it.each(["hk4ecn", "hk4euniversal", "napcn", "napos"])(
    "applies the launch fixes and disables host blocking for %s",
    channel => {
      expect(getRecommendedGameSettings(channel)).toEqual({
        steamPatch: true,
        timeoutFix: true,
        blockNet: false,
      });
    }
  );

  it("applies host blocking only to the supported channel", () => {
    expect(getRecommendedGameSettings("hkrpgos")).toEqual({ blockNet: true });
    expect(getRecommendedGameSettings("bh3glb")).toEqual({});
  });

  it("updates scoped persistence and open controls without redundant writes", async () => {
    const values = new Map([
      ["config_steam_patch", "true"],
      ["config_block_net", "true"],
      ["config_block_net_duration", "30"],
    ]);
    const storage: Storage = {
      getKey: async key => values.get(key)!,
      getKeyOrDefault: async (key, fallback) => values.get(key) ?? fallback,
      setKey: vi.fn(async (key, value) => {
        if (value === null) values.delete(key);
        else values.set(key, value);
      }),
    };
    const config: Partial<Config> = { blockNet: true, timeoutFix: false };
    const otherConfig: Partial<Config> = {};
    const syncBlockNet = vi.fn();
    const syncOtherBlockNet = vi.fn();
    bindRecommendedSetting(config, "blockNet", syncBlockNet);
    bindRecommendedSetting(otherConfig, "blockNet", syncOtherBlockNet);

    await applyRecommendedGameSettings(
      createConfigStore(storage),
      "napos",
      config
    );
    await applyRecommendedGameSettings(
      createConfigStore(storage),
      "napos",
      config
    );

    expect(storage.setKey).toHaveBeenCalledTimes(2);
    expect(storage.setKey).toHaveBeenCalledWith("config_timeout_fix", "true");
    expect(storage.setKey).toHaveBeenCalledWith("config_block_net", "false");
    expect(values.get("config_block_net_duration")).toBe("30");
    expect(config).toEqual({
      steamPatch: true,
      timeoutFix: true,
      blockNet: false,
    });
    expect(syncBlockNet).toHaveBeenLastCalledWith(false);
    expect(syncOtherBlockNet).not.toHaveBeenCalled();
  });
});
