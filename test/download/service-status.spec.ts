import { beforeEach, describe, expect, it } from "vitest";
import {
  getDownloadServiceUnavailableReason,
  isDownloadServiceAvailable,
  markDownloadServiceAvailable,
  resetDownloadServiceStatus,
  setDownloadServiceUnavailable,
  subscribeDownloadServiceStatus,
} from "@download/service-status";

describe("download service status", () => {
  beforeEach(() => resetDownloadServiceStatus());

  it("is available by default", () => {
    expect(isDownloadServiceAvailable()).toBe(true);
    expect(getDownloadServiceUnavailableReason()).toBeUndefined();
  });

  it("records why the service is unavailable", () => {
    setDownloadServiceUnavailable("aria2 failed to start");
    expect(isDownloadServiceAvailable()).toBe(false);
    expect(getDownloadServiceUnavailableReason()).toBe("aria2 failed to start");
  });

  it("recovers and notifies subscribers", () => {
    let calls = 0;
    const unsubscribe = subscribeDownloadServiceStatus(() => {
      calls += 1;
    });
    setDownloadServiceUnavailable();
    markDownloadServiceAvailable();
    expect(calls).toBe(2);
    expect(isDownloadServiceAvailable()).toBe(true);
    unsubscribe();
    setDownloadServiceUnavailable();
    expect(calls).toBe(2);
  });
});
