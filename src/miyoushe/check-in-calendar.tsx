import { createSignal, For, Show } from "solid-js";
import type { CheckInReward } from "./check-in-rewards";

export function MiyousheRewardIcon(props: { reward: CheckInReward }) {
  const [failed, setFailed] = createSignal<string>();
  const imageUrl = () => {
    const url = props.reward.icon;
    return url !== failed() ? url : undefined;
  };
  return (
    <span class="miyoushe-reward-icon" aria-hidden="true">
      <Show
        when={imageUrl()}
        fallback={<span>{props.reward.name.slice(0, 1)}</span>}
      >
        {icon => (
          <img
            src={icon()}
            alt=""
            referrerpolicy="no-referrer"
            onError={() => setFailed(icon())}
          />
        )}
      </Show>
    </span>
  );
}

export function MiyousheCheckInCalendar(props: {
  t: (zh: string, en: string) => string;
  rewards: readonly CheckInReward[];
  claimedDays?: number;
  currentDay?: number;
}) {
  const { t } = props;

  return (
    <div class="miyoushe-reward-calendar">
      <p class="miyoushe-reward-calendar-summary">
        {t("按累计签到天数排列", "Ordered by total check-in days")}
        <Show when={props.claimedDays !== undefined}>
          <span>
            {t(
              `累计已签 ${props.claimedDays} 天`,
              `${props.claimedDays} days checked in`
            )}
          </span>
        </Show>
      </p>
      <ol
        class="miyoushe-reward-grid"
        aria-label={t("本月签到奖励", "Monthly check-in rewards")}
      >
        <For each={props.rewards}>
          {(reward, index) => {
            const day = () => index() + 1;
            const claimed = () => day() <= (props.claimedDays ?? 0);
            const description = () =>
              t(
                `第 ${day()} 天 · ${reward.name} ×${reward.count}${
                  claimed() ? " · 已领取" : ""
                }`,
                `Day ${day()} · ${reward.name} ×${reward.count}${
                  claimed() ? " · Claimed" : ""
                }`
              );
            return (
              <li
                title={description()}
                aria-label={description()}
                data-claimed={claimed()}
                data-current={day() === props.currentDay}
              >
                <span class="miyoushe-reward-day">
                  {day()}
                  <Show when={claimed()}>
                    <span aria-hidden="true">✓</span>
                  </Show>
                </span>
                <MiyousheRewardIcon reward={reward} />
                <span class="miyoushe-reward-name">{reward.name}</span>
                <span class="miyoushe-reward-count">×{reward.count}</span>
              </li>
            );
          }}
        </For>
      </ol>
    </div>
  );
}
