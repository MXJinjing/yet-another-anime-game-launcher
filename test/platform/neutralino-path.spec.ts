import { beforeEach, describe, expect, it } from "vitest";
import { resolveResource } from "@platform/neutralino/path";

describe("resolveResource", () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      window: {
        NL_CWD: "/workspace/yaaglm",
        NL_PATH: "dev/yaaglmwdos",
      },
    });
  });

  it("resolves relative resource paths from NL_CWD in development", () => {
    expect(resolveResource("./sidecar/arm64/aria2/aria2c")).toBe(
      "/workspace/yaaglm/dev/yaaglmwdos/sidecar/arm64/aria2/aria2c"
    );
  });

  it("preserves absolute resource paths", () => {
    expect(
      resolveResource("/Applications/Yaaglm.app/Contents/Resources/sidecar")
    ).toBe("/Applications/Yaaglm.app/Contents/Resources/sidecar");
  });
});
