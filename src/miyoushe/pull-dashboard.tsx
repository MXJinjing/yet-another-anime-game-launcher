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
  ["bars", "横条", "Bars"],
  ["images", "图像", "Images"],
  ["text", "文字", "Text"],
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
  const [view, setView] = createSignal<View>("bars");
  const [ranks, setRanks] = createSignal<string[]>(["5"]);
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
  const completedIntervals = createMemo(() =>
    report().pools.flatMap(entry => entry.intervals)
  );
  const rule = () =>
    props.game === "hk4e"
      ? genshinPoolRule(
          pool()?.type ?? "",
          pool()?.pulls.at(-1)?.time,
          props.account.timezone
        )
      : undefined;
  const barMax = createMemo(
    () =>
      pool()?.rows.reduce(
        (max, row) =>
          row.pull.rank_type === "5" ? Math.max(max, row.interval ?? 0) : max,
        rule()?.hardPity ?? 1
      ) ?? 1
  );
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
          {props.row.featured === false
            ? t("歪池", "Off-banner")
            : props.row.featured === undefined
            ? t("UP 未知", "UP unknown")
            : props.row.guaranteed === undefined
            ? "UP"
            : props.row.guaranteed
            ? t("大保底", "Guaranteed UP")
            : t("小保底", "Non-guaranteed UP")}
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
            {topRank()}
            {t("平均", " average")}
          </span>
          <strong>{average(completedIntervals())}</strong>
          <small>
            {completedIntervals().length}{" "}
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
                    }}
                  >
                    {poolLabel(entry.type)}{" "}
                    <span title={t("最高稀有度次数", "Top-rank pulls")}>
                      {count.format(
                        report().pools.find(pool => pool.type === entry.type)
                          ?.topRankCount ?? 0
                      )}
                    </span>
                  </button>
                )}
              </For>
            </div>

            <section class="miyoushe-card miyoushe-pool-summary">
              <div class="miyoushe-pity-overview">
                <div class="miyoushe-section-heading">
                  <h3>{poolLabel(active().type)}</h3>
                  <Show when={supportsFeatured()}>
                    <span class="miyoushe-pity-state">
                      {active().nextGuaranteed === true
                        ? t("当前大保底", "Next top rank guaranteed UP")
                        : active().nextGuaranteed === false
                        ? t("当前小保底", "Next top rank not guaranteed UP")
                        : t("保底状态未知", "Guarantee unknown")}
                    </span>
                  </Show>
                </div>
                <div class="miyoushe-pity-value">
                  <span>{t("当前已垫", "Recorded pity")}</span>
                  <strong>{active().pity ?? "—"}</strong>
                  <span>{t("抽", "pulls")}</span>
                </div>
                <Show
                  when={
                    active().pity !== undefined &&
                    rule() &&
                    (active().pity ?? 0) < (rule()?.hardPity ?? 0)
                  }
                >
                  <div
                    class="miyoushe-bar-track miyoushe-pity-track"
                    data-rank="5"
                    aria-hidden="true"
                  >
                    <span
                      style={{
                        width:
                          ((active().pity ?? 0) / (rule()?.hardPity ?? 1)) *
                            100 +
                          "%",
                      }}
                    />
                  </div>
                  <small class="miyoushe-muted">
                    {t("若记录完整，最迟再", "With complete records, at most")}{" "}
                    {(rule()?.hardPity ?? 0) - (active().pity ?? 0)}{" "}
                    {t("抽出货", "pulls to the next top rank")}
                  </small>
                </Show>
              </div>
              <dl class="miyoushe-pool-metrics">
                <div>
                  <dt>
                    {topRank()}
                    {t("平均", " average")}
                  </dt>
                  <dd>{average(active().intervals)}</dd>
                </div>
                <Show when={supportsFeatured()}>
                  <div>
                    <dt>
                      UP {topRank()}
                      {t("平均", " average")}
                    </dt>
                    <dd>{average(active().featuredIntervals)}</dd>
                  </div>
                  <div>
                    <dt>{t("历史 UP 占比", "Historical UP share")}</dt>
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
                      {active().hits} UP / {active().classified}{" "}
                      {t("次可判定", "classified")}
                      {active().topRankCount > active().classified
                        ? " · " +
                          (active().topRankCount - active().classified) +
                          t(" 个未知", " unknown")
                        : ""}
                    </small>
                  </div>
                </Show>
              </dl>
            </section>
            <section class="miyoushe-card miyoushe-history">
              <div class="miyoushe-section-heading">
                <h3>{t("出货记录", "Pull results")}</h3>
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
                    {t(
                      "显示保底与歪池标记",
                      "Show guarantee and off-banner labels"
                    )}
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
                    <ol
                      class="miyoushe-chart"
                      aria-label={t("出货间隔", "Pull intervals")}
                    >
                      <For each={rows()}>
                        {row => (
                          <li>
                            <span
                              class="miyoushe-chart-label"
                              title={name(row)}
                            >
                              {name(row)}
                            </span>
                            <div
                              class="miyoushe-bar-track"
                              data-rank={row.pull.rank_type}
                              aria-hidden="true"
                            >
                              <span
                                style={{
                                  width:
                                    Math.min(
                                      100,
                                      ((row.interval ?? 0) / barMax()) * 100
                                    ) + "%",
                                }}
                              />
                            </div>
                            <strong
                              aria-label={t(
                                "距上次出货的抽数",
                                "Pulls since the last top-rank pull"
                              )}
                            >
                              {row.interval ?? "—"}
                            </strong>
                            <span class="miyoushe-chart-meta">
                              <Featured row={row} />
                              <PullTime row={row} />
                            </span>
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
            <details class="miyoushe-pool-rules">
              <summary>
                {t("统计口径与保底说明", "Statistics and pity notes")}
              </summary>
              <p class="miyoushe-muted">
                {t(
                  "平均只计两次已知出货之间的完整周期。UP 平均包含周期中的歪池消耗，进行中的垫抽不进入平均。历史 UP 占比仅基于可判定记录。",
                  "Averages use complete cycles between known results. UP averages include off-banner pulls in the cycle. Current pity is excluded, and historical UP share uses classified results only."
                )}
              </p>
              <Show when={rule()?.radiance}>
                <p class="miyoushe-muted">
                  {t(
                    "现有抽卡记录无法确定捕获明光的下一次触发概率。",
                    "The next Capturing Radiance probability cannot be determined from this history."
                  )}
                </p>
              </Show>
              <Show when={props.game === "hk4e" && active().type === "302"}>
                <p class="miyoushe-muted">
                  {t(
                    "武器池的大保底表示当期任一 UP 武器。定轨目标无法从记录判断。",
                    "The weapon banner guarantee covers either featured weapon. History does not identify the chosen weapon."
                  )}
                </p>
              </Show>
            </details>
          </>
        )}
      </Show>
    </>
  );
}
