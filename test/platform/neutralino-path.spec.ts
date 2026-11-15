import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve, resolveResource } from "@platform/neutralino/path";

function useLauncherPaths(cwd: string, appPath: string) {
  vi.stubGlobal("window", { NL_CWD: cwd, NL_PATH: appPath });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Neutralino paths", () => {
  it("uses the local staging directory when NL_PATH is relative", () => {
    useLauncherPaths("/workspace/yaaglm", "dev/yaaglmwdcn");

    expect(resolve("./aria2.session.test")).toBe(
      "/workspace/yaaglm/dev/yaaglmwdcn/aria2.session.test"
    );
    expect(resolveResource("./sidecar/arm64/aria2/aria2c")).toBe(
      "/workspace/yaaglm/dev/yaaglmwdcn/sidecar/arm64/aria2/aria2c"
    );
  });

  it("keeps packaged data under Application Support and resources in the app", () => {
    useLauncherPaths(
      "/Users/test/Library/Application Support/Yaaglm CN",
      "/Applications/Yaaglm CN Test.app/Contents/Resources"
    );

    expect(resolve("./aria2.session.test")).toBe(
      "/Users/test/Library/Application Support/Yaaglm CN/aria2.session.test"
    );
    expect(resolveResource("./sidecar/arm64/aria2/aria2c")).toBe(
      "/Applications/Yaaglm CN Test.app/Contents/Resources/sidecar/arm64/aria2/aria2c"
    );
  });

  it("preserves absolute paths passed by callers", () => {
    useLauncherPaths("/workspace/yaaglm", "dev/yaaglmwdcn");

    expect(resolve("/Games/Library/file.txt")).toBe("/Games/Library/file.txt");
    expect(resolveResource("/Applications/Yaaglm.app/Contents/Resources")).toBe(
      "/Applications/Yaaglm.app/Contents/Resources"
    );
  });
});
