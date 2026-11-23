import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
} from "@hope-ui/solid";
import { batch, createResource, createSignal, Show, onCleanup } from "solid-js";
import { AppModal, AppModalButton } from "@src/components/app-modal";
import { MiyousheRolePicker } from "./account-entry";
import type { CheckInResult } from "./account";
import type { MiyousheGame } from "./games";
import {
  MiyousheCheckInCalendar,
  MiyousheRewardIcon,
} from "./check-in-calendar";
import {
  currentCheckInRewardDay,
  parseCheckInRewards,
  type CheckInReward,
} from "./check-in-rewards";
import { notifyMiyoushe } from "./notifications";
import { roleKey, type MiyousheSession } from "./session";

export function MiyousheCheckInMenu(props: {
  t: (zh: string, en: string) => string;
  game: MiyousheGame;
  session: MiyousheSession;
  disabled: boolean;
  accent: string;
  accentText: string;
}) {
  const { session, t } = props;
  const [opened, setOpened] = createSignal(false);
  const [calendarOpen, setCalendarOpen] = createSignal(false);
  const rewardCache = new Map<
    MiyousheGame,
    { month: string; rewards: CheckInReward[] }
  >();
  const month = () => session.checkInDay().slice(0, 7);
  const [rewardReply, { refetch: refreshRewards }] = createResource(
    () =>
      (opened() || calendarOpen()) && session.status() !== "loading"
        ? props.game + ":" + month()
        : false,
    async key => {
      const game = props.game;
      const requestedMonth = month();
      const cached = rewardCache.get(game);
      if (cached?.month === requestedMonth)
        return { key, rewards: cached.rewards };
      const reply = await session.request<unknown>("check-in-rewards", [game]);
      const rewards = parseCheckInRewards(
        reply,
        Number(requestedMonth.slice(5))
      );
      if (rewards) rewardCache.set(game, { month: requestedMonth, rewards });
      return { key, rewards };
    }
  );
  const rewards = () => {
    const reply = rewardReply();
    return reply?.key === props.game + ":" + month()
      ? reply.rewards
      : undefined;
  };
  const title = () => t("每日签到", "Daily check-in");
  const bound = () => session.status() === "bound";
  const signed = () => session.checkInStatus() === "signed";
  const currentDay = () =>
    currentCheckInRewardDay(
      rewards()?.length ?? 0,
      session.checkInClaimedDays(),
      signed()
    );
  const todayReward = () => {
    const day = currentDay();
    return day === undefined ? undefined : rewards()?.[day - 1];
  };
  const rewardLoading = () =>
    rewardReply.loading || session.status() === "loading";
  const monthTitle = () => {
    const name = new Intl.DateTimeFormat(t("zh-CN", "en-US"), {
      month: "long",
      timeZone: "Asia/Shanghai",
    }).format(new Date(session.checkInDay() + "T00:00:00+08:00"));
    return t(name + "签到奖励", name + " check-in rewards");
  };
  const rewardTheme = () => ({
    "--miyo-accent": props.accent,
    "--miyo-accent-text": props.accentText,
  });
  const ready = () =>
    session.checkInStatus() === "unsigned" &&
    !session.busy() &&
    !session.checkingIn();
  const showRefresh = () => {
    const status = session.checkInStatus();
    return status && !["checking", "signed", "unsigned"].includes(status);
  };

  onCleanup(session.closeCheckInMenu);

  const statusLabel = () => {
    if (session.checkingIn()) return t("签到中…", "Checking in…");
    switch (session.checkInStatus()) {
      case "signed":
        return t("今日已签", "Checked in today");
      case "unsigned":
        return t("今日待签到", "Ready to check in");
      case "checking":
        return t("查询中…", "Checking status…");
      case "first-check-in":
        return t("暂无法完成首次签到", "First check-in unavailable");
      case "manual":
        return t("服务端要求人工验证", "Verification required");
      case "limited":
        return t("请求受限，请稍后再试", "Rate limited. Try again later");
      default:
        return showRefresh()
          ? t("暂无法确认", "Status unavailable")
          : undefined;
    }
  };
  const accountLabel = () => {
    switch (session.status()) {
      case "loading":
        return t("读取账号中…", "Loading account…");
      case "unavailable":
        return t("账号暂不可用", "Account unavailable");
      case "expired":
        return t(
          "登录已过期，请从侧栏重新扫码",
          "Session expired. Sign in from the sidebar"
        );
      default:
        return t("请先从侧栏头像登录", "Sign in from the sidebar avatar");
    }
  };

  async function sign() {
    const role = session.selectedRole();
    if (!ready() || !role) return;
    const game = props.game;
    const revision = session.revision();
    let diagnostic: string | undefined;
    const result = await session.sign((stage, reply) => {
      if (reply.code === undefined) return;
      const stages = {
        status: t("查询签到状态", "Check status"),
        sign: t("提交签到", "Submit check-in"),
        verify: t("复查签到结果", "Verify check-in"),
      };
      diagnostic = stages[stage] + " · " + reply.code;
    });
    const currentRole = session.selectedRole();
    if (
      props.game !== game ||
      revision !== session.revision() ||
      (currentRole
        ? roleKey(currentRole) !== roleKey(role)
        : result !== "unbound")
    )
      return;
    const descriptions: Partial<Record<CheckInResult, string>> = {
      signed: t("今日签到成功", "Checked in for today"),
      already: t("今日已签到", "Already checked in today"),
      unbound: t(
        "登录已过期，请从侧栏重新扫码",
        "Session expired. Scan again from the sidebar"
      ),
      network: t("暂时无法连接米游社", "Could not reach Miyoushe"),
      limited: t("请求受限，请稍后再试", "Rate limited. Try again later"),
      "first-check-in": t(
        "此角色暂无法在启动器完成首次签到",
        "First check-in is unavailable for this character"
      ),
      manual: t(
        "签到服务要求人工验证",
        "The check-in service requires verification"
      ),
      "day-changed": t(
        "日期已切换，正在查询今天的签到状态",
        "Checking status for the new day"
      ),
    };
    const success = result === "signed" || result === "already";
    notifyMiyoushe(
      success ? "success" : "warning",
      descriptions[result] ??
        t("暂时无法确认签到结果", "Check-in could not be confirmed"),
      success ? undefined : diagnostic
    );
  }

  return (
    <>
      <Popover
        placement="top-end"
        offset={8}
        onOpen={() => {
          session.openCheckInMenu();
          setOpened(true);
        }}
        onClose={() => {
          setOpened(false);
          if (!calendarOpen()) session.closeCheckInMenu();
        }}
      >
        {({ onClose }) => (
          <>
            <PopoverTrigger
              type="button"
              class="hyp-launch-tool miyoushe-check-in-trigger"
              data-signed={signed()}
              disabled={props.disabled}
              aria-label={signed() ? title() + " · " + statusLabel() : title()}
              title={signed() ? title() + " · " + statusLabel() : title()}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="5" width="16" height="16" rx="2" />
                <path d="M8 3v4m8-4v4M4 10h16m-11 5 2 2 4-4" />
              </svg>
              <span class="hyp-launch-tool-label">
                {signed() ? statusLabel() : title()}
              </span>
            </PopoverTrigger>
            <PopoverContent
              class="hyp-menu-popover-content miyoushe-check-in-popover"
              aria-label={title()}
            >
              <PopoverBody class="hyp-menu-popover-body">
                <div class="miyoushe-check-in-menu" style={rewardTheme()}>
                  <div class="miyoushe-check-in-heading">
                    <h2>{title()}</h2>
                    <Show when={bound() && statusLabel()}>
                      <span data-signed={signed()} role="status">
                        {statusLabel()}
                      </span>
                    </Show>
                  </div>
                  <Show
                    when={bound()}
                    fallback={
                      <Show when={accountLabel()}>
                        <p class="miyoushe-muted">{accountLabel()}</p>
                      </Show>
                    }
                  >
                    <MiyousheRolePicker
                      t={t}
                      session={session}
                      game={props.game}
                      disabled={session.checkingIn()}
                    />
                  </Show>
                  <div class="miyoushe-today-reward">
                    <Show
                      when={todayReward()}
                      keyed
                      fallback={
                        <span class="miyoushe-muted">
                          {t("今日奖励", "Today’s reward")} ·{" "}
                          {rewardLoading() ? t("加载中…", "Loading…") : "—"}
                        </span>
                      }
                    >
                      {reward => (
                        <div class="miyoushe-today-reward-item">
                          <MiyousheRewardIcon reward={reward} />
                          <div>
                            <span class="miyoushe-muted">
                              {t("今日奖励", "Today’s reward")}
                            </span>
                            <strong>
                              {reward.name} ×{reward.count}
                            </strong>
                          </div>
                        </div>
                      )}
                    </Show>
                    <button
                      type="button"
                      class="miyoushe-reward-link"
                      aria-haspopup="dialog"
                      onClick={() =>
                        batch(() => {
                          setCalendarOpen(true);
                          onClose();
                        })
                      }
                    >
                      {t("查看月历", "View month")}
                    </button>
                  </div>
                  <Show when={bound()}>
                    <div class="miyoushe-check-in-actions">
                      <Show
                        when={showRefresh() && !session.checkingIn()}
                        fallback={
                          <AppModalButton
                            variant="primary"
                            disabled={!ready()}
                            onClick={() => void sign()}
                          >
                            {signed()
                              ? t("已签到", "Checked in")
                              : t("签到", "Check in")}
                          </AppModalButton>
                        }
                      >
                        <AppModalButton
                          disabled={session.busy()}
                          onClick={() => void session.refreshCheckInStatus()}
                        >
                          {t("刷新状态", "Refresh status")}
                        </AppModalButton>
                      </Show>
                    </div>
                  </Show>
                </div>
              </PopoverBody>
            </PopoverContent>
          </>
        )}
      </Popover>
      <AppModal
        opened={calendarOpen()}
        onClose={() => {
          setCalendarOpen(false);
          session.closeCheckInMenu();
        }}
        title={monthTitle()}
        maxWidth={560}
        contentClass="miyoushe-modal miyoushe-reward-modal"
        bodyClass="miyoushe-modal-body"
      >
        <div style={rewardTheme()}>
          <Show
            when={rewards()}
            fallback={
              <div class="miyoushe-reward-calendar-state">
                <span class="miyoushe-muted" role="status">
                  {rewardLoading()
                    ? t("正在读取奖励…", "Loading rewards…")
                    : t("暂时无法读取签到奖励", "Rewards unavailable")}
                </span>
                <Show when={!rewardLoading()}>
                  <AppModalButton onClick={() => void refreshRewards()}>
                    {t("重试", "Retry")}
                  </AppModalButton>
                </Show>
              </div>
            }
          >
            {items => (
              <MiyousheCheckInCalendar
                t={t}
                rewards={items()}
                claimedDays={session.checkInClaimedDays()}
                currentDay={currentDay()}
              />
            )}
          </Show>
        </div>
      </AppModal>
    </>
  );
}
