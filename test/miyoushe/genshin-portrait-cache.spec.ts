import { afterEach, expect, it, vi } from "vitest";
import { readBinary, writeBinary } from "@platform/neutralino";
import {
  readCachedGenshinPortrait,
  warmGenshinPortraits,
} from "../../src/miyoushe/genshin-portrait-cache";

vi.mock("@platform/neutralino", () => ({
  readBinary: vi.fn(),
  readDirectory: async () => [{ entry: "UI_AvatarIcon_Existing.png" }],
  removeFileIfExists: async () => undefined,
  resolve: (path: string) => path,
  writeBinary: vi.fn(async () => undefined),
}));

afterEach(() => vi.unstubAllGlobals());

it("reuses existing portraits and saves validated public PNGs once per filename", async () => {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
      "base64"
    )
  );
  const existing = "https://enka.network/ui/UI_AvatarIcon_Existing.png";
  const missing =
    "https://upload-os-bbs.mihoyo.com/game_record/genshin/equip/UI_EquipIcon_Sample.png";
  const mirror = "https://enka.network/ui/UI_EquipIcon_Sample.png";
  const request = vi.fn(
    async (url: string, _options: RequestInit) =>
      new Response(url === mirror ? "invalid PNG" : png.buffer)
  );
  vi.stubGlobal("fetch", request);
  const moveFile = vi.fn(async () => undefined);
  vi.stubGlobal("Neutralino", {
    filesystem: { createDirectory: async () => undefined, moveFile },
  });
  vi.mocked(readBinary).mockResolvedValue(png.buffer);
  const items = [existing, missing, mirror].map((icon, index) => ({
    id: String(index + 1),
    icon,
    rank: "4",
    name: "Fixture",
  }));

  await warmGenshinPortraits(items);
  await expect(readCachedGenshinPortrait(existing)).resolves.toMatch(/^blob:/);
  const saved = await readCachedGenshinPortrait(missing);
  expect(saved).toMatch(/^blob:/);
  expect(await readCachedGenshinPortrait(mirror)).toBe(saved);
  expect(request.mock.calls.map(([url]) => url)).toEqual([mirror, missing]);
  expect(request.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    redirect: "error",
  });
  expect(writeBinary).toHaveBeenCalledOnce();
  expect(moveFile).toHaveBeenCalledOnce();
});
