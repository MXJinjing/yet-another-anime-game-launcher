import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { Reply, SavedAccount } from "../../src/miyoushe/account";
import type { MiyousheGame } from "../../src/miyoushe/games";
import {
  createMiyousheSessionHelper,
  type RequestMiyousheHelper,
} from "../../src/miyoushe/local";
import { createMiyousheSession } from "../../src/miyoushe/session";

const bridge = vi.fn<Parameters<RequestMiyousheHelper>, Promise<Reply>>();
const helper = vi.mocked(createMiyousheSessionHelper);
const close = vi.fn();

vi.mock("solid-js", () => vi.importActual("solid-js/dist/solid.js"));
vi.mock("../../src/miyoushe/local", () => ({
  usingMiyoushePrototype: true,
  createMiyousheSessionHelper: vi.fn(),
}));
const first: SavedAccount = {
  id: "0bc26315-d43b-404e-8bf2-31788b9a7ea1",
  profile: { nickname: "First", maskedId: "••••0001" },
};
const second: SavedAccount = {
  id: "5b0f9fc4-a3d2-4ea2-bb28-f2909f904e5e",
  profile: { nickname: "Second", maskedId: "••••0002" },
};
const firstRole = {
  uid: "100000001",
  nickname: "First role",
  region: "cn_gf01",
};
const secondRole = {
  uid: "100000002",
  nickname: "Second role",
  region: "cn_gf01",
};

let dispose: (() => void) | undefined;
function createSession() {
  helper.mockReturnValue({
    request: <T>(...call: Parameters<RequestMiyousheHelper>) =>
      bridge(...call) as Promise<T>,
    close,
  });
  return createRoot(cleanup => {
    dispose = cleanup;
    const [game, setGame] = createSignal<MiyousheGame | undefined>("hk4e");
    return { session: createMiyousheSession(game), setGame };
  });
}

afterEach(() => {
  dispose?.();
  vi.resetAllMocks();
  vi.useRealTimers();
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it("uses a temporary session for login, roles and check-in and starts again signed out", async () => {
  vi.useFakeTimers();
  let signedIn = false;
  bridge.mockImplementation(async action => {
    switch (action) {
      case "accounts":
        return {
          state: "ok",
          accounts: signedIn ? [first] : [],
          activeAccountId: signedIn ? first.id : undefined,
        };
      case "start":
        return { state: "ok", qr: "test-image" };
      case "poll":
        return { state: "confirmed" };
      case "finish":
        signedIn = true;
        return { state: "ok" };
      case "roles":
        return { state: "ok", roles: [firstRole] };
      case "status":
        return { state: "signed" };
      default:
        return { state: "ok" };
    }
  });
  const { session } = createSession();
  await vi.advanceTimersByTimeAsync(0);
  const login = session.login(
    "hk4e",
    vi.fn(),
    new AbortController().signal,
    vi.fn()
  );
  await vi.advanceTimersByTimeAsync(2500);
  expect(await login).toBe("ok");
  expect(session.selectedRole()).toEqual(firstRole);
  expect(await session.sign()).toBe("already");
  await session.request("wish-history", [], "{}");
  expect(bridge).toHaveBeenCalledWith("wish-history", [], "{}");
  close.mockImplementationOnce(() => {
    signedIn = false;
  });
  dispose?.();
  expect(close).toHaveBeenCalledOnce();
  const { session: reopened } = createSession();
  await vi.advanceTimersByTimeAsync(0);
  expect(reopened.accounts()).toEqual([]);
  expect(reopened.status()).toBe("unbound");
  expect(reopened.preferences()).toEqual({});
});

it("keeps the current account during scanning and selects the newly signed-in account on completion", async () => {
  vi.useFakeTimers();
  let finished = false;
  bridge.mockImplementation(async action => {
    switch (action) {
      case "accounts":
        return {
          state: "ok",
          accounts: finished ? [first, second] : [first],
          activeAccountId: finished ? second.id : first.id,
        };
      case "start":
        return { state: "ok", qr: "test-image" };
      case "poll":
        return { state: "confirmed" };
      case "finish":
        finished = true;
        return { state: "ok" };
      case "roles":
        return { state: "ok", roles: [finished ? secondRole : firstRole] };
      default:
        return { state: "ok" };
    }
  });

  const { session } = createSession();
  await vi.advanceTimersByTimeAsync(0);
  const showQr = vi.fn();
  const result = session.login(
    "hk4e",
    showQr,
    new AbortController().signal,
    vi.fn()
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(showQr).toHaveBeenCalledWith("test-image", false);
  expect(session.active()).toEqual(first);

  await vi.advanceTimersByTimeAsync(2500);
  expect(await result).toBe("ok");
  expect(session.accounts()).toEqual([first, second]);
  expect(session.active()).toEqual(second);
  expect(session.selectedRole()).toEqual(secondRole);
});

it("switches the active profile and discards a late role reply for the previous account", async () => {
  let finishFirst: ((reply: Reply) => void) | undefined;
  let expired = false;
  bridge.mockImplementation(async (action, args) => {
    if (action === "accounts" || action === "select") {
      return {
        state: "ok",
        accounts: [first, second],
        activeAccountId: args?.[0] ?? first.id,
      };
    }
    if (action === "roles" && args?.[1] === first.id) {
      return new Promise(resolve => {
        finishFirst = resolve;
      });
    }
    if (action === "status") return { state: "signed" };
    if (action === "roles" && expired) return { state: "unbound" };
    return { state: "ok", roles: [secondRole] };
  });

  const { session, setGame } = createSession();
  await settle();
  expect(session.active()).toEqual(first);
  expect(session.rolesLoading()).toBe(true);
  await session.select(second.id);
  await settle();
  finishFirst?.({ state: "ok", roles: [firstRole] });
  await settle();

  expect(session.active()).toEqual(second);
  expect(session.selectedRole()).toEqual(secondRole);
  session.setPreference(second.id, "hk4e", {
    role: "cn_gf01:100000002",
  });
  expect(session.preferences().hk4e?.role).toBe("cn_gf01:100000002");
  expect(await session.sign()).toBe("already");
  expect(bridge).toHaveBeenCalledWith("status", [
    "hk4e",
    secondRole.uid,
    secondRole.region,
    second.id,
  ]);
  expired = true;
  session.refreshRoles();
  await settle();
  expect(session.status()).toBe("expired");
  expect(session.selectedRole()).toBeUndefined();
  setGame("hkrpg");
  expect(bridge).toHaveBeenCalledWith("roles", ["hkrpg", second.id]);
});

it("checks status without submitting on menu open and refreshes after Shanghai midnight", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T15:59:59Z"));
  bridge.mockImplementation(async action => {
    if (action === "accounts")
      return { state: "ok", accounts: [first], activeAccountId: first.id };
    if (action === "roles") return { state: "ok", roles: [firstRole] };
    return {
      state:
        Date.now() < Date.parse("2026-11-24T16:00:00Z") ? "signed" : "unsigned",
    };
  });

  const { session } = createSession();
  await vi.advanceTimersByTimeAsync(0);
  expect(bridge.mock.calls.map(([action]) => action)).toEqual([
    "accounts",
    "roles",
  ]);
  session.openCheckInMenu();
  expect(session.checkInStatus()).toBe("checking");
  await vi.advanceTimersByTimeAsync(0);
  expect(session.checkInStatus()).toBe("signed");
  expect(await session.sign()).toBe("already");
  expect(bridge.mock.calls.map(([action]) => action)).toEqual([
    "accounts",
    "roles",
    "status",
  ]);

  await vi.advanceTimersByTimeAsync(1000);
  expect(session.checkInStatus()).toBe("unsigned");
  expect(bridge.mock.calls.map(([action]) => action)).toEqual([
    "accounts",
    "roles",
    "status",
    "status",
  ]);
});

it("keeps confirmed check-ins scoped to the selected role", async () => {
  bridge.mockImplementation(async (action, args) => {
    if (action === "accounts")
      return { state: "ok", accounts: [first], activeAccountId: first.id };
    if (action === "roles")
      return { state: "ok", roles: [firstRole, secondRole] };
    return { state: args?.[1] === firstRole.uid ? "signed" : "unsigned" };
  });
  const { session } = createSession();
  await settle();
  session.openCheckInMenu();
  await settle();
  expect(bridge).not.toHaveBeenCalledWith("status", expect.anything());

  session.setPreference(first.id, "hk4e", { role: "cn_gf01:100000001" });
  await settle();
  expect(session.checkInStatus()).toBe("signed");
  session.setPreference(first.id, "hk4e", { role: "cn_gf01:100000002" });
  await settle();
  expect(session.checkInStatus()).toBe("unsigned");
  session.setPreference(first.id, "hk4e", { role: "cn_gf01:100000001" });
  expect(session.checkInStatus()).toBe("signed");
  expect(
    bridge.mock.calls.filter(([action]) => action === "status")
  ).toHaveLength(2);
});

it("updates cumulative reward progress only when the service confirms a completed check-in", async () => {
  let submitted = false;
  bridge.mockImplementation(async action => {
    if (action === "accounts")
      return { state: "ok", accounts: [first], activeAccountId: first.id };
    if (action === "roles") return { state: "ok", roles: [firstRole] };
    if (action === "sign") {
      submitted = true;
      return { state: "ok" };
    }
    return submitted
      ? { state: "signed", claimedDays: 8 }
      : { state: "unsigned", claimedDays: 7 };
  });
  const { session } = createSession();
  await settle();
  session.openCheckInMenu();
  await settle();
  expect(session.checkInClaimedDays()).toBe(7);
  expect(await session.sign()).toBe("signed");
  expect(session.checkInClaimedDays()).toBe(8);
  expect(await session.sign()).toBe("already");
});

it("discards a previous day's pending status response when midnight passes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T15:59:59Z"));
  let finish: ((reply: Reply) => void) | undefined;
  bridge.mockImplementation(async action => {
    if (action === "accounts")
      return { state: "ok", accounts: [first], activeAccountId: first.id };
    if (action === "roles") return { state: "ok", roles: [firstRole] };
    if (finish) return { state: "unsigned" };
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const { session } = createSession();
  await vi.advanceTimersByTimeAsync(0);
  session.openCheckInMenu();
  expect(session.checkInStatus()).toBe("checking");
  await vi.advanceTimersByTimeAsync(1000);
  expect(session.checkInStatus()).toBe("unsigned");
  finish?.({ state: "signed" });
  await vi.advanceTimersByTimeAsync(0);
  expect(session.checkInStatus()).toBe("unsigned");
});

it.each([
  { removed: first, kept: second, keptRole: secondRole },
  { removed: second, kept: first, keptRole: firstRole },
])(
  "removes only the targeted account and keeps the remaining role preferences",
  async ({ removed, kept, keptRole }) => {
    const preferences = {
      [first.id]: { hk4e: { role: "cn_gf01:100000001" } },
      [second.id]: { hk4e: { role: "cn_gf01:100000002" } },
    };
    bridge.mockImplementation(async action => {
      if (action === "accounts")
        return {
          state: "ok",
          accounts: [first, second],
          activeAccountId: first.id,
        };
      if (action === "unbind")
        return { state: "ok", accounts: [kept], activeAccountId: kept.id };
      return { state: "ok", roles: [keptRole] };
    });

    const { session } = createSession();
    await settle();
    session.setPreference(first.id, "hk4e", preferences[first.id].hk4e);
    session.setPreference(second.id, "hk4e", preferences[second.id].hk4e);
    const before = session.revision();
    await session.remove(removed.id);
    await settle();

    expect(bridge).toHaveBeenCalledWith("unbind", [removed.id]);
    expect(session.active()).toEqual(kept);
    expect(session.revision()).toBe(before + Number(removed.id === first.id));
    expect(session.preferences()).toEqual(preferences[kept.id]);
  }
);
