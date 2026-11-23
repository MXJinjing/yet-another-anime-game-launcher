import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
} from "solid-js";
import { AppModalButton } from "@src/components/app-modal";
import type { MiyousheGame } from "./games";
import type { CatalogItem } from "./genshin-catalog";
import { genshinPoolRule } from "./genshin-rules";
import {
  createPullReport,
  groupPullCycles,
  pagePullHistory,
  pullTiming,
  type PullReportRow,
} from "./pull-report";
import type { GachaArchive, summarizePulls } from "./uigf";
import { readRadianceMarks, toggleRadianceMark } from "./local";

type Account = NonNullable<GachaArchive[MiyousheGame]>[number];
type Summary = ReturnType<typeof summarizePulls>;
type Translate = (zh: string, en: string) => string;
type View = "list" | "bars";

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
  ["bars", "柱形图", "Bar chart"],
  ["list", "全部记录", "All records"],
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
  const [showFour, setShowFour] = createSignal(false);
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal<5 | 10>(10);
  createEffect(
    on(
      () => [props.game, props.account.uid, props.pool?.type] as const,
      () => setPage(1),
      { defer: true }
    )
  );
  const [radiance, setRadiance] = createSignal(new Set<string>());
  const [writingMark, setWritingMark] = createSignal(false);
  const [markError, setMarkError] = createSignal(false);
  onMount(() => {
    void readRadianceMarks().then(marks => setRadiance(new Set(marks)));
  });
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
  const timeline = createMemo(() => groupPullCycles(pool()?.rows ?? []));
  const cycles = createMemo(() => [...timeline().cycles].reverse());
  const fourthCount = createMemo(
    () =>
      timeline().ongoing.fourths.length +
      timeline().cycles.reduce(
        (total, cycle) => total + cycle.fourths.length,
        0
      )
  );
  const listPage = createMemo(() =>
    pagePullHistory(pool()?.rows ?? [], page(), pageSize())
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
        Math.max(rule()?.hardPity ?? 1, timeline().ongoing.count)
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

  function canMarkRadiance(row: PullReportRow) {
    const type = row.pull.uigf_gacha_type ?? row.pull.gacha_type;
    return (
      props.game === "hk4e" &&
      type === "301" &&
      row.pull.rank_type === "5" &&
      row.featured !== false &&
      row.guaranteed !== true &&
      genshinPoolRule(type, row.pull.time, props.account.timezone)?.radiance ===
        true
    );
  }

  async function markRadiance(key: string) {
    if (writingMark()) return;
    setWritingMark(true);
    setMarkError(false);
    try {
      setRadiance(new Set(await toggleRadianceMark(key)));
    } catch {
      setMarkError(true);
    } finally {
      setWritingMark(false);
    }
  }

  function Featured(props: { row: PullReportRow; uid: string }) {
    const key = () => props.uid + ":" + props.row.pull.id;
    const marked = () => canMarkRadiance(props.row) && radiance().has(key());
    return (
      <>
        <Show
          when={
            supportsFeatured() && props.row.pull.rank_type === "5" && !marked()
          }
        >
          <span
            class="miyoushe-featured-tag"
            data-featured={String(props.row.featured)}
          >
            {props.row.featured === false
              ? props.row.guaranteed === false
                ? t("小保底歪", "Lost the 50/50")
                : t("歪池", "Off-banner")
              : props.row.featured === undefined
              ? t("UP 未知", "UP unknown")
              : props.row.guaranteed === undefined
              ? "UP"
              : props.row.guaranteed
              ? t("大保底", "Guaranteed UP")
              : t("小保底", "Non-guaranteed UP")}
          </span>
        </Show>
        <Show when={canMarkRadiance(props.row)}>
          <button
            type="button"
            class="miyoushe-radiance-mark"
            aria-pressed={marked()}
            disabled={writingMark()}
            title={t(
              "仅在游戏中看到捕获明光动画时标记",
              "Mark only if you saw the Capturing Radiance animation"
            )}
            onClick={() => void markRadiance(key())}
          >
            {marked()
              ? t("捕获明光", "Capturing Radiance")
              : t("标记明光", "Mark Radiance")}
          </button>
        </Show>
      </>
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
    const [failed, setFailed] = createSignal<string[]>([]);
    const icon = () => {
      const primary = props.row.item?.icon;
      if (!primary) return;
      if (primary.startsWith("https://upload-os-bbs.mihoyo.com/")) {
        const mirror =
          "https://enka.network/ui/" +
          primary.slice(primary.lastIndexOf("/") + 1);
        if (!failed().includes(mirror)) return mirror;
      }
      if (!failed().includes(primary)) return primary;
    };
    return (
      <div
        class="miyoushe-item-image"
        data-rank={props.row.pull.rank_type}
        title={name(props.row)}
      >
        <Show
          when={icon()}
          fallback={
            <span aria-hidden="true">
              {rankLabel(props.row.pull.rank_type)}
            </span>
          }
        >
          {source => (
            <img
              src={source()}
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              onError={event => {
                const source = event.currentTarget.src;
                setFailed(previous => [...previous, source]);
              }}
            />
          )}
        </Show>
      </div>
    );
  }

  function FourCards(props: { rows: PullReportRow[] }) {
    return (
      <Show when={showFour() && props.rows.length}>
        <ul
          class="miyoushe-four-cards"
          aria-label={t("本周期四星出货", "Four-star pulls in this cycle")}
        >
          <For each={[...props.rows].reverse()}>
            {row => {
              const interval = () =>
                row.fourStarInterval === undefined
                  ? "—"
                  : row.fourStarInterval + t(" 抽", " pulls");
              return (
                <li
                  aria-label={name(row) + " · " + interval()}
                  title={name(row)}
                >
                  <ItemImage row={row} />
                  <span>{interval()}</span>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    );
  }

  const timingLabel = (timing: ReturnType<typeof pullTiming>) =>
    ({
      early: t("早出", "Early"),
      middle: t("中段", "Middle"),
      late: t("接近保底", "Near hard pity"),
      unknown: t("抽数或保底未知", "Unknown timing"),
    }[timing]);

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
                    <span
                      title={
                        view() === "bars"
                          ? t("最高稀有度次数", "Top-rank pulls")
                          : t("记录数", "Record count")
                      }
                    >
                      {count.format(
                        view() === "bars"
                          ? report().pools.find(
                              pool => pool.type === entry.type
                            )?.topRankCount ?? 0
                          : entry.pulls.length
                      )}
                    </span>
                  </button>
                )}
              </For>
            </div>
            <section class="miyoushe-card miyoushe-history">
              <Show when={view() === "bars"}>
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
                      <dd
                        title={
                          active().hits +
                          " UP / " +
                          active().classified +
                          " " +
                          t("次可判定", "classified")
                        }
                      >
                        {active().classified
                          ? count.format(
                              Math.round(
                                (active().hits / active().classified) * 100
                              )
                            ) + "%"
                          : "—"}
                      </dd>
                    </div>
                  </Show>
                </dl>
              </Show>
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
                <Show when={view() === "bars" && fourthCount()}>
                  <button
                    type="button"
                    class="miyoushe-four-toggle"
                    aria-expanded={showFour()}
                    aria-controls="miyoushe-pull-cycles"
                    onClick={() => setShowFour(value => !value)}
                  >
                    {showFour()
                      ? t("收起四星", "Hide four-star pulls")
                      : t("显示四星", "Show four-star pulls")}
                    <span>{fourthCount()}</span>
                  </button>
                </Show>
              </div>
              <Switch>
                <Match when={view() === "bars"}>
                  <ol
                    id="miyoushe-pull-cycles"
                    class="miyoushe-chart"
                    aria-label={t(
                      "出货间隔与当前垫抽",
                      "Pull intervals and current pity"
                    )}
                  >
                    <li class="miyoushe-chart-ongoing">
                      <div class="miyoushe-ongoing-icon" aria-hidden="true">
                        …
                      </div>
                      <div class="miyoushe-chart-row">
                        <div class="miyoushe-chart-label">
                          <strong>{t("当前垫抽", "Current pity")}</strong>
                          <small>
                            {t("截至最新一抽", "Through the latest pull")}
                          </small>
                          <Show
                            when={
                              supportsFeatured() &&
                              active().nextGuaranteed !== undefined
                            }
                          >
                            <span class="miyoushe-featured-tag">
                              {active().nextGuaranteed
                                ? t("当前大保底", "Next top rank guaranteed UP")
                                : t(
                                    "当前小保底",
                                    "Next top rank not guaranteed UP"
                                  )}
                            </span>
                          </Show>
                        </div>
                        <div class="miyoushe-chart-meter">
                          <span
                            class="miyoushe-chart-fill"
                            aria-hidden="true"
                            style={{
                              width:
                                (timeline().ongoing.count / barMax()) * 100 +
                                "%",
                            }}
                          />
                          <span class="miyoushe-chart-value">
                            <Show
                              when={
                                timeline().ongoing.complete ||
                                timeline().ongoing.count > 0
                              }
                              fallback={t("记录不足", "Insufficient records")}
                            >
                              {timeline().ongoing.complete
                                ? ""
                                : t("至少 ", "At least ")}
                              {timeline().ongoing.count}
                              {t(" 抽未出", " pulls without top rank")}
                            </Show>
                          </span>
                        </div>
                      </div>
                      <FourCards rows={timeline().ongoing.fourths} />
                    </li>
                    <For each={cycles().slice(0, props.visiblePulls)}>
                      {cycle => {
                        const row = cycle.result;
                        const timing = () =>
                          pullTiming(row.interval, rule()?.hardPity);
                        return (
                          <li data-timing={timing()}>
                            <ItemImage row={row} />
                            <div class="miyoushe-chart-row">
                              <div class="miyoushe-chart-label">
                                <strong title={name(row)}>{name(row)}</strong>
                                <Featured row={row} uid={props.account.uid} />
                              </div>
                              <div
                                class="miyoushe-chart-meter"
                                title={timingLabel(timing())}
                              >
                                <span
                                  class="miyoushe-chart-fill"
                                  aria-hidden="true"
                                  style={{
                                    width:
                                      ((row.interval ?? 0) / barMax()) * 100 +
                                      "%",
                                  }}
                                />
                                <span class="miyoushe-chart-value">
                                  {row.interval ?? "—"}
                                  {row.interval === undefined
                                    ? ""
                                    : t(" 抽", " pulls")}
                                  <Show when={timing() !== "unknown"}>
                                    <small>{timingLabel(timing())}</small>
                                  </Show>
                                </span>
                              </div>
                            </div>
                            <FourCards rows={cycle.fourths} />
                          </li>
                        );
                      }}
                    </For>
                  </ol>
                  <Show when={markError()}>
                    <p class="miyoushe-muted" role="status">
                      {t(
                        "无法保存明光标记。",
                        "Could not save the Radiance mark."
                      )}
                    </p>
                  </Show>
                </Match>
                <Match when={view() === "list"}>
                  <div class="miyoushe-table-wrap">
                    <table aria-label={poolLabel(active().type)}>
                      <thead>
                        <tr>
                          <th scope="col">{t("获得物品", "Item")}</th>
                          <th scope="col">{t("稀有度", "Rarity")}</th>
                          <th scope="col">{t("抽取时间", "Time")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={listPage().rows}>
                          {row => (
                            <tr data-rank={row.pull.rank_type}>
                              <td class="miyoushe-list-item">{name(row)}</td>
                              <td>
                                <Rank row={row} />
                              </td>
                              <td>
                                <PullTime row={row} />
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                  <div
                    class="miyoushe-list-pagination"
                    role="group"
                    aria-label={t("抽卡记录分页", "History pagination")}
                  >
                    <label class="miyoushe-field">
                      {t("每页", "Per page")}
                      <select
                        value={pageSize()}
                        onChange={event => {
                          setPageSize(
                            event.currentTarget.value === "5" ? 5 : 10
                          );
                          setPage(1);
                        }}
                      >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                      </select>
                    </label>
                    <div class="miyoushe-page-controls">
                      <AppModalButton
                        disabled={listPage().page <= 1}
                        onClick={() => setPage(listPage().page - 1)}
                      >
                        {t("上一页", "Previous")}
                      </AppModalButton>
                      <span class="miyoushe-muted" aria-live="polite">
                        {listPage().page} / {listPage().pageCount}
                      </span>
                      <AppModalButton
                        disabled={listPage().page >= listPage().pageCount}
                        onClick={() => setPage(listPage().page + 1)}
                      >
                        {t("下一页", "Next")}
                      </AppModalButton>
                    </div>
                  </div>
                </Match>
              </Switch>
              <Show
                when={view() === "bars" && cycles().length > props.visiblePulls}
              >
                <AppModalButton onClick={props.onShowMore}>
                  {t("显示更多记录", "Show more pulls")}
                </AppModalButton>
              </Show>
            </section>
          </>
        )}
      </Show>
    </>
  );
}
