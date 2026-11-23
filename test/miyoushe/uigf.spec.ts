import { describe, expect, it } from "vitest";
import { miyousheGameForChannel } from "../../src/miyoushe/games";
import {
  exportUigf,
  mergeGachaArchives,
  parseUigf,
  selectGamePullArchive,
  summarizePulls,
} from "../../src/miyoushe/uigf";

const info = { version: "v4.2" };
const pull = {
  id: "1900100000000000001",
  item_id: "1001",
  time: "2026-11-03 12:00:00",
  gacha_type: "301",
  rank_type: "5",
  uigf_gacha_type: "301",
};
const account = { uid: "123456789", timezone: 8, list: [pull] };

describe("UIGF v4.2", () => {
  it("round-trips an archive containing three games and multiple accounts", () => {
    const archive = parseUigf(
      JSON.stringify({
        info,
        hk4e: [account, { ...account, uid: 987654321, lang: "zh-cn" }],
        hkrpg: [
          {
            ...account,
            list: [{ ...pull, gacha_type: "11", gacha_id: "11001" }],
          },
        ],
        nap: [{ ...account, list: [{ ...pull, gacha_type: "2" }] }],
      })
    );
    expect(archive.hk4e?.map(entry => entry.uid)).toEqual([
      "123456789",
      "987654321",
    ]);
    expect(parseUigf(exportUigf(archive))).toEqual(archive);
  });

  it("merges by game, UID and pull ID without overwriting existing history", () => {
    const original = parseUigf(JSON.stringify({ info, hk4e: [account] }));
    const incoming = parseUigf(
      JSON.stringify({
        info,
        hk4e: [
          {
            ...account,
            timezone: 0,
            list: [
              { ...pull, rank_type: "4", name: "New metadata" },
              {
                ...pull,
                id: "1900100000000000002",
                time: "2026-11-04 12:00:00",
              },
            ],
          },
        ],
        nap: [account],
      })
    );
    const merged = mergeGachaArchives(original, incoming);
    expect(merged.hk4e?.[0].list).toEqual([
      { ...pull, name: "New metadata" },
      { ...pull, id: "1900100000000000002", time: "2026-11-04 20:00:00" },
    ]);
    expect(mergeGachaArchives(merged, incoming)).toEqual(merged);
    expect(original.hk4e?.[0].list).toEqual([pull]);
    expect(merged.nap?.[0].list).toHaveLength(1);
  });

  it("preserves the latest local update time per UID and omits it from exchange files", () => {
    const first = { ...account, updatedAt: 1_800_000_000_000 };
    const second = {
      ...account,
      uid: "987654321",
      updatedAt: 1_800_000_000_001,
    };
    const newer = { ...first, updatedAt: 1_800_000_000_002 };
    const merged = mergeGachaArchives(
      { hk4e: [first, second] },
      { hk4e: [newer, first] }
    );

    const localArchive = exportUigf(merged, true);
    expect(parseUigf(localArchive, true).hk4e).toEqual([newer, second]);
    expect(parseUigf(localArchive).hk4e?.[0].updatedAt).toBeUndefined();
    expect(
      parseUigf(exportUigf(merged), true).hk4e?.map(entry => entry.updatedAt)
    ).toEqual([undefined, undefined]);
  });

  it("exports a selected UID from only the requested game, or all UIDs for that game", () => {
    const second = { ...account, uid: "987654321" };
    const archive = { hk4e: [account, second], nap: [second] };
    const single = selectGamePullArchive(archive, "hk4e", second.uid);
    const all = selectGamePullArchive(archive, "hk4e");
    expect(parseUigf(exportUigf(single!))).toEqual({ hk4e: [second] });
    expect(parseUigf(exportUigf(all!))).toEqual({ hk4e: [account, second] });
    expect(selectGamePullArchive(archive, "nap", account.uid)).toBeUndefined();
  });

  it.each([
    { info: { version: "v3.0" }, hk4e: [account] },
    { info, hk4e: [{ ...account, uid: Number.MAX_SAFE_INTEGER + 1 }] },
    { info, hk4e: [{ ...account, timezone: "8" }] },
    {
      info,
      hk4e: [{ ...account, list: [{ ...pull, time: "2026-02-30 12:00:00" }] }],
    },
    { info, hk4e: [{ ...account, list: [{ ...pull, id: 12345 }] }] },
    { info, hkrpg: [account] },
    { info, hk4e: [{}] },
    { info, hk4e: [account], nap: {} },
    { info },
  ])("rejects invalid data before it can be merged %#", value => {
    expect(() => parseUigf(JSON.stringify(value))).toThrow();
  });

  it("uses only complete observed intervals within a pool and sorts large IDs precisely", () => {
    const summary = summarizePulls({
      ...account,
      list: [
        { ...pull, id: "1900100000000000005" },
        {
          ...pull,
          id: "1900100000000000003",
          rank_type: "3",
          gacha_type: "400",
        },
        { ...pull, id: "1900100000000000006", rank_type: undefined },
        { ...pull, id: "1900100000000000007" },
        pull,
        { ...pull, id: "1900100000000000004", uigf_gacha_type: "302" },
      ],
    });
    expect(summary.pools.map(pool => [pool.type, pool.intervals])).toEqual([
      ["301", [2]],
      ["302", []],
    ]);
    expect(summary.first).toBe(pull.time);
  });
});

describe("Miyoushe channels", () => {
  it.each([
    ["hk4ecn", "hk4e"],
    ["hkrpgcn", "hkrpg"],
    ["napcn", "nap"],
  ])("includes %s in CN and standalone apps", (channel, game) => {
    expect(miyousheGameForChannel("mhycn", channel)).toBe(game);
    expect(miyousheGameForChannel(channel, channel)).toBe(game);
    expect(miyousheGameForChannel("all", channel)).toBeUndefined();
  });

  it.each(["hk4eos", "hk4euniversal", "cbjqcn", "bh3glb"])(
    "does not expose the panel for %s",
    channel => expect(miyousheGameForChannel(channel, channel)).toBeUndefined()
  );
});
