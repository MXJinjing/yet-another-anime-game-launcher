import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js";
import { AppModalButton } from "@src/components/app-modal";
import type { PullGame } from "./games";
import type { CatalogItem } from "./hk4e-catalog";
import { readCachedHk4ePortrait } from "./hk4e-portrait-cache";
import { hk4ePoolRule } from "./hk4e-rules";
import {
  createPullReport,
  groupPullCycles,
  pagePullHistory,
  pullTiming,
  type PullReportRow,
} from "./pull-report";
import type { GachaArchive, summarizePulls } from "./uigf";
import { readRadianceMarks, toggleRadianceMark } from "./local";
import { notifyPullAnalysis } from "./notifications";

type Account = NonNullable<GachaArchive[PullGame]>[number];
type Summary = ReturnType<typeof summarizePulls>;
type Translate = (zh: string, en: string) => string;
type View = "list" | "bars";

const poolNames: Record<PullGame, Record<string, [string, string]>> = {
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

export function pullPoolLabel(game: PullGame, type: string, t: Translate) {
  const names = poolNames[game][type];
  return names ? t(...names) : t("卡池 ", "Pool ") + type;
}

const views: ReadonlyArray<readonly [View, string, string, string]> = [
  ["bars", "柱形图", "Bar chart", "M2 2v12M5 4h9M5 8h5m-5 4h7"],
  [
    "list",
    "全部记录",
    "All records",
    "M2 4h.5m3 0H14M2 8h.5m3 0H14M2 12h.5m3 0H14",
  ],
];

function average(values: number[]) {
  return values.length
    ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)
    : "—";
}

export function PullDashboard(props: {
  t: Translate;
  game: PullGame;
  accounts: Account[];
  account: Account;
  summary: Summary;
  poolType: string | undefined;
  poolTabs: readonly string[];
  catalog?: ReadonlyMap<string, CatalogItem>;
  visiblePulls: number;
  historyProgress?: string;
  historyControls?: JSX.Element;
  onAccountChange: (uid: string) => void;
  onPoolChange: (type: string) => void;
  onShowMore: () => void;
}) {
  const t = props.t;
  const count = new Intl.NumberFormat();
  const [view, setView] = createSignal<View>("bars");
  const [showFour, setShowFour] = createSignal(false);
  const [page, setPage] = createSignal(1);
  createEffect(
    on(
      () => [props.game, props.account.uid, props.poolType] as const,
      () => setPage(1),
      { defer: true }
    )
  );
  const [radiance, setRadiance] = createSignal(new Set<string>());
  const [writingMark, setWritingMark] = createSignal(false);
  onMount(() => {
    void readRadianceMarks().then(marks => setRadiance(new Set(marks)));
  });
  const report = createMemo(() =>
    createPullReport(props.account, props.game, props.catalog)
  );
  const pool = createMemo(() =>
    report().pools.find(entry => entry.type === props.poolType)
  );
  const topRank = () =>
    props.game === "nap" ? t("S 级", "S rank") : t("五星", "5-star");
  const rankLabel = (rank?: string) => {
    if (!rank) return "—";
    return props.game === "nap"
      ? ({ "5": "S", "4": "A", "3": "B" } as Record<string, string>)[rank] ??
          rank
      : rank + "★";
  };
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
    pagePullHistory(pool()?.rows ?? [], page())
  );
  const rule = () =>
    props.game === "hk4e"
      ? hk4ePoolRule(
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
      <span class="pull-analysis-rank" data-rank={props.row.pull.rank_type}>
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
      hk4ePoolRule(type, row.pull.time, props.account.timezone)?.radiance ===
        true
    );
  }

  async function markRadiance(key: string) {
    if (writingMark()) return;
    setWritingMark(true);
    try {
      setRadiance(new Set(await toggleRadianceMark(key)));
    } catch {
      notifyPullAnalysis(
        "warning",
        t("无法保存明光标记", "Could not save the Radiance mark")
      );
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
            class="pull-analysis-featured-tag"
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
            class="pull-analysis-radiance-mark"
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
    const [local] = createResource(
      () => props.row.item?.icon,
      readCachedHk4ePortrait
    );
    const icon = () => {
      const cached = local();
      return cached && !failed().includes(cached) ? cached : undefined;
    };
    return (
      <div
        class="pull-analysis-item-image"
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
          class="pull-analysis-four-cards"
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

  return (
    <>
      <div class="pull-analysis-scope">
        <div class="pull-analysis-scope-details">
          <label class="pull-analysis-field">
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
          <Show
            when={!props.historyProgress}
            fallback={
              <span class="pull-analysis-sync-progress" role="status">
                {props.historyProgress}
              </span>
            }
          >
            <div class="pull-analysis-report-meta">
              <Show when={props.summary.first}>
                <span class="pull-analysis-muted">
                  {props.summary.first?.slice(0, 10)} —{" "}
                  {props.summary.last?.slice(0, 10)} · UTC
                  {props.account.timezone >= 0 ? "+" : ""}
                  {props.account.timezone}
                </span>
              </Show>
              <span class="pull-analysis-muted" aria-live="polite">
                {t("最近更新", "Last updated")}{" "}
                <Show when={props.account.updatedAt} fallback="—">
                  {timestamp => (
                    <time dateTime={new Date(timestamp()).toISOString()}>
                      {new Intl.DateTimeFormat(t("zh-CN", "en-GB"), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(timestamp())}
                    </time>
                  )}
                </Show>
              </span>
            </div>
          </Show>
        </div>
        <div class="pull-analysis-report-actions">{props.historyControls}</div>
      </div>

      <Show when={props.poolTabs.length}>
        <div
          class="pull-analysis-pool-picker"
          role="group"
          aria-label={t("卡池", "Pools")}
        >
          <For each={props.poolTabs}>
            {type => (
              <button
                type="button"
                aria-pressed={props.poolType === type}
                onClick={() => props.onPoolChange(type)}
              >
                {pullPoolLabel(props.game, type, t)}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show
        when={pool()}
        fallback={
          <p class="pull-analysis-card pull-analysis-muted">
            {props.poolType
              ? t("此卡池暂无记录", "No records for this pool")
              : t("此 UID 尚无抽卡记录。", "This UID has no pull records yet.")}
          </p>
        }
      >
        {active => (
          <>
            <section class="pull-analysis-card pull-analysis-history">
              <div class="pull-analysis-history-heading">
                <dl class="pull-analysis-pool-metrics">
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
                <div class="pull-analysis-view-actions">
                  <Show when={view() === "bars" && fourthCount()}>
                    <label class="pull-analysis-four-toggle">
                      <input
                        type="checkbox"
                        checked={showFour()}
                        aria-controls="pull-analysis-pull-cycles"
                        onChange={event =>
                          setShowFour(event.currentTarget.checked)
                        }
                      />
                      {t("显示四星", "Show four-star pulls")}
                      <span>{fourthCount()}</span>
                    </label>
                  </Show>
                  <div
                    class="pull-analysis-pool-picker pull-analysis-view-picker"
                    role="group"
                    aria-label={t("显示方式", "View mode")}
                  >
                    <For each={views}>
                      {([id, zh, en, icon]) => (
                        <button
                          type="button"
                          aria-pressed={view() === id}
                          onClick={() => setView(id)}
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                          >
                            <path d={icon} />
                          </svg>
                          {t(zh, en)}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>
              <Switch>
                <Match when={view() === "bars"}>
                  <ol
                    id="pull-analysis-pull-cycles"
                    class="pull-analysis-chart"
                    aria-label={t(
                      "出货间隔与当前垫抽",
                      "Pull intervals and current pity"
                    )}
                  >
                    <li class="pull-analysis-chart-ongoing">
                      <div
                        class="pull-analysis-ongoing-icon"
                        aria-hidden="true"
                      >
                        …
                      </div>
                      <div class="pull-analysis-chart-row">
                        <div class="pull-analysis-chart-label">
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
                            <span class="pull-analysis-featured-tag">
                              {active().nextGuaranteed
                                ? t("当前大保底", "Next top rank guaranteed UP")
                                : t(
                                    "当前小保底",
                                    "Next top rank not guaranteed UP"
                                  )}
                            </span>
                          </Show>
                        </div>
                        <div
                          class="pull-analysis-chart-meter"
                          style={{
                            "--miyo-fill":
                              (timeline().ongoing.count / barMax()) * 100 + "%",
                          }}
                        >
                          <span
                            class="pull-analysis-chart-fill"
                            aria-hidden="true"
                          />
                          <span class="pull-analysis-chart-value pull-analysis-chart-count">
                            <Show
                              when={
                                timeline().ongoing.complete ||
                                timeline().ongoing.count > 0
                              }
                              fallback="—"
                            >
                              {timeline().ongoing.complete ? "" : "≥"}
                              {timeline().ongoing.count}
                              {t(" 抽", " pulls")}
                            </Show>
                          </span>
                        </div>
                      </div>
                      <FourCards rows={timeline().ongoing.fourths} />
                    </li>
                    <For each={cycles().slice(0, props.visiblePulls)}>
                      {cycle => {
                        const row = cycle.result;
                        return (
                          <li
                            data-timing={pullTiming(
                              row.interval,
                              rule()?.hardPity
                            )}
                          >
                            <ItemImage row={row} />
                            <div class="pull-analysis-chart-row">
                              <div class="pull-analysis-chart-label">
                                <strong title={name(row)}>{name(row)}</strong>
                                <Featured row={row} uid={props.account.uid} />
                              </div>
                              <div
                                class="pull-analysis-chart-meter"
                                style={{
                                  "--miyo-fill":
                                    ((row.interval ?? 0) / barMax()) * 100 +
                                    "%",
                                }}
                              >
                                <span
                                  class="pull-analysis-chart-fill"
                                  aria-hidden="true"
                                />
                                <span class="pull-analysis-chart-value pull-analysis-chart-count">
                                  {row.interval ?? "—"}
                                  {row.interval === undefined
                                    ? ""
                                    : t(" 抽", " pulls")}
                                </span>
                              </div>
                            </div>
                            <FourCards rows={cycle.fourths} />
                          </li>
                        );
                      }}
                    </For>
                  </ol>
                </Match>
                <Match when={view() === "list"}>
                  <div class="pull-analysis-table-wrap">
                    <table
                      aria-label={pullPoolLabel(props.game, active().type, t)}
                    >
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
                              <td class="pull-analysis-list-item">
                                {name(row)}
                              </td>
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
                    class="pull-analysis-list-pagination"
                    role="group"
                    aria-label={t("抽卡记录分页", "History pagination")}
                  >
                    <div class="pull-analysis-page-controls">
                      <AppModalButton
                        disabled={listPage().page <= 1}
                        onClick={() => setPage(listPage().page - 1)}
                      >
                        {t("上一页", "Previous")}
                      </AppModalButton>
                      <span class="pull-analysis-muted" aria-live="polite">
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
