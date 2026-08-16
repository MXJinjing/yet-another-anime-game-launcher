import { describe, expect, it } from "vitest";
import { getChannelBootIcon } from "../../src/boot-icon";

describe("getChannelBootIcon", () => {
  it("resolves a non-empty icon for every channel", () => {
    for (const channel of [
      "hk4ecn",
      "hk4eos",
      "hk4euniversal",
      "hkrpgcn",
      "hkrpgos",
      "napcn",
      "napos",
      "bh3glb",
      "cbjq",
      "cbjqcn",
      "mhyos",
      "mhycn",
    ]) {
      expect(getChannelBootIcon(channel), channel).toBeTruthy();
    }
  });

  it("maps the dedicated game icons and falls back to the default", () => {
    expect(getChannelBootIcon("hkrpgcn")).toBe(getChannelBootIcon("hkrpgos"));
    expect(getChannelBootIcon("bh3glb")).not.toBe(getChannelBootIcon("hkrpgcn"));
    expect(getChannelBootIcon("mhyos")).toBe(getChannelBootIcon("hk4eos"));
    expect(getChannelBootIcon("unknown")).toBe(getChannelBootIcon("hk4eos"));
  });
});
