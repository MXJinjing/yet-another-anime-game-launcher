import { expect, it } from "vitest";
import {
  parseCheckInRewards,
  currentCheckInRewardDay,
} from "../../src/miyoushe/check-in-rewards";

it("accepts the requested month and only uses images from the award CDN", () => {
  const icon = "https://webstatic.mihoyo.com/upload/reward.png";
  const reply = {
    state: "ok",
    month: 11,
    rewards: [
      { name: "经验书", count: 2, icon },
      { name: "代币", count: 5000, icon: "https://example.com/award.png" },
    ],
  };
  expect(parseCheckInRewards(reply, 11)).toEqual([
    { name: "经验书", count: 2, icon },
    { name: "代币", count: 5000, icon: undefined },
  ]);
  expect(parseCheckInRewards(reply, 12)).toBeUndefined();
  expect(
    parseCheckInRewards(
      { ...reply, rewards: [{ name: "经验书", count: 0 }] },
      11
    )
  ).toBeUndefined();
});

it("selects today's reward from the cumulative count without guessing missing progress", () => {
  expect(currentCheckInRewardDay(30, 7, false)).toBe(8);
  expect(currentCheckInRewardDay(30, 7, true)).toBe(7);
  expect(currentCheckInRewardDay(28, 28, false)).toBeUndefined();
  expect(currentCheckInRewardDay(31, undefined, false)).toBeUndefined();
});
