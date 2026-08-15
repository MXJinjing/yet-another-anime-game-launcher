import { describe, expect, it, vi } from "vitest";
import type { Locale } from "@locale";
import {
  getGameInstallationDirectorySize,
  selectGameInstallationDirectory,
} from "@services/game-installation";

function createLocale() {
  const alert = vi.fn(async () => undefined);
  return {
    get: (key: string) => key,
    alert,
  } as unknown as Locale & { alert: ReturnType<typeof vi.fn> };
}

describe("selectGameInstallationDirectory", () => {
  it("returns an empty path when the dialog is cancelled", async () => {
    const locale = createLocale();
    const path = await selectGameInstallationDirectory(locale, {
      openFolderDialog: async () => "",
      getHome: async () => "/Users/test",
      log: async () => undefined,
    });

    expect(path).toBe("");
    expect(locale.alert).not.toHaveBeenCalled();
  });

  it("retries relative, protected-home, and non-ASCII paths", async () => {
    const locale = createLocale();
    const responses = [
      "relative/game",
      "/Users/test/Downloads/Game",
      "/Games/游戏",
      "/Games/Anime",
    ];
    const path = await selectGameInstallationDirectory(locale, {
      openFolderDialog: async () => responses.shift() ?? "",
      getHome: async () => "/Users/test",
      log: async () => undefined,
    });

    expect(path).toBe("/Games/Anime");
    expect(locale.alert).toHaveBeenNthCalledWith(
      1,
      "PATH_INVALID",
      "PLEASE_SELECT_A_DIR"
    );
    expect(locale.alert).toHaveBeenNthCalledWith(
      2,
      "PATH_INVALID",
      "PATH_INVALID_FORBIDDEN_DIR"
    );
    expect(locale.alert).toHaveBeenNthCalledWith(
      3,
      "PATH_INVALID",
      "PATH_INVALID_ASCII_ONLY"
    );
  });

  it("does not treat a same-prefix home path as a protected directory", async () => {
    const locale = createLocale();
    await expect(
      selectGameInstallationDirectory(locale, {
        openFolderDialog: async () => "/Users/tester/Downloads/Game",
        getHome: async () => "/Users/test",
        log: async () => undefined,
      })
    ).resolves.toBe("/Users/tester/Downloads/Game");
  });
});

describe("getGameInstallationDirectorySize", () => {
  it("converts du KiB output to bytes", async () => {
    await expect(
      getGameInstallationDirectorySize("/Games/Anime", {
        exec: async () => ({ stdOut: "42\t/Games/Anime\n" }),
      })
    ).resolves.toBe(42 * 1024);
  });

  it("returns null for failed or invalid du output", async () => {
    await expect(
      getGameInstallationDirectorySize("/Games/Anime", {
        exec: async () => {
          throw new Error("du failed");
        },
      })
    ).resolves.toBeNull();
    await expect(
      getGameInstallationDirectorySize("/Games/Anime", {
        exec: async () => ({ stdOut: "not-a-size" }),
      })
    ).resolves.toBeNull();
  });
});
