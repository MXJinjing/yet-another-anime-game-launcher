import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  catalogCommit,
  createCatalogRefresh,
  initialCatalog,
  parseCatalogSnapshot,
  parseUpstreamCatalog,
} from "../../src/miyoushe/genshin-catalog";

const upstream = (category: string, id: number) => ({
  data: {
    ChineseSimplified: {
      [category]: { example: { id, name: "样本", rarity: 4 } },
    },
  },
  image: {
    [category]: { example: { mihoyo_icon: "https://example.test/unsafe.png" } },
  },
});
const newCommit = "a".repeat(40);
const now = 2 * 24 * 60 * 60 * 1000;

function gzip(value: unknown) {
  return new Response(new Uint8Array(gzipSync(JSON.stringify(value))));
}

describe("public Genshin item catalog", () => {
  it("ships a verified catalog and ignores external icon hosts", () => {
    expect(
      initialCatalog.items.find(item => item.id === "10000021")
    ).toMatchObject({
      name: "安柏",
      rank: "4",
    });
    expect(
      initialCatalog.items.find(item => item.id === "15502")
    ).toMatchObject({
      name: "阿莫斯之弓",
      rank: "5",
    });
    expect(parseUpstreamCatalog(upstream("weapons", 15502), "weapons")).toEqual(
      [{ id: "15502", name: "样本", rank: "4" }]
    );
  });

  it("checks at most once per day and saves both new files together", async () => {
    const save = vi.fn(async () => undefined);
    const fetch = vi.fn(
      async (input: RequestInfo | URL, _options?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://api.github.com"))
          return new Response(JSON.stringify({ sha: newCommit }));
        if (url.includes("-characters"))
          return gzip(upstream("characters", 10000021));
        return gzip(upstream("weapons", 15502));
      }
    );
    const refresh = createCatalogRefresh(save, fetch);
    const first = refresh(initialCatalog, now);
    expect(refresh(initialCatalog, now)).toBe(first);
    const next = await first;
    expect(next.commit).toBe(newCommit);
    expect(next.items).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(next);
    expect(fetch.mock.calls.slice(1).map(([url]) => String(url))).toEqual([
      `https://cdn.jsdelivr.net/gh/theBowja/genshin-db-dist@${newCommit}/data/gzips/chinesesimplified-characters.min.json.gzip`,
      `https://cdn.jsdelivr.net/gh/theBowja/genshin-db-dist@${newCommit}/data/gzips/chinesesimplified-weapons.min.json.gzip`,
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options).toMatchObject({
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      expect(options?.headers).toBeUndefined();
      expect(options?.body).toBeUndefined();
    }
    expect(await refresh(next, now + 1)).toBe(next);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(["offline", "invalid-commit", "damaged-gzip", "invalid-schema"])(
    "keeps the last usable snapshot after %s",
    async failure => {
      const save = vi.fn(async () => undefined);
      const fetch = vi.fn(async (input: RequestInfo | URL) => {
        if (failure === "offline") throw new TypeError("offline");
        if (String(input).startsWith("https://api.github.com"))
          return new Response(
            JSON.stringify({
              sha: failure === "invalid-commit" ? "../wrong" : newCommit,
            })
          );
        return failure === "damaged-gzip"
          ? new Response("damaged")
          : gzip({ data: {} });
      });
      const next = await createCatalogRefresh(save, fetch)(initialCatalog, now);
      expect(next.items).toBe(initialCatalog.items);
      expect(next).toMatchObject({ commit: catalogCommit, checkedAt: now });
      expect(save).toHaveBeenCalledTimes(1);
    }
  );

  it("rejects corrupt and duplicate cached entries", () => {
    expect(() =>
      parseCatalogSnapshot({ ...initialCatalog, items: [{}] })
    ).toThrow();
    const item = initialCatalog.items[0];
    expect(() =>
      parseCatalogSnapshot({ ...initialCatalog, items: [item, item] })
    ).toThrow();
  });
});
