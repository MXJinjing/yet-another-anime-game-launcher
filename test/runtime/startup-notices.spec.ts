import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissStartupNotice,
  getStartupNotices,
  pushStartupNotice,
  resetStartupNotices,
  subscribeStartupNotices,
} from "@runtime/startup-notices";

describe("startup notices", () => {
  beforeEach(() => resetStartupNotices());

  it("keeps one notice per id and exposes it to the UI", () => {
    pushStartupNotice("download-service-unavailable", "exit 127");
    pushStartupNotice("github-prefix-disabled");
    expect(getStartupNotices()).toEqual([
      { id: "download-service-unavailable", detail: "exit 127" },
      { id: "github-prefix-disabled", detail: undefined },
    ]);
  });

  it("replaces the detail when the same notice is raised again", () => {
    pushStartupNotice("download-service-unavailable", "first");
    pushStartupNotice("download-service-unavailable", "second");
    expect(getStartupNotices()).toHaveLength(1);
    expect(getStartupNotices()[0].detail).toBe("second");
  });

  it("notifies subscribers on push and dismiss", () => {
    let calls = 0;
    const unsubscribe = subscribeStartupNotices(() => {
      calls += 1;
    });
    pushStartupNotice("github-prefix-disabled");
    dismissStartupNotice("github-prefix-disabled");
    dismissStartupNotice("github-prefix-disabled");
    expect(calls).toBe(2);
    unsubscribe();
    pushStartupNotice("github-prefix-disabled");
    expect(calls).toBe(2);
  });
});
