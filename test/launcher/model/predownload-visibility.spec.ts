import { describe, expect, it } from "vitest";
import { showPredownloadAfterDeletion } from "@src/launcher/model/predownload-visibility";

describe("predownload after deletion", () => {
  it("restores the download entry when the client prompt remains false", () => {
    expect(showPredownloadAfterDeletion(false, true, "2.0.0", "1.0.0")).toBe(
      true
    );
  });
  it("does not offer an obsolete or unavailable package", () => {
    expect(showPredownloadAfterDeletion(false, true, "2.0.0", "2.0.0")).toBe(
      false
    );
    expect(showPredownloadAfterDeletion(false, false, "2.0.0", "1.0.0")).toBe(
      false
    );
    expect(showPredownloadAfterDeletion(false, true, "", "1.0.0")).toBe(false);
    expect(
      showPredownloadAfterDeletion(undefined, true, "2.0.0", "1.0.0")
    ).toBe(false);
  });
});
