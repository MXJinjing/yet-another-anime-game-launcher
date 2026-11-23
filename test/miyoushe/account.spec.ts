import { describe, expect, it, vi } from "vitest";
import {
  bindAccount,
  createCheckIn,
  type Reply,
} from "../../src/miyoushe/account";

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
  });

  it("discards a response that arrives after cancellation", async () => {
    const controller = new AbortController();
    const bridge = replies("ok", "confirmed");
    bridge.mockImplementationOnce(async () => ({ state: "ok", qr: "image" }));
    bridge.mockImplementationOnce(async () => {
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
  it("does not contact the service without an eligible role", async () => {
    const bridge = replies();
    expect(await createCheckIn(bridge)("hk4e", undefined)).toBe("no-role");
    expect(bridge).not.toHaveBeenCalled();
  });

  it("coalesces repeated clicks and confirms the result for the selected role", async () => {
    const bridge = replies("unsigned", "ok", "signed");
    const run = createCheckIn(bridge);
    const first = run("hk4e", role);
    expect(run("hk4e", role)).toBe(first);
    expect(await first).toBe("signed");
    expect(bridge.mock.calls).toEqual(
      ["status", "sign", "status"].map(action => [
        action,
        ["hk4e", "12345", "cn_gf01"],
      ])
    );
  });

  it.each(["signed", "unbound", "manual", "limited", "network"] as const)(
    "does not submit when preflight returns %s",
    async state => {
      const bridge = replies(state);
      expect(await createCheckIn(bridge)("hk4e", role)).toBe(
        state === "signed" ? "already" : state
      );
      expect(bridge).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["manual", "limited", "unbound"] as const)(
    "stops immediately if a submission returns %s",
    async state => {
      const bridge = replies("unsigned", state);
      expect(await createCheckIn(bridge)("hk4e", role)).toBe(state);
      expect(bridge).toHaveBeenCalledTimes(2);
    }
  );

  it("queries again after a timeout and preflights any later retry", async () => {
    const bridge = replies("unsigned", "network", "network", "signed");
    const run = createCheckIn(bridge);
    expect(await run("hk4e", role)).toBe("uncertain");
    expect(await run("hk4e", role)).toBe("already");
    expect(bridge.mock.calls.map(([action]) => action)).toEqual([
      "status",
      "sign",
      "status",
      "status",
    ]);
  });
});
