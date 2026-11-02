import { describe, expect, it } from "vitest";
import {
  binaryPatternSearch,
  generateRandomString,
  sha1sum,
  sha256_16,
  utf16le,
} from "@runtime/binary";

describe("binary data helpers", () => {
  it.each([
    [[1, 2, 3], [1, 2], 0],
    [[1, 2, 3], [2, 3], 1],
    [[1, 2, 3], [1, 2, 3], 0],
    [[1, 2, 3], [4], -1],
    [[1], [1, 2], -1],
    [[], [], 0],
  ] as [number[], number[], number][])(
    "finds a pattern including the final possible position",
    (bytes, pattern, offset) => {
      expect(binaryPatternSearch(new Uint8Array(bytes), pattern)).toBe(offset);
    }
  );
  it("produces interoperable hash values", async () => {
    await expect(sha1sum("abc")).resolves.toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d"
    );
    await expect(sha256_16("abc")).resolves.toBe("ba7816bf8f01cfea");
  });
  it("writes a BOM and little-endian UTF-16 code units", () => {
    expect([...new Uint8Array(utf16le("A中"))]).toEqual([
      255, 254, 65, 0, 45, 78,
    ]);
    expect([...new Uint8Array(utf16le(""))]).toEqual([255, 254]);
  });
  it("generates bounded uppercase identifiers of the requested length", () => {
    expect(generateRandomString(0)).toBe("");
    expect(generateRandomString(64)).toMatch(/^[A-Z0-9]{64}$/);
  });
});
