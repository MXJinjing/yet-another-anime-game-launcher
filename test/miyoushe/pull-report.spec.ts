import { describe, expect, it } from "vitest";
import {
  createPullReport,
  selectReportRows,
} from "../../src/miyoushe/pull-report";
import type { Pull } from "../../src/miyoushe/uigf";

function pull(id: string, rank_type?: string, fields?: Partial<Pull>): Pull {
  return {
    id,
    time: "2024-08-30 12:00:00",
    gacha_type: "302",
    item_id: "100",
    rank_type,
    ...fields,
  };
}

const account = (list: Pull[]) => ({ uid: "123456789", timezone: 8, list });

describe("pull report", () => {
  it("fills a missing rarity from the catalog only for its matching game", () => {
    const missing = pull("2");
    const catalog = new Map([
      ["100", { id: "100", rank: "3", name: "Example" }],
    ]);
    const record = account([pull("1", "5"), missing, pull("3", "5")]);
    const report = createPullReport(record, "hk4e", catalog);
    expect(report.ranked).toBe(3);
    expect(report.top).toBe(2);
    expect(report.pools[0].intervals).toEqual([2]);
    expect(report.pools[0].rows[1].item?.name).toBe("Example");
    expect(
      createPullReport(record, "hkrpg", catalog).pools[0].intervals
    ).toEqual([]);
    expect(missing.rank_type).toBeUndefined();
  });

  it("keeps the chronology and draw distance when filtering multiple rarities", () => {
    const record = account([
      pull("4", "5"),
      pull("2", "3"),
      pull("1", "5"),
      pull("3", "4"),
    ]);
    const [pool] = createPullReport(record, "hk4e").pools;
    expect(
      selectReportRows(pool.rows, ["5", "4"], true).map(row => row.pull.id)
    ).toEqual(["4", "3", "1"]);
    expect(
      selectReportRows(pool.rows, ["5"], false).map(row => row.interval)
    ).toEqual([undefined, 3]);
    expect(selectReportRows(pool.rows, [], true)).toHaveLength(4);
    expect(pool.rows.map(row => row.pull.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("counts only classified featured history and skips uncertain intervals", () => {
    const record = account([
      pull("1", "5", { item_id: "14516" }),
      pull("2", "5"),
      pull("3", "5", { item_id: "11503" }),
      pull("4"),
      pull("5", "5", { item_id: "14516" }),
      pull("6", "5", { time: "2026-11-27 12:00:00" }),
    ]);
    const [pool] = createPullReport(record, "hk4e").pools;
    expect(pool.hits).toBe(3);
    expect(pool.classified).toBe(4);
    expect(pool.topRankCount).toBe(5);
    expect(pool.featuredIntervals).toEqual([2]);
    expect(pool.rows.at(-1)?.featured).toBeUndefined();
    expect(pool.nextGuaranteed).toBeUndefined();
  });

  it("uses original character slots and keeps guarantee chronology independent of display order", () => {
    const fields = { gacha_type: "301", uigf_gacha_type: "301" };
    const [pool] = createPullReport(
      account([
        pull("1", "5", { ...fields, item_id: "10000016" }),
        pull("2", "3", fields),
        pull("3", "5", { ...fields, gacha_type: "400", item_id: "10000047" }),
        pull("4", "5", { ...fields, item_id: "10000102" }),
        pull("5", "4", fields),
      ]),
      "hk4e"
    ).pools;
    expect(pool.pity).toBe(1);
    expect(pool.nextGuaranteed).toBe(false);
    expect(
      selectReportRows(pool.rows, ["5"], true).map(row => [
        row.featured,
        row.guaranteed,
        row.interval,
      ])
    ).toEqual([
      [true, false, 1],
      [true, true, 2],
      [false, undefined, undefined],
    ]);
  });

  it("classifies older CN dates and leaves an ambiguous normalized slot unknown", () => {
    const [pool] = createPullReport(
      account([
        pull("1", "5", {
          time: "2022-03-01 12:00:00",
          gacha_type: "301",
          item_id: "10000058",
        }),
        pull("2", "5", { gacha_type: "301", item_id: "10000047" }),
      ]),
      "hk4e"
    ).pools;
    expect(pool.rows[0].featured).toBe(true);
    expect(pool.rows[1].featured).toBeUndefined();
    expect(pool.nextGuaranteed).toBeUndefined();
  });
});
