import type { MiyousheGame } from "./games";
import type { CatalogItem } from "./genshin-catalog";
import { genshinFeatured } from "./genshin-rules";
import { summarizePulls, type GachaArchive, type Pull } from "./uigf";

type Account = NonNullable<GachaArchive[MiyousheGame]>[number];

export type PullReportRow = {
  pull: Pull;
  item?: CatalogItem;
  interval?: number;
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
    let sinceFeatured: number | undefined;
    let hits = 0;
    let classified = 0;
    let topRankCount = 0;
    let nextGuaranteed: boolean | undefined;
    const featuredIntervals: number[] = [];
    const rows = pool.pulls.map(pull => {
      const row: PullReportRow = { pull, item: items?.get(pull.item_id) };
      if (!knownRank(pull.rank_type)) {
        sinceTop = undefined;
        sinceFeatured = undefined;
        nextGuaranteed = undefined;
        return row;
      }
      if (sinceTop !== undefined) row.interval = ++sinceTop;
      if (sinceFeatured !== undefined) sinceFeatured++;
      if (pull.rank_type !== "5") return row;

      sinceTop = 0;
      topRankCount++;
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
      topRankCount,
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

export function selectReportRows(
  rows: PullReportRow[],
  ranks: string[],
  newestFirst: boolean
) {
  const visible = rows.filter(
    row => !ranks.length || ranks.includes(row.pull.rank_type ?? "")
  );
  return newestFirst ? visible.reverse() : visible;
}
