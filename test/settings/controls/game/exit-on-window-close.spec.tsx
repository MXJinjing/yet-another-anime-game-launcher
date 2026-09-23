import { describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

vi.mock("@src/components/setting-switch", () => ({
  SettingSwitch: vi.fn((props: Record<string, unknown>) => props),
}));

import { SettingSwitch } from "@src/components/setting-switch";
import { configEntries, type Config, type ConfigStore } from "@config";
import type { Locale } from "@locale";
import { createExitOnWindowCloseConfig } from "@src/settings/controls/game/exit-on-window-close";

describe("game window exit setting", () => {
  it("starts off and saves an explicit opt-in to the current game config", async () => {
    const config: Partial<Config> = {};
    const store = {
      read: vi.fn(async () => false),
      write: vi.fn(async () => undefined),
    } as unknown as ConfigStore;
    const locale = { currentLanguage: "zh_cn" } as Locale;

    const UI = await createExitOnWindowCloseConfig({
      locale,
      config,
      store,
    });
    expect(config.exitOnWindowClose).toBe(false);

    createRoot(dispose => {
      UI();
      const props = vi.mocked(SettingSwitch).mock.lastCall?.[0];
      expect(props?.checked).toBe(false);
      props?.onChange(true);
      dispose();
    });

    expect(config.exitOnWindowClose).toBe(true);
    expect(store.write).toHaveBeenCalledWith(
      configEntries.exitOnWindowClose,
      true
    );
  });
});
