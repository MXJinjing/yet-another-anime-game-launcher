export type CheckInReward = {
  name: string;
  count: number;
  icon?: string;
};

const awardHosts = new Set([
  "webstatic.mihoyo.com",
  "act-webstatic.mihoyo.com",
]);

function rewardIcon(value: unknown) {
  if (typeof value !== "string" || value.length > 512) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      awardHosts.has(url.host) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
      return url.href;
  } catch {
    // A malformed image does not invalidate the reward itself.
  }
}

export function parseCheckInRewards(reply: unknown, month: number) {
  if (!reply || typeof reply !== "object") return;
  const {
    state,
    month: actualMonth,
    rewards,
  } = reply as Record<string, unknown>;
  if (
    state !== "ok" ||
    actualMonth !== month ||
    !Array.isArray(rewards) ||
    rewards.length < 1 ||
    rewards.length > 31
  )
    return;

  const parsed: CheckInReward[] = [];
  for (const reward of rewards) {
    if (!reward || typeof reward !== "object") return;
    const { name, count, icon } = reward as Record<string, unknown>;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 80 ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 1
    )
      return;
    parsed.push({ name: name.trim(), count, icon: rewardIcon(icon) });
  }
  return parsed;
}

export function currentCheckInRewardDay(
  rewardCount: number,
  claimedDays: number | undefined,
  signed: boolean
) {
  const day = claimedDays === undefined ? 0 : claimedDays + Number(!signed);
  return day > 0 && day <= rewardCount ? day : undefined;
}
