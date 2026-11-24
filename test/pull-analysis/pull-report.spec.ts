import { describe, expect, it } from "vitest";
import {
  createPullReport,
  groupPullCycles,
  pagePullHistory,
  pullTiming,
} from "../../src/pull-analysis/pull-report";
import type { Pull } from "../../src/pull-analysis/uigf";

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

  it("keeps the chronology and draw distance between five-star cycles", () => {
    const record = account([
      pull("4", "5"),
      pull("2", "3"),
      pull("1", "5"),
      pull("3", "4"),
    ]);
    const [pool] = createPullReport(record, "hk4e").pools;
    const { cycles } = groupPullCycles(pool.rows);
    expect(cycles.map(cycle => cycle.result.pull.id)).toEqual(["1", "4"]);
    expect(cycles.map(cycle => cycle.result.interval)).toEqual([undefined, 3]);
    expect(pool.rows.map(row => row.pull.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("counts four-star intervals independently of five-star results and display order", () => {
    const [pool] = createPullReport(
      account([
        pull("1", "4"),
        pull("2", "5"),
        pull("3", "3"),
        pull("4", "4"),
        pull("5"),
        pull("6", "4"),
      ]),
      "hk4e"
    ).pools;
    expect(
      pool.rows
        .filter(row => row.pull.rank_type === "4")
        .reverse()
        .map(row => row.fourStarInterval)
    ).toEqual([undefined, 3, undefined]);
  });

  it("colors the distance relative to the known pool limit", () => {
    expect(
      [30, 31, 68, 91, undefined].map(value => pullTiming(value, 90))
    ).toEqual(["early", "middle", "late", "unknown", "unknown"]);
    expect(pullTiming(9)).toBe("unknown");
  });

  it("keeps four-star cards under the five-star result that ends their interval", () => {
    const [pool] = createPullReport(
      account([
        pull("7", "4"),
        pull("1", "4"),
        pull("2", "5"),
        pull("3", "4"),
        pull("4", "3"),
        pull("5", "5"),
        pull("6", "3"),
      ]),
      "hk4e"
    ).pools;
    const { cycles, ongoing } = groupPullCycles(pool.rows);
    expect(
      cycles.map(({ result, fourths }) => [
        result.pull.id,
        fourths.map(row => row.pull.id),
      ])
    ).toEqual([
      ["2", ["1"]],
      ["5", ["3"]],
    ]);
    expect(ongoing).toMatchObject({ count: 2, complete: true });
    expect(ongoing.fourths.map(row => row.pull.id)).toEqual(["7"]);
  });

  it("shows only a lower bound without a known latest five-star boundary", () => {
    const ongoing = (list: Pull[]) =>
      groupPullCycles(createPullReport(account(list), "hk4e").pools[0].rows)
        .ongoing;
    expect(ongoing([pull("1", "5")])).toMatchObject({
      count: 0,
      complete: true,
    });
    expect(ongoing([pull("1", "4"), pull("2", "3")])).toMatchObject({
      count: 2,
      complete: false,
    });
    expect(ongoing([pull("1", "5"), pull("2"), pull("3", "3")])).toMatchObject({
      count: 1,
      complete: false,
    });
  });

  it("pages the chosen pool newest first in groups of ten", () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      pull(String(index + 1), "3")
    );
    const [character, weapon] = createPullReport(
      account([...records, pull("13", "5", { gacha_type: "301" })]),
      "hk4e"
    ).pools;
    const pageIds = (data: ReturnType<typeof pagePullHistory>) =>
      data.rows.map(row => row.pull.id);
    expect(pageIds(pagePullHistory(weapon.rows, 1))).toEqual([
      "12",
      "11",
      "10",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
    ]);
    expect(pageIds(pagePullHistory(weapon.rows, 2))).toEqual(["2", "1"]);
    expect(pagePullHistory(weapon.rows, 30)).toMatchObject({
      page: 2,
      pageCount: 2,
    });
    expect(pageIds(pagePullHistory(character.rows, 1))).toEqual(["13"]);
    expect(weapon.rows.map(row => row.pull.id).slice(0, 2)).toEqual(["1", "2"]);
  });

  it("defaults to character, weapon and standard pools in that order for Hk4e", () => {
    const list = ["200", "100", "302", "500", "301"].map((gacha_type, index) =>
      pull(String(index + 1), "5", { gacha_type })
    );
    expect(
      createPullReport(account(list), "hk4e").pools.map(pool => pool.type)
    ).toEqual(["301", "302", "200", "500", "100"]);
    expect(
      createPullReport(account(list), "hkrpg").pools.map(pool => pool.type)
    ).toEqual(["200", "100", "302", "500", "301"]);
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
      groupPullCycles(pool.rows)
        .cycles.reverse()
        .map(({ result: row }) => [row.featured, row.guaranteed, row.interval])
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
