import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { AppModalButton } from "@src/components/app-modal";
import type { MiyousheGame } from "./games";
import type { CatalogItem } from "./genshin-catalog";
import { genshinPoolRule } from "./genshin-rules";
import {
  createPullReport,
  selectReportRows,
  type PullReportRow,
} from "./pull-report";
import type { GachaArchive, summarizePulls } from "./uigf";

type Account = NonNullable<GachaArchive[MiyousheGame]>[number];
type Summary = ReturnType<typeof summarizePulls>;
type Translate = (zh: string, en: string) => string;
type View = "text" | "images" | "bars";

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

const views: ReadonlyArray<readonly [View, string, string]> = [
  ["text", "文字", "Text"],
  ["images", "图像", "Images"],
  ["bars", "条形", "Bars"],
];

function average(values: number[]) {
  return values.length
    ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)
    : "—";
}

export function PullDashboard(props: {
  t: Translate;
  game: MiyousheGame;
  accounts: Account[];
  account: Account;
  summary: Summary;
  pool: Summary["pools"][number] | undefined;
  catalog?: ReadonlyMap<string, CatalogItem>;
  visiblePulls: number;
  onAccountChange: (uid: string) => void;
  onPoolChange: (type: string) => void;
  onShowMore: () => void;
}) {
  const t = props.t;
  const count = new Intl.NumberFormat();
  const [view, setView] = createSignal<View>("text");
  const [ranks, setRanks] = createSignal<string[]>([]);
  const [newestFirst, setNewestFirst] = createSignal(true);
  const [showTags, setShowTags] = createSignal(true);
  const report = createMemo(() =>
    createPullReport(props.account, props.game, props.catalog)
  );
  const pool = createMemo(() =>
    report().pools.find(entry => entry.type === props.pool?.type)
  );
  const poolLabel = (type: string) => {
    const names = poolNames[props.game][type];
    return names ? t(...names) : t("卡池 ", "Pool ") + type;
  };
  const topRank = () =>
    props.game === "nap" ? t("S 级", "S rank") : t("五星", "5-star");
  const rankLabel = (rank?: string) => {
    if (!rank) return "—";
    return props.game === "nap"
      ? ({ "5": "S", "4": "A", "3": "B" } as Record<string, string>)[rank] ??
          rank
      : rank + "★";
  };
  const sources = () =>
    (props.account.sources?.length ? props.account.sources : ["file"])
      .map(source =>
        source === "game"
          ? t("游戏记录", "Game history")
          : t("UIGF 文件", "UIGF file")
      )
      .join(" · ");
  const poolRanks = createMemo(() =>
    [...new Set(pool()?.rows.map(row => row.pull.rank_type ?? ""))]
      .sort()
      .reverse()
  );
  const filtered = createMemo(() =>
    selectReportRows(pool()?.rows ?? [], ranks(), newestFirst())
  );
  const rows = createMemo(() => filtered().slice(0, props.visiblePulls));
  const latestIntervals = createMemo(() =>
    (pool()?.rows ?? [])
      .filter(row => row.pull.rank_type === "5" && row.interval !== undefined)
      .slice(-12)
      .reverse()
  );
  const intervalMax = () =>
    Math.max(
      rule()?.hardPity ?? 1,
      ...latestIntervals().map(row => row.interval!)
    );
  const barMax = createMemo(
    () =>
      pool()?.rows.reduce((max, row) => Math.max(max, row.interval ?? 0), 1) ??
      1
  );
  const rule = () =>
    props.game === "hk4e"
      ? genshinPoolRule(
          pool()?.type ?? "",
          pool()?.pulls.at(-1)?.time,
          props.account.timezone
        )
      : undefined;
  const supportsFeatured = () =>
    props.game === "hk4e" && ["301", "302"].includes(pool()?.type ?? "");

  function name(row: PullReportRow) {
    const catalogName = row.item?.name;
    return (
      (t("zh", "en") === "zh" && catalogName) ||
      row.pull.name ||
      catalogName ||
      row.pull.item_id
    );
  }

  function Rank(props: { row: PullReportRow }) {
    return (
      <span class="miyoushe-rank" data-rank={props.row.pull.rank_type}>
        {rankLabel(props.row.pull.rank_type)}
      </span>
    );
  }

  function Featured(props: { row: PullReportRow }) {
    return (
      <Show
        when={
          showTags() && props.row.pull.rank_type === "5" && supportsFeatured()
        }
      >
        <span
          class="miyoushe-featured-tag"
          data-featured={String(props.row.featured)}
        >
          {props.row.featured === true
            ? "UP"
            : props.row.featured === false
            ? t("非 UP", "Off-banner")
            : t("UP 未知", "UP unknown")}
        </span>
      </Show>
    );
  }

  function PullTime(props: { row: PullReportRow }) {
    return (
      <time datetime={props.row.pull.time.replace(" ", "T")}>
        {props.row.pull.time}
      </time>
    );
  }

  function ItemImage(props: { row: PullReportRow }) {
    const [failed, setFailed] = createSignal<string>();
    return (
      <div class="miyoushe-item-image" data-rank={props.row.pull.rank_type}>
        <Show
          when={props.row.item?.icon !== failed() && props.row.item?.icon}
          fallback={
            <span aria-hidden="true">
              {rankLabel(props.row.pull.rank_type)}
            </span>
          }
        >
          {icon => (
            <img
              src={icon()}
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              onError={() => setFailed(icon())}
            />
          )}
        </Show>
      </div>
    );
  }

  return (
    <>
      <div class="miyoushe-scope">
        <label class="miyoushe-field">
          UID
          <select
            value={props.account.uid}
            onChange={event => {
              props.onAccountChange(event.currentTarget.value);
              setRanks([]);
            }}
          >
            <For each={props.accounts}>
              {account => <option value={account.uid}>{account.uid}</option>}
            </For>
          </select>
        </label>
        <div class="miyoushe-report-source miyoushe-muted">
          <span>{sources()}</span>
          <Show when={props.summary.first}>
            <span>
              {props.summary.first?.slice(0, 10)} —{" "}
              {props.summary.last?.slice(0, 10)} · UTC
              {props.account.timezone >= 0 ? "+" : ""}
              {props.account.timezone}
            </span>
          </Show>
        </div>
      </div>

      <div class="miyoushe-metrics">
        <div class="miyoushe-metric">
          <span>{t("已记录抽数", "Recorded pulls")}</span>
          <strong>{count.format(props.account.list.length)}</strong>
          <small>
            {props.summary.pools.length} {t("个卡池", "pools")}
          </small>
        </div>
        <div class="miyoushe-metric miyoushe-metric--gold">
          <span>
            {t("已记录", "Recorded ")}
            {topRank()}
          </span>
          <strong>{report().ranked ? count.format(report().top) : "—"}</strong>
          <small>{t("仅统计已知稀有度", "Known rarity only")}</small>
        </div>
        <div class="miyoushe-metric">
          <span>
            {t("当前卡池平均出货间隔", "Average interval in selected pool")}
          </span>
          <strong>{average(pool()?.intervals ?? [])}</strong>
          <small>
            {pool()?.intervals.length ?? 0}{" "}
            {t("段已记录间隔", "recorded intervals")}
          </small>
        </div>
      </div>

      <Show
        when={pool()}
        fallback={
          <p class="miyoushe-muted">
            {t("此 UID 尚无抽卡记录。", "This UID has no pull records yet.")}
          </p>
        }
      >
        {active => (
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
                    aria-pressed={active().type === entry.type}
                    onClick={() => {
                      props.onPoolChange(entry.type);
                      setRanks([]);
                    }}
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
                  <span>{t("最近 12 段 · 抽数", "Latest 12 · pulls")}</span>
                </div>
                <Show
                  when={latestIntervals().length}
                  fallback={
                    <p class="miyoushe-muted">
                      {t(
                        "暂无可计算的出货间隔。",
                        "No observed intervals yet."
                      )}
                    </p>
                  }
                >
                  <ol
                    class="miyoushe-chart"
                    aria-label={t(
                      "出货间隔，从新到旧",
                      "Pull intervals from newest to oldest"
                    )}
                  >
                    <For each={latestIntervals()}>
                      {row => (
                        <li>
                          <span class="miyoushe-chart-label" title={name(row)}>
                            {name(row)}
                          </span>
                          <span
                            class="miyoushe-bar-track"
                            data-rank="5"
                            aria-hidden="true"
                          >
                            <span
                              style={{
                                width:
                                  ((row.interval ?? 0) / intervalMax()) * 100 +
                                  "%",
                              }}
                            />
                          </span>
                          <strong>{row.interval}</strong>
                        </li>
                      )}
                    </For>
                  </ol>
                </Show>
              </section>
              <section class="miyoushe-card miyoushe-pool-summary">
                <div class="miyoushe-section-heading">
                  <h3>{t("卡池统计", "Pool statistics")}</h3>
                  <span>{t("按本地记录计算", "From local records")}</span>
                </div>
                <dl class="miyoushe-pool-metrics">
                  <div>
                    <dt>{t("当前垫数", "Observed pity")}</dt>
                    <dd>{active().pity ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>
                      {t("已记录", "Recorded ")}
                      {topRank()}
                    </dt>
                    <dd>{active().topRankCount}</dd>
                  </div>
                  <Show when={supportsFeatured()}>
                    <div>
                      <dt>{t("UP 命中率", "UP hit rate")}</dt>
                      <dd>
                        {active().classified
                          ? count.format(
                              Math.round(
                                (active().hits / active().classified) * 100
                              )
                            ) + "%"
                          : "—"}
                      </dd>
                      <small>
                        {active().classified}/{active().topRankCount}{" "}
                        {t("次可判定", "classified")}
                      </small>
                    </div>
                    <div>
                      <dt>{t("平均 UP 间隔", "Average UP interval")}</dt>
                      <dd>{average(active().featuredIntervals)}</dd>
                    </div>
                  </Show>
                </dl>

                <p class="miyoushe-muted">
                  {t(
                    "垫数从最近一次出货算起，历史缺失可能影响结果。",
                    "Pity counts from the latest recorded top-rank pull. Gaps may affect it."
                  )}
                </p>
                <details class="miyoushe-pool-rules">
                  <summary>
                    {t("保底规则与估算", "Pity rules and estimates")}
                  </summary>
                  <Show
                    when={rule()}
                    fallback={
                      <p class="miyoushe-muted">
                        {t(
                          "此卡池暂无已核对的保底规则。",
                          "Pity rules for this pool are unavailable."
                        )}
                      </p>
                    }
                  >
                    {known => (
                      <>
                        <p>
                          {t("最高稀有度保底", "Top-rank hard pity")} ·{" "}
                          {known().hardPity} {t("抽", "pulls")}
                        </p>
                        <Show
                          when={
                            active().pity !== undefined &&
                            active().pity! < known().hardPity
                          }
                        >
                          <p class="miyoushe-muted">
                            {t(
                              "若记录完整，距离下次出货最多",
                              "With complete records, the next top rank is at most"
                            )}{" "}
                            {known().hardPity - active().pity!}{" "}
                            {t("抽。", "pulls away.")}
                          </p>
                        </Show>
                        <Show when={known().radiance}>
                          <p class="miyoushe-muted">
                            {t(
                              "捕获明光触发状态无法从现有记录判定。",
                              "Capturing Radiance status cannot be determined from this history."
                            )}
                          </p>
                        </Show>
                      </>
                    )}
                  </Show>
                </details>
              </section>

              <section class="miyoushe-card miyoushe-history">
                <div class="miyoushe-section-heading">
                  <h3>{t("抽卡记录", "Pull history")}</h3>
                  <span>
                    {count.format(filtered().length)} /{" "}
                    {count.format(active().pulls.length)}
                  </span>
                </div>
                <div class="miyoushe-history-toolbar">
                  <div
                    class="miyoushe-pool-picker"
                    role="group"
                    aria-label={t("显示方式", "View mode")}
                  >
                    <For each={views}>
                      {([id, zh, en]) => (
                        <button
                          type="button"
                          aria-pressed={view() === id}
                          onClick={() => setView(id)}
                        >
                          {t(zh, en)}
                        </button>
                      )}
                    </For>
                  </div>
                  <select
                    aria-label={t("时间排序", "Time order")}
                    value={newestFirst() ? "new" : "old"}
                    onChange={event =>
                      setNewestFirst(event.currentTarget.value === "new")
                    }
                  >
                    <option value="new">{t("由新到旧", "Newest first")}</option>
                    <option value="old">{t("由旧到新", "Oldest first")}</option>
                  </select>
                </div>

                <div class="miyoushe-history-toolbar">
                  <div
                    class="miyoushe-pool-picker"
                    role="group"
                    aria-label={t("按稀有度筛选", "Filter by rarity")}
                  >
                    <button
                      type="button"
                      aria-pressed={!ranks().length}
                      onClick={() => setRanks([])}
                    >
                      {t("全部", "All")}
                    </button>
                    <For each={poolRanks()}>
                      {rank => (
                        <button
                          type="button"
                          aria-pressed={ranks().includes(rank)}
                          onClick={() =>
                            setRanks(current =>
                              current.includes(rank)
                                ? current.filter(value => value !== rank)
                                : [...current, rank]
                            )
                          }
                        >
                          {rank ? rankLabel(rank) : t("未知", "Unknown")}
                        </button>
                      )}
                    </For>
                  </div>
                  <Show when={supportsFeatured()}>
                    <label class="miyoushe-field">
                      <input
                        type="checkbox"
                        checked={showTags()}
                        onChange={event =>
                          setShowTags(event.currentTarget.checked)
                        }
                      />
                      {t("UP 标签", "UP labels")}
                    </label>
                  </Show>
                </div>

                <Show
                  when={rows().length}
                  fallback={
                    <p class="miyoushe-muted" role="status">
                      {t(
                        "没有符合筛选条件的记录。",
                        "No records match the filters."
                      )}
                    </p>
                  }
                >
                  <Switch>
                    <Match when={view() === "images"}>
                      <ul class="miyoushe-image-history">
                        <For each={rows()}>
                          {row => (
                            <li>
                              <ItemImage row={row} />
                              <strong title={name(row)}>{name(row)}</strong>
                              <div class="miyoushe-record-labels">
                                <Rank row={row} />
                                <Featured row={row} />
                              </div>
                              <PullTime row={row} />
                            </li>
                          )}
                        </For>
                      </ul>
                    </Match>
                    <Match when={view() === "bars"}>
                      <p class="miyoushe-muted">
                        {t(
                          "条形长度表示距离上次出货的已记录抽数。",
                          "Bar length shows recorded pulls since the last top-rank pull."
                        )}
                      </p>
                      <ol class="miyoushe-bar-history">
                        <For each={rows()}>
                          {row => (
                            <li>
                              <div class="miyoushe-bar-record">
                                <strong title={name(row)}>{name(row)}</strong>
                                <div class="miyoushe-record-labels">
                                  <Rank row={row} />
                                  <Featured row={row} />
                                </div>
                              </div>
                              <div class="miyoushe-bar-record">
                                <span
                                  aria-hidden="true"
                                  class="miyoushe-bar-track"
                                  data-rank={row.pull.rank_type}
                                >
                                  <span
                                    style={{
                                      width:
                                        ((row.interval ?? 0) / barMax()) * 100 +
                                        "%",
                                    }}
                                  />
                                </span>
                                <span
                                  aria-label={t(
                                    "距上次出货的抽数",
                                    "Pulls since the last top-rank pull"
                                  )}
                                >
                                  {row.interval ?? "—"}
                                </span>
                              </div>
                              <PullTime row={row} />
                            </li>
                          )}
                        </For>
                      </ol>
                    </Match>
                    <Match when={view() === "text"}>
                      <div class="miyoushe-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">{t("获得物品", "Item")}</th>
                              <th scope="col">{t("稀有度", "Rarity")}</th>
                              <th scope="col">
                                {t("距上次出货", "Pulls since top rank")}
                              </th>
                              <th scope="col">{t("抽取时间", "Time")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={rows()}>
                              {row => (
                                <tr>
                                  <td>
                                    {name(row)}
                                    <Featured row={row} />
                                  </td>
                                  <td>
                                    <Rank row={row} />
                                  </td>
                                  <td>{row.interval ?? "—"}</td>
                                  <td>
                                    <PullTime row={row} />
                                  </td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                    </Match>
                  </Switch>
                </Show>
                <Show when={filtered().length > props.visiblePulls}>
                  <AppModalButton onClick={props.onShowMore}>
                    {t("显示更多记录", "Show more pulls")}
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
