import { describe, expect, it } from "vitest";
import { resolveChannelClientConfig } from "@settings/channel-client-config";

describe("channel client settings boundary", () => {
  it("keeps function-form configuration as the launch settings component", () => {
    const launch = () => null;
    expect(resolveChannelClientConfig(launch).channelClientGame).toBe(launch);
  });

  it("maps object-form launch and video configuration without a game alias", () => {
    const launch = () => null;
    const video = () => null;
    const resolved = resolveChannelClientConfig({ launch, video });

    expect(resolved.channelClientGame).toBe(launch);
    expect(resolved.channelClientVideo).toBe(video);
  });
});
