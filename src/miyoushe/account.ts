import type { MiyousheGame } from "./games";

export type GameRole = {
  uid: string;
  region: string;
  nickname: string;
};

export type Failure =
  | "unavailable"
  | "network"
  | "limited"
  | "manual"
  | "unbound"
  | "invalid";

export type Reply = {
  state:
    | Failure
    | "ok"
    | "waiting"
    | "scanned"
    | "confirmed"
    | "expired"
    | "signed"
    | "unsigned"
    | "already";
  qr?: string;
  roles?: GameRole[];
};

export type AccountBridge = (
  action: string,
  args?: readonly string[]
) => Promise<Reply>;

export async function bindAccount(
  bridge: AccountBridge,
  showQr: (qr: string, scanned: boolean) => void,
  signal: AbortSignal,
  wait: () => Promise<void> = () =>
    new Promise(resolve => setTimeout(resolve, 2500))
): Promise<Reply["state"] | "cancelled"> {
  if (signal.aborted) return "cancelled";
  try {
    const start = await bridge("start");
    if (signal.aborted) return "cancelled";
    if (start.state !== "ok" || !start.qr)
      return start.state === "ok" ? "invalid" : start.state;
    showQr(start.qr, false);
    const deadline = Date.now() + 120000;
    while (!signal.aborted && Date.now() < deadline) {
      await wait();
      if (signal.aborted) break;
      const poll = await bridge("poll");
      if (signal.aborted) break;
      if (poll.state === "confirmed") return (await bridge("finish")).state;
      if (poll.state !== "waiting" && poll.state !== "scanned")
        return poll.state;
      showQr(start.qr, poll.state === "scanned");
    }
    return signal.aborted ? "cancelled" : "expired";
  } finally {
    await bridge("cancel");
  }
}

export type CheckInResult = Reply["state"] | "uncertain" | "no-role";

export function createCheckIn(bridge: AccountBridge) {
  let pending: Promise<CheckInResult> | undefined;

  return (
    game: MiyousheGame,
    role: GameRole | undefined
  ): Promise<CheckInResult> => {
    if (!role) return Promise.resolve("no-role");
    if (pending) return pending;
    const args = [game, role.uid, role.region];
    pending = (async () => {
      const before = await bridge("status", args);
      if (before.state === "signed") return "already";
      if (before.state !== "unsigned") return before.state;
      const submitted = await bridge("sign", args);
      if (!["ok", "already", "network"].includes(submitted.state))
        return submitted.state;
      const after = await bridge("status", args);
      if (after.state === "signed")
        return submitted.state === "already" ? "already" : "signed";
      if (
        after.state === "unbound" ||
        after.state === "manual" ||
        after.state === "limited"
      )
        return after.state;
      return "uncertain";
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
