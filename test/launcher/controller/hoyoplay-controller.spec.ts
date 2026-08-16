import { describe, expect, it } from "vitest";
import { gameDownloadTaskMetadata } from "@src/launcher/controller/hyp-controller";
import { inferUnityLogLevel } from "@src/logging/runtime-log";
import type { HypGame } from "@src/launcher/controller/launcher-types";

function game(overrides: Partial<HypGame["client"]> = {}): HypGame {
  return {
    id: "game-a",
    title: "Game A",
    fallbackIcon: "",
    serverLabel: "",
    config: {},
    ConfigurationUI: () => null,
    client: {
      predownloadVersion: () => "2.0.0",
      latestVersion: () => "1.0.0",
      gameVersion: () => "0.9.0",
      ...overrides,
    },
  } as unknown as HypGame;
}

const locale = {
  get: (key: string) =>
    ({ DOWNLOAD_TASK_PREDOWNLOAD_SUFFIX: "preload" }[key] ?? key),
} as never;

describe("hyp launcher controller", () => {
  it("provides stable task metadata for install, update, and predownload", () => {
    expect(gameDownloadTaskMetadata(game(), locale, "release")).toEqual({
      title: "Game A 1.0.0",
      key: undefined,
    });
    expect(gameDownloadTaskMetadata(game(), locale, "current")).toEqual({
      title: "Game A 0.9.0",
      key: undefined,
    });
    expect(gameDownloadTaskMetadata(game(), locale, "predownload")).toEqual({
      title: "Game A 2.0.0 preload",
      key: undefined,
    });
  });

  it("classifies Unity log severity without a view dependency", () => {
    expect(inferUnityLogLevel("fatal error opening archive")).toBe("ERROR");
    expect(inferUnityLogLevel("warning: missing shader")).toBe("WARNING");
    expect(inferUnityLogLevel("scene loaded")).toBe("INFO");
  });
});
