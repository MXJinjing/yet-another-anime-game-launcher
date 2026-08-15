import { describe, expect, it } from "vitest";
import { formatDownloadSpeed } from "@runtime/format";

describe("formatDownloadSpeed", () => {
  it("formats an idle active transfer as a speed instead of a pause state", () => {
    expect(formatDownloadSpeed(0)).toBe("0 B/s");
  });

  it("clamps invalid and negative samples to zero", () => {
    expect(formatDownloadSpeed(Number.NaN)).toBe("0 B/s");
    expect(formatDownloadSpeed(-1)).toBe("0 B/s");
  });
});
