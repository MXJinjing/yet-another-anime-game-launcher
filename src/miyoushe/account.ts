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
  | "first-check-in"
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
  profile?: { nickname?: string; maskedId: string; avatar?: string };
  code?: number;
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
    new Promise(resolve => setTimeout(resolve, 2500)),
  game?: MiyousheGame,
  onConfirming?: () => void
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
      if (poll.state === "confirmed") {
        onConfirming?.();
        return (await bridge("finish", game ? [game] : undefined)).state;
      }
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

export function createCheckIn(
  bridge: AccountBridge,
  diagnose?: (stage: "status" | "sign" | "verify", reply: Reply) => void
) {
  let pending: Promise<CheckInResult> | undefined;
  let target: string;

  return (
    game: MiyousheGame,
    role: GameRole | undefined
  ): Promise<CheckInResult> => {
    if (!role) return Promise.resolve("no-role");
    const args = [game, role.uid, role.region];
    const key = args.join(":");
    if (pending) return key === target ? pending : Promise.resolve("uncertain");
    target = key;
    pending = (async () => {
      const before = await bridge("status", args);
      diagnose?.("status", before);
      if (before.state === "signed") return "already";
      if (before.state !== "unsigned") return before.state;
      const submitted = await bridge("sign", args);
      diagnose?.("sign", submitted);
      if (!["ok", "already", "network"].includes(submitted.state))
        return submitted.state;
      const after = await bridge("status", args);
      diagnose?.("verify", after);
      if (after.state === "signed")
        return submitted.state === "already" ? "already" : "signed";
      if (
        after.state === "unbound" ||
        after.state === "first-check-in" ||
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
