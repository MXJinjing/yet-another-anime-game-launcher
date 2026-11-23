import type { MiyousheGame } from "./games";

export type AccountPreferences = Partial<
  Record<MiyousheGame, { role: string }>
>;

export type AccountSettings = Record<string, AccountPreferences>;

export const accountIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

const hour = 3_600_000;
const shanghaiOffset = 8 * hour;
const day = 24 * hour;

export function shanghaiDay(now = Date.now()) {
  return new Date(now + shanghaiOffset).toISOString().slice(0, 10);
}

export function untilShanghaiMidnight(now: number) {
  return day - ((now + shanghaiOffset) % day);
}
