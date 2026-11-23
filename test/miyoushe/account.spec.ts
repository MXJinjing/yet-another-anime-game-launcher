import { describe, expect, it, vi } from "vitest";
import {
  bindAccount,
  createCheckIn,
  type Reply,
} from "../../src/miyoushe/account";

const accountId = "d32b1eab-97c9-4814-b34f-d87cff7ec730";
const role = { uid: "12345", region: "cn_gf01", nickname: "Player" };
const wait = async () => undefined;

function replies(...states: Reply["state"][]) {
  const pending = [...states];
  return vi.fn(
    async (_action: string, _args?: readonly string[]): Promise<Reply> => ({
      state: pending.shift() ?? "ok",
      qr: _action === "start" ? "image" : undefined,
    })
  );
}

describe("Miyoushe QR binding", () => {
  it("commits only after confirmation and clears pending state", async () => {
    const bridge = replies("ok", "waiting", "scanned", "confirmed", "ok");
    const showQr = vi.fn();
    expect(
      await bindAccount(bridge, showQr, new AbortController().signal, wait)
    ).toBe("ok");
    expect(bridge.mock.calls.map(([action]) => action)).toEqual([
      "start",
      "poll",
      "poll",
      "poll",
      "finish",
      "cancel",
    ]);
    expect(showQr).toHaveBeenLastCalledWith("image", true);
    expect(bridge).toHaveBeenCalledWith("start");
  });

  it("discards a response that arrives after cancellation", async () => {
    const controller = new AbortController();
    const bridge = replies("ok", "confirmed");
    bridge.mockImplementationOnce(
      async (): Promise<Reply> => ({
        state: "ok",
        qr: "image",
      })
    );
    bridge.mockImplementationOnce(async (): Promise<Reply> => {
      controller.abort();
      return { state: "confirmed" };
    });
    expect(await bindAccount(bridge, vi.fn(), controller.signal, wait)).toBe(
      "cancelled"
    );
    expect(bridge.mock.calls.map(([action]) => action)).toEqual([
      "start",
      "poll",
      "cancel",
    ]);
  });

  it("passes the active game when verifying a confirmed session", async () => {
    const bridge = replies("ok", "confirmed", "unbound");
    const onConfirming = vi.fn();
    expect(
      await bindAccount(
        bridge,
        vi.fn(),
        new AbortController().signal,
        wait,
        "hkrpg",
        onConfirming
      )
    ).toBe("unbound");
    expect(onConfirming).toHaveBeenCalledTimes(1);
    expect(bridge).toHaveBeenCalledWith("start");
    expect(bridge).toHaveBeenCalledWith("finish", ["hkrpg"]);
    expect(bridge).toHaveBeenLastCalledWith("cancel");
  });

  it.each(["expired", "manual", "limited", "network"] as const)(
    "stops polling after %s",
    async state => {
      const bridge = replies("ok", state);
      expect(
        await bindAccount(bridge, vi.fn(), new AbortController().signal, wait)
      ).toBe(state);
      expect(bridge.mock.calls.map(([action]) => action)).toEqual([
        "start",
        "poll",
        "cancel",
      ]);
    }
  );
});

describe("Miyoushe daily check-in", () => {
  it("does not submit after a status check crosses Shanghai midnight", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-24T15:59:59Z"));
      const bridge = vi.fn(async (): Promise<Reply> => {
        vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
        return { state: "unsigned" };
      });
      expect(await createCheckIn(bridge)("hk4e", role, accountId)).toBe(
        "day-changed"
      );
      expect(bridge).toHaveBeenCalledOnce();
      expect(bridge).toHaveBeenCalledWith("status", [
        "hk4e",
        role.uid,
        role.region,
        accountId,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not contact the service without an eligible role", async () => {
    const bridge = replies();
    expect(await createCheckIn(bridge)("hk4e", undefined, accountId)).toBe(
      "no-role"
    );
    expect(bridge).not.toHaveBeenCalled();
  });

  it("coalesces repeated clicks and confirms the result for the selected role", async () => {
    const bridge = replies("unsigned", "ok", "signed");
    const run = createCheckIn(bridge);
    const first = run("hk4e", role, accountId);
    expect(run("hk4e", role, accountId)).toBe(first);
    expect(await first).toBe("signed");
    expect(bridge.mock.calls).toEqual(
      ["status", "sign", "status"].map(action => [
        action,
        ["hk4e", "12345", "cn_gf01", accountId],
      ])
    );
  });

  it.each([
    "signed",
    "unbound",
    "manual",
    "limited",
    "network",
    "first-check-in",
  ] as const)("does not submit when preflight returns %s", async state => {
    const bridge = replies(state);
    expect(await createCheckIn(bridge)("hk4e", role, accountId)).toBe(
      state === "signed" ? "already" : state
    );
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending result scoped to its own account and role", async () => {
    const bridge = replies("unsigned", "ok", "signed");
    const run = createCheckIn(bridge);
    const first = run("hk4e", role, accountId);
    expect(await run("hk4e", { ...role, uid: "54321" }, accountId)).toBe(
      "uncertain"
    );
    expect(
      await run("hk4e", role, "ab51a326-646c-4484-91cf-81378065565a")
    ).toBe("uncertain");
    expect(await first).toBe("signed");
    expect(bridge.mock.calls.every(([, args]) => args?.[1] === role.uid)).toBe(
      true
    );
  });

  it.each(["manual", "limited", "unbound"] as const)(
    "stops immediately if a submission returns %s",
    async state => {
      const bridge = replies("unsigned", state);
      expect(await createCheckIn(bridge)("hk4e", role, accountId)).toBe(state);
      expect(bridge).toHaveBeenCalledTimes(2);
    }
  );

  it("queries again after a timeout and preflights any later retry", async () => {
    const bridge = replies("unsigned", "network", "network", "signed");
    const run = createCheckIn(bridge);
    expect(await run("hk4e", role, accountId)).toBe("uncertain");
    expect(await run("hk4e", role, accountId)).toBe("already");
    expect(bridge.mock.calls.map(([action]) => action)).toEqual([
      "status",
      "sign",
      "status",
      "status",
    ]);
  });
});
