import type { MiyousheGame } from "./games";
import type { CatalogItem } from "./genshin-catalog";
import { genshinFeatured } from "./genshin-rules";
import { summarizePulls, type GachaArchive, type Pull } from "./uigf";

type Account = NonNullable<GachaArchive[MiyousheGame]>[number];

export type PullReportRow = {
  pull: Pull;
  item?: CatalogItem;
  interval?: number;
  fourStarInterval?: number;
  featured?: boolean;
  guaranteed?: boolean;
};

const knownRank = (rank?: string) => /^[345]$/.test(rank ?? "");

export function createPullReport(
  account: Account,
  game: MiyousheGame,
  catalog?: ReadonlyMap<string, CatalogItem>
) {
  const items = game === "hk4e" ? catalog : undefined;
  const list = items
    ? account.list.map(pull => {
        if (knownRank(pull.rank_type)) return pull;
        const rank = items.get(pull.item_id)?.rank;
        return knownRank(rank) ? { ...pull, rank_type: rank } : pull;
      })
    : account.list;
  const summary = summarizePulls({ ...account, list });
  const pools = summary.pools.map(pool => {
    let sinceTop: number | undefined;
    let sinceFour: number | undefined;
    let sinceFeatured: number | undefined;
    let hits = 0;
    let classified = 0;
    let nextGuaranteed: boolean | undefined;
    const featuredIntervals: number[] = [];
    const rows = pool.pulls.map(pull => {
      const row: PullReportRow = { pull, item: items?.get(pull.item_id) };
      if (!knownRank(pull.rank_type)) {
        sinceTop = undefined;
        sinceFour = undefined;
        sinceFeatured = undefined;
        nextGuaranteed = undefined;
        return row;
      }
      if (sinceTop !== undefined) row.interval = ++sinceTop;
      if (sinceFeatured !== undefined) sinceFeatured++;
      if (sinceFour !== undefined) sinceFour++;
      if (pull.rank_type === "4") {
        row.fourStarInterval = sinceFour;
        sinceFour = 0;
      }
      if (pull.rank_type !== "5") return row;

      sinceTop = 0;
      row.guaranteed = nextGuaranteed;
      if (game === "hk4e")
        row.featured = genshinFeatured(pull, account.timezone);
      if (row.featured === undefined) {
        nextGuaranteed = undefined;
        sinceFeatured = undefined;
      } else {
        nextGuaranteed = !row.featured;
        classified++;
        if (row.featured) {
          hits++;
          if (sinceFeatured !== undefined)
            featuredIntervals.push(sinceFeatured);
          sinceFeatured = 0;
        }
      }
      return row;
    });
    return {
      ...pool,
      rows,
      hits,
      classified,
      featuredIntervals,
      nextGuaranteed,
    };
  });
  return {
    ...summary,
    pools,
    ranked: list.filter(pull => knownRank(pull.rank_type)).length,
    top: list.filter(pull => pull.rank_type === "5").length,
  };
}

export function pullTiming(interval?: number, hardPity?: number) {
  if (interval === undefined || !hardPity || interval > hardPity)
    return "unknown";
  if (interval / hardPity <= 1 / 3) return "early";
  if (interval / hardPity >= 0.75) return "late";
  return "middle";
}

export function groupPullCycles(rows: PullReportRow[]) {
  const cycles: { result: PullReportRow; fourths: PullReportRow[] }[] = [];
  let fourths: PullReportRow[] = [];
  let count = 0;
  let complete = false;
  for (const row of rows) {
    const rank = row.pull.rank_type;
    if (rank === "5") {
      cycles.push({ result: row, fourths });
      fourths = [];
      count = 0;
      complete = true;
    } else if (knownRank(rank)) {
      if (rank === "4") fourths.push(row);
      count++;
    } else {
      count = 0;
      complete = false;
    }
  }
  return { cycles, ongoing: { count, complete, fourths } };
}

export function pagePullHistory(rows: PullReportRow[], requestedPage: number) {
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  // Pool rows are oldest first. Take only the requested window before reversing.
  const end = rows.length - (page - 1) * pageSize;
  return {
    page,
    pageCount,
    rows: rows.slice(Math.max(0, end - pageSize), end).reverse(),
  };
}
