import { describe, expect, it, vi } from "vitest";
import { exec } from "@runtime/command-runner";
import { build } from "@platform/shell";
import { removeExternalSophonPredownload } from "@download/sophon-predownload";

vi.mock("@runtime/command-runner", () => ({ exec: vi.fn() }));

describe("external Sophon predownload cleanup", () => {
  it("limits cleanup to a managed child and quotes spaces, glob characters and apostrophes", async () => {
    await removeExternalSophonPredownload(
      "/Volumes/My [Cache]? 'Disk'",
      "/game"
    );
    const segments = vi.mocked(exec).mock.calls[0][0];
    expect(build(segments)).toMatch(
      /^\/bin\/rm -rf '\/Volumes\/My \[Cache\]\? '\\''Disk'\\''\/yaaglm-sophon-[0-9a-f]{64}'$/
    );
  });
});
