import { describe, expect, it } from "vitest";
import {
  parseBackgroundPersistedState,
  resolveBackgroundImage,
  resolveBackgroundVideo,
  resolveInitialIndex,
} from "@src/launcher/model/background-switcher";

describe("background persisted state", () => {
  it("parses valid values and rejects invalid shapes", () => {
    expect(
      parseBackgroundPersistedState('{"ids":["a","b"],"index":1}')
    ).toEqual({ ids: ["a", "b"], index: 1 });
    expect(parseBackgroundPersistedState("{not json")).toBeNull();
    expect(parseBackgroundPersistedState('{"ids":[1],"index":0}')).toBeNull();
  });

  it("keeps a matching index and resets stale backgrounds", () => {
    expect(resolveInitialIndex({ ids: ["a", "b"], index: 1 }, ["a", "b"])).toBe(
      1
    );
    expect(resolveInitialIndex({ ids: ["a"], index: 0 }, ["a", "b"])).toBe(0);
    expect(resolveInitialIndex({ ids: ["a"], index: 2 }, ["a"])).toBe(0);
  });
});

describe("background artwork resolution", () => {
  it("treats an empty clip url as 'no clip' instead of shadowing", () => {
    // hyp-connect sends video.url = "" for still artworks.
    expect(
      resolveBackgroundVideo({ background_video: "" }, "https://fallback.webm")
    ).toBeUndefined();
    expect(resolveBackgroundVideo({}, undefined)).toBeUndefined();
  });

  it("prefers the selected artwork's clip and keeps still artwork still", () => {
    const videoArt = { background_video: "https://bg0.webm" };
    expect(resolveBackgroundVideo(videoArt, undefined)).toBe(
      "https://bg0.webm"
    );
    // Switching to a still artwork must not paint bg0's clip over it.
    expect(
      resolveBackgroundVideo({ background_video: "" }, "https://bg0.webm")
    ).toBeUndefined();
  });

  it("falls back to the game-level clip only without a background entry", () => {
    expect(resolveBackgroundVideo(undefined, "https://game-level.webm")).toBe(
      "https://game-level.webm"
    );
    expect(resolveBackgroundVideo(undefined, "")).toBeUndefined();
  });

  it("honours the disable-video-background switch", () => {
    expect(
      resolveBackgroundVideo({ background_video: "https://bg0.webm" }, "", true)
    ).toBeUndefined();
  });

  it("normalises still artwork the same way", () => {
    expect(
      resolveBackgroundImage({ background: "" }, "https://fallback.png")
    ).toBe("https://fallback.png");
    expect(resolveBackgroundImage(undefined, "https://game-level.png")).toBe(
      "https://game-level.png"
    );
    expect(resolveBackgroundImage({ background: "https://bg1.png" }, "")).toBe(
      "https://bg1.png"
    );
  });
});
