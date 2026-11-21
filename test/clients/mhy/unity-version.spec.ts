import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@platform/neutralino", () => ({
  readBinary: vi.fn(async () => new Uint8Array()),
}));
vi.mock("@runtime/patching", () => ({
  md5: vi.fn(async () => "unknown"),
}));

import { readBinary } from "@platform/neutralino";
import { md5 } from "@runtime/patching";
import { GameVersionUnreadableError } from "@src/clients/launch-errors";
import {
  getGameVersion2019,
  getGameVersionWithFallback,
} from "@src/clients/mhy/unity";

const CATEGORY_PATTERN = [
  0x69, 0x63, 0x2e, 0x61, 0x70, 0x70, 0x2d, 0x63, 0x61, 0x74, 0x65, 0x67, 0x6f,
  0x72, 0x79, 0x2e,
];

function viewWithVersion(offset: number, version: string) {
  const bytes = new Uint8Array(0x200);
  bytes.set(CATEGORY_PATTERN, 0);
  new DataView(bytes.buffer).setUint32(offset, version.length, true);
  for (let i = 0; i < version.length; i++) {
    bytes[offset + 4 + i] = version.charCodeAt(i);
  }
  return bytes;
}

const readBinaryMock = vi.mocked(readBinary);
const md5Mock = vi.mocked(md5);

describe("installed version reading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    md5Mock.mockResolvedValue("unknown");
  });

  it("reads the version from the legacy offset first", async () => {
    readBinaryMock.mockResolvedValue(viewWithVersion(0xac, "1.2.3"));

    await expect(getGameVersionWithFallback("/game/Data")).resolves.toBe(
      "1.2.3"
    );
  });

  it("falls back to the default offset when the legacy offset is empty", async () => {
    readBinaryMock.mockResolvedValue(viewWithVersion(0x88, "4.5.6"));

    await expect(getGameVersionWithFallback("/game/Data")).resolves.toBe(
      "4.5.6"
    );
  });

  it("throws the typed unreadable error when the marker is missing", async () => {
    readBinaryMock.mockResolvedValue(new Uint8Array(0x40));

    await expect(
      getGameVersionWithFallback("/game/Data")
    ).rejects.toBeInstanceOf(GameVersionUnreadableError);
  });

  it("parses a 2019-style version string", async () => {
    const bytes = new Uint8Array(0x100);
    bytes.set([0x63, 0x61, 0x74, 0x65, 0x67, 0x6f, 0x72, 0x79], 0);
    bytes.set([0x31, 0x2e, 0x32, 0x2e, 0x33], 10);
    readBinaryMock.mockResolvedValue(bytes);

    await expect(getGameVersion2019("/game/Data")).resolves.toBe("1.2.3");
  });

  it("keeps the 2019 MD5 table when the version marker is absent", async () => {
    readBinaryMock.mockResolvedValue(new Uint8Array(0x40));
    md5Mock.mockResolvedValue("57DAD95088363B87E0C1AB614FE9431C");

    await expect(getGameVersion2019("/game/Data")).resolves.toBe("3.1.0");
  });

  it("throws the typed unreadable error when the 2019 version cannot be parsed", async () => {
    const bytes = new Uint8Array(0x100);
    bytes.set([0x63, 0x61, 0x74, 0x65, 0x67, 0x6f, 0x72, 0x79], 0);
    readBinaryMock.mockResolvedValue(bytes);

    await expect(getGameVersion2019("/game/Data")).rejects.toBeInstanceOf(
      GameVersionUnreadableError
    );
  });
});
