import { createMemo, For, Show } from "solid-js";
import { AppModalButton } from "@src/components/app-modal";
import type { MiyousheGame } from "./games";
import type { GachaArchive, summarizePulls } from "./uigf";

type Account = NonNullable<GachaArchive[MiyousheGame]>[number];
type Summary = ReturnType<typeof summarizePulls>;
type Translate = (zh: string, en: string) => string;

const poolNames: Record<MiyousheGame, Record<string, [string, string]>> = {
  hk4e: {
    "100": ["新手祈愿", "Beginner's Wish"],
    "200": ["常驻祈愿", "Standard Wish"],
    "301": ["角色活动祈愿", "Character Event Wish"],
    "302": ["武器活动祈愿", "Weapon Event Wish"],
    "400": ["角色活动祈愿", "Character Event Wish"],
    "500": ["集录祈愿", "Chronicled Wish"],
  },
  hkrpg: {
    "1": ["常驻跃迁", "Regular Warp"],
    "2": ["始发跃迁", "Departure Warp"],
    "11": ["角色活动跃迁", "Character Event Warp"],
    "12": ["光锥活动跃迁", "Light Cone Event Warp"],
    "21": ["联动角色跃迁", "Collaboration Character Warp"],
    "22": ["联动光锥跃迁", "Collaboration Light Cone Warp"],
  },
  nap: {
    "1": ["常驻频段", "Stable Channel"],
    "2": ["独家频段", "Exclusive Channel"],
    "3": ["音擎频段", "W-Engine Channel"],
    "5": ["邦布频段", "Bangboo Channel"],
  },
};

export function PullDashboard(props: {
  t: Translate;
  game: MiyousheGame;
  accounts: Account[];
  account: Account;
  summary: Summary;
  pool: Summary["pools"][number] | undefined;
  visiblePulls: number;
  onAccountChange: (uid: string) => void;
  onPoolChange: (type: string) => void;
  onShowMore: () => void;
}) {
  const t = props.t;
  const topRankLabel = () =>
    props.game === "nap" ? t("S 级", "S rank") : t("五星", "5-star");
  const poolLabel = (type: string) => {
    const names = poolNames[props.game][type];
    return names ? t(...names) : t("卡池 ", "Pool ") + type;
  };
  const count = new Intl.NumberFormat();
  const topRankCount = createMemo(() =>
    props.account.list.reduce(
      (total, pull) => total + Number(pull.rank_type === "5"),
      0
    )
  );
  const rankedCount = createMemo(
    () =>
      props.account.list.filter(
        pull => pull.rank_type && /^[345]$/.test(pull.rank_type)
      ).length
  );
  const intervals = () => props.pool?.intervals ?? [];
  const latest = () => intervals().slice(-12);
  const max = () => Math.max(1, ...latest());
  const average = () => {
    const values = intervals();
    return values.length
      ? (
          values.reduce((sum, interval) => sum + interval, 0) / values.length
        ).toFixed(1)
      : "—";
  };
  const rankLabel = (rank: string | undefined) => {
    if (!rank) return "—";
    if (props.game === "nap") {
      const labels: Record<string, string> = { "5": "S", "4": "A", "3": "B" };
      return labels[rank] ?? rank;
    }
    return rank + "★";
  };

  return (
    <>
      <div class="miyoushe-scope">
        <label class="miyoushe-field">
          UID
          <select
            value={props.account.uid}
            onChange={event => props.onAccountChange(event.currentTarget.value)}
          >
            <For each={props.accounts}>
              {account => <option value={account.uid}>{account.uid}</option>}
            </For>
          </select>
        </label>
        <Show when={props.summary.first}>
          <span class="miyoushe-muted">
            {props.summary.first?.slice(0, 10)} —{" "}
            {props.summary.last?.slice(0, 10)} · UTC
            {props.account.timezone >= 0 ? "+" : ""}
            {props.account.timezone}
          </span>
        </Show>
      </div>

      <div class="miyoushe-metrics">
        <div class="miyoushe-metric">
          <span>{t("已导入抽数", "Imported pulls")}</span>
          <strong>{count.format(props.account.list.length)}</strong>
          <small>
            {props.summary.pools.length} {t("个卡池", "pools")}
          </small>
        </div>
        <div class="miyoushe-metric miyoushe-metric--gold">
          <span>
            {t("已记录", "Recorded ")}
            {topRankLabel()}
          </span>
          <strong>{rankedCount() ? count.format(topRankCount()) : "—"}</strong>
          <small>
            {rankedCount() === props.account.list.length && rankedCount()
              ? t("所有卡池合计", "Across all pools")
              : t("仅统计已知稀有度", "Known rarity only")}
          </small>
        </div>
        <div class="miyoushe-metric">
          <span>
            {t("当前卡池平均出货间隔", "Average interval in selected pool")}
          </span>
          <strong>{average()}</strong>
          <small>
            {intervals().length
              ? intervals().length + t(" 段已记录间隔", " recorded intervals")
              : t("暂无可计算的间隔", "No observed intervals")}
          </small>
        </div>
      </div>

      <Show
        when={props.pool}
        fallback={
          <p class="miyoushe-muted">
            {t("此 UID 尚无抽卡记录。", "This UID has no pull records yet.")}
          </p>
        }
      >
        {pool => (
          <>
            <div
              class="miyoushe-pool-picker"
              role="group"
              aria-label={t("卡池", "Pools")}
            >
              <For each={props.summary.pools}>
                {entry => (
                  <button
                    type="button"
                    aria-pressed={pool().type === entry.type}
                    onClick={() => props.onPoolChange(entry.type)}
                  >
                    {poolLabel(entry.type)}{" "}
                    <span>{count.format(entry.pulls.length)}</span>
                  </button>
                )}
              </For>
            </div>

            <div class="miyoushe-details">
              <section class="miyoushe-card miyoushe-intervals">
                <div class="miyoushe-section-heading">
                  <h3>{t("出货间隔", "Pull intervals")}</h3>
                  <span>
                    {t("最近 12 段 · 以抽数计", "Latest 12 · in pulls")}
                  </span>
                </div>
                <Show
                  when={latest().length}
                  fallback={
                    <p class="miyoushe-muted">
                      {t(
                        "此卡池还没有两次可用于计算间隔的最高稀有度记录。",
                        "This pool does not yet have two eligible top-rank pulls to calculate an interval."
                      )}
                    </p>
                  }
                >
                  <ol
                    class="miyoushe-chart"
                    aria-label={t(
                      "出货间隔，从旧到新",
                      "Pull intervals from oldest to newest"
                    )}
                  >
                    <For each={latest()}>
                      {interval => (
                        <li>
                          <strong>{interval}</strong>
                          <span
                            aria-hidden="true"
                            style={{ height: (interval / max()) * 54 + "px" }}
                          />
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
                <p class="miyoushe-muted">
                  {t(
                    "按本地导入记录计算，遗漏的抽卡可能影响间隔。",
                    "Intervals use imported records. Missing pulls can affect them."
                  )}
                </p>
              </section>

              <section class="miyoushe-card miyoushe-history">
                <div class="miyoushe-section-heading">
                  <h3>{t("抽卡记录", "Pull history")}</h3>
                  <span>{poolLabel(pool().type)}</span>
                </div>
                <div class="miyoushe-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t("获得物品", "Item")}</th>
                        <th scope="col">{t("稀有度", "Rarity")}</th>
                        <th scope="col">{t("抽取时间", "Time")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For
                        each={pool().pulls.slice(-props.visiblePulls).reverse()}
                      >
                        {pull => (
                          <tr>
                            <td>{pull.name || pull.item_id}</td>
                            <td>
                              <span
                                class="miyoushe-rank"
                                data-rank={pull.rank_type}
                              >
                                {rankLabel(pull.rank_type)}
                              </span>
                            </td>
                            <td>
                              <time datetime={pull.time.replace(" ", "T")}>
                                {pull.time}
                              </time>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <Show when={pool().pulls.length > props.visiblePulls}>
                  <AppModalButton onClick={props.onShowMore}>
                    {t("加载更早的记录", "Show older pulls")}
                  </AppModalButton>
                </Show>
              </section>
            </div>
          </>
        )}
      </Show>
    </>
  );
}
