import { describe, expect, it } from "vitest";
import type { Server } from "@constants";
import type { SophonOnlineGameInfo } from "@sophon";
import {
  sophonConfigDefaults,
  sophonPredownloadVersion,
} from "../../../src/clients/mhy/sophon-game";

describe("shared Sophon game setup", () => {
  const server = { channel_id: 1, subchannel_id: 0, cps: "fixture" } as Server;
  const info: SophonOnlineGameInfo = {
    version: "1.2.3",
    game_type: "nap",
    release_type: "os",
    install_size: 0,
    updatable_versions: ["1.2.2"],
    pre_download: true,
    pre_download_version: "1.2.4",
  };

  it("adds channel defaults while preserving existing values and line endings", () => {
    const input =
      "\ufeff[General]\r\nchannel=7\r\ngame_version=1.2.3\r\n[Other]\r\ncps=custom\r\n";
    const result = sophonConfigDefaults(input, server);
    expect(result).toBe(
      "\ufeff[General]\r\nsub_channel=0\r\ncps=fixture\r\nchannel=7\r\ngame_version=1.2.3\r\n[Other]\r\ncps=custom\r\n"
    );
    expect(sophonConfigDefaults(result, server)).toBe(result);
    expect(sophonConfigDefaults("", server)).toBe(
      "[General]\nchannel=1\nsub_channel=0\ncps=fixture\n"
    );
  });

  it("admits future manifests for chunk-based predownload and checks advertised diff versions", () => {
    expect(sophonPredownloadVersion(info, "1.2.3")).toBe("1.2.4");
    expect(
      sophonPredownloadVersion(
        { ...info, pre_download_from: ["1.2.2"] },
        "1.2.3"
      )
    ).toBe("");
    expect(
      sophonPredownloadVersion(
        { ...info, pre_download_from: ["1.2.3"] },
        "1.2.3"
      )
    ).toBe("1.2.4");
    expect(
      sophonPredownloadVersion({ ...info, needs_resume: true }, "1.2.3")
    ).toBe("");
    expect(sophonPredownloadVersion(info, "1.2.4")).toBe("");
    expect(sophonPredownloadVersion(info, "0.0.0")).toBe("");
    expect(sophonPredownloadVersion(undefined, "1.2.3")).toBe("");
  });
});
