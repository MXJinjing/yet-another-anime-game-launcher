import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@logging/logger", () => ({ log: vi.fn() }));

import {
  createUnavailableAria2,
  DownloadServiceUnavailableError,
} from "@download/aria2-service";
import type { Aria2 } from "@aria2";
import {
  getDownloadServiceUnavailableReason,
  isDownloadServiceAvailable,
  resetDownloadServiceStatus,
} from "@download/service-status";
import {
  getStartupNotices,
  resetStartupNotices,
} from "@runtime/startup-notices";
import { startDownloadService } from "@src/boot/download-service";

beforeEach(() => {
  resetDownloadServiceStatus();
  resetStartupNotices();
});

describe("download service boot", () => {
  it("returns the started service without touching the outage state", async () => {
    const aria2 = { version: { version: "1.0" } } as Aria2;
    const start = vi.fn(async () => aria2);
    const createUnavailable = vi.fn();
    const reportUnavailable = vi.fn();
    await expect(
      startDownloadService({ start, createUnavailable, reportUnavailable })
    ).resolves.toBe(aria2);
    expect(createUnavailable).not.toHaveBeenCalled();
    expect(reportUnavailable).not.toHaveBeenCalled();
    expect(isDownloadServiceAvailable()).toBe(true);
  });

  it("records the outage and returns a failing facade", async () => {
    const aria2 = await startDownloadService({
      start: vi.fn().mockRejectedValue(new Error("aria2 missing")),
    });
    expect(isDownloadServiceAvailable()).toBe(false);
    expect(getDownloadServiceUnavailableReason()).toBe("aria2 missing");
    expect(getStartupNotices()).toEqual([
      { id: "download-service-unavailable", detail: "aria2 missing" },
    ]);
    await expect(
      (async () => {
        for await (const _ of aria2.doStreamingDownload({
          uri: "",
          absDst: "",
        })) {
          // The facade must never produce a progress sample.
        }
      })()
    ).rejects.toBeInstanceOf(DownloadServiceUnavailableError);
    await expect(aria2.shutdown()).resolves.toBe("");
  });

  it("uses injected fallbacks for callers that own their wiring", async () => {
    const facade = { version: { version: "unavailable" } } as Aria2;
    const createUnavailable = vi.fn(() => facade);
    const reportUnavailable = vi.fn();
    const result = await startDownloadService({
      start: vi.fn().mockRejectedValue(new Error("boom")),
      createUnavailable,
      reportUnavailable,
    });
    expect(result).toBe(facade);
    expect(reportUnavailable).toHaveBeenCalledWith("boom");
    expect(createUnavailable).toHaveBeenCalledWith("boom");
  });

  it("facade has a default reason for downloads", async () => {
    await expect(
      (async () => {
        for await (const _ of createUnavailableAria2().doStreamingDownload({
          uri: "",
          absDst: "",
        })) {
          // Never yields.
        }
      })()
    ).rejects.toThrow("Download service is unavailable");
  });
});
