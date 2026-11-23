import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Accessor,
} from "solid-js";
import {
  bindAccount,
  createCheckIn,
  type AccountBridge,
  type CheckInDiagnostic,
  type CheckInResult,
  type GameRole,
  type Reply,
  type SavedAccount,
} from "./account";
import {
  accountIdPattern,
  shanghaiDay,
  untilShanghaiMidnight,
  type AccountPreferences,
  type AccountSettings,
} from "./account-preferences";
import type { MiyousheGame } from "./games";
import {
  createMiyousheSessionHelper,
  usingMiyoushePrototype,
  type RequestMiyousheHelper,
} from "./local";

export type AccountStatus =
  | "official"
  | "loading"
  | "bound"
  | "unbound"
  | "expired"
  | "unavailable";

export function roleKey(role: GameRole) {
  return role.region + ":" + role.uid;
}

export function createMiyousheSession(
  game: Accessor<MiyousheGame | undefined>
) {
  const request: RequestMiyousheHelper = (...call) =>
    accountHelper().request(...call);
  const bridge: AccountBridge = (...call) => request<Reply>(...call);
  const checkIn = createCheckIn(bridge);
  const [accounts, setAccounts] = createSignal<SavedAccount[]>([]);
  const [activeId, setActiveId] = createSignal<string>();
  const [loading, setLoading] = createSignal(usingMiyoushePrototype);
  const [error, setError] = createSignal<Reply["state"]>();
  const [busy, setBusy] = createSignal(false);
  const [expired, setExpired] = createSignal<ReadonlySet<string>>(new Set());
  const [settings, setSettings] = createSignal<AccountSettings>({});
  const [revision, setRevision] = createSignal(0);
  const [rolesReply, setRolesReply] = createSignal<{
    id: string;
    game: MiyousheGame;
    reply: Reply;
  }>();
  const [roleRefresh, refreshRoles] = createSignal(0);
  const [checkInMenuOpen, setCheckInMenuOpen] = createSignal(false);
  const [checkInDay, setCheckInDay] = createSignal(shanghaiDay());
  const [checkingIn, setCheckingIn] = createSignal(false);
  const [checkInReply, setCheckInReply] = createSignal<{
    key: string;
    state: CheckInResult | "checking";
    claimedDays?: number;
  }>();
  const [signedRoles, setSignedRoles] = createSignal<{
    day: string;
    claimedDaysByRole: ReadonlyMap<string, number | undefined>;
  }>();
  let roleRequest = 0;
  let disposed = false;
  let started = false;
  let memory: ReturnType<typeof createMiyousheSessionHelper> | undefined;
  const closeAccountHelper = () => memory?.close();
  if (typeof window !== "undefined")
    window.addEventListener("pagehide", closeAccountHelper);
  onCleanup(() => {
    disposed = true;
    roleRequest++;
    if (typeof window !== "undefined")
      window.removeEventListener("pagehide", closeAccountHelper);
    closeAccountHelper();
  });

  function accountHelper() {
    return (memory ??= createMiyousheSessionHelper(() => {
      memory = undefined;
      if (disposed) return;
      batch(() => {
        setSettings({});
        applyRegistry({ state: "ok", accounts: [] });
        setError("unavailable");
      });
    }));
  }

  const active = createMemo(() =>
    accounts().find(account => account.id === activeId())
  );
  const status = createMemo<AccountStatus>(() => {
    if (!usingMiyoushePrototype) return "official";
    if (loading()) return "loading";
    const id = activeId();
    if (id) return expired().has(id) ? "expired" : "bound";
    return error() ? "unavailable" : "unbound";
  });
  const activeRoles = () => {
    const result = rolesReply();
    return result && result.id === activeId() && result.game === game()
      ? result.reply
      : undefined;
  };
  const roles = createMemo(() => activeRoles()?.roles ?? []);
  const preferences = () => settings()[activeId() ?? ""] ?? {};
  const selectedRole = createMemo(() => {
    if (status() !== "bound") return undefined;
    const currentGame = game();
    const saved = currentGame ? preferences()[currentGame]?.role : undefined;
    return (
      roles().find(role => roleKey(role) === saved) ??
      (roles().length === 1 ? roles()[0] : undefined)
    );
  });

  const checkInTarget = createMemo(() => {
    const id = activeId();
    const currentGame = game();
    const role = selectedRole();
    if (!id || !currentGame || !role) return;
    const day = checkInDay();
    const roleId = [id, currentGame, roleKey(role)].join(":");
    const accountRevision = revision();
    return {
      id,
      game: currentGame,
      role,
      roleId,
      day,
      accountRevision,
      key: [roleId, day, accountRevision].join(":"),
    };
  });
  const currentCheckIn = createMemo(() => {
    const target = checkInTarget();
    if (!target) return;
    const signed = signedRoles();
    if (
      signed?.day === target.day &&
      signed.claimedDaysByRole.has(target.roleId)
    )
      return {
        state: "signed" as const,
        claimedDays: signed.claimedDaysByRole.get(target.roleId),
      };
    const reply = checkInReply();
    return reply?.key === target.key ? reply : undefined;
  });
  const checkInStatus = () => currentCheckIn()?.state;

  let midnightTimer: ReturnType<typeof setTimeout>;
  function refreshCheckInDay() {
    const now = Date.now();
    const day = shanghaiDay(now);
    if (day !== checkInDay()) {
      batch(() => {
        setCheckInDay(day);
        setCheckInReply(undefined);
        setSignedRoles(undefined);
      });
    }
    clearTimeout(midnightTimer);
    midnightTimer = setTimeout(refreshCheckInDay, untilShanghaiMidnight(now));
  }
  refreshCheckInDay();
  if (typeof window !== "undefined") {
    window.addEventListener("focus", refreshCheckInDay);
    document.addEventListener("visibilitychange", refreshCheckInDay);
  }
  onCleanup(() => {
    clearTimeout(midnightTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", refreshCheckInDay);
      document.removeEventListener("visibilitychange", refreshCheckInDay);
    }
  });

  function openCheckInMenu() {
    batch(() => {
      refreshCheckInDay();
      // An unsigned role may have checked in on the official page since then.
      if (checkInStatus() === "unsigned") setCheckInReply(undefined);
      if (
        status() === "bound" &&
        activeRoles()?.state !== undefined &&
        activeRoles()?.state !== "ok"
      )
        refreshRoles(value => value + 1);
      setCheckInMenuOpen(true);
    });
  }

  type CheckInTarget = NonNullable<ReturnType<typeof checkInTarget>>;

  function recordCheckIn(
    target: CheckInTarget,
    state: CheckInResult,
    total?: number
  ) {
    if (disposed) return;
    const signed = state === "signed" || state === "already";
    const claimedDays =
      typeof total === "number" &&
      Number.isInteger(total) &&
      total >= Number(signed) &&
      total <= 31
        ? total
        : undefined;
    batch(() => {
      refreshCheckInDay();
      if (state === "unbound" && target.accountRevision === revision())
        markExpired(target.id);
      if (target.day !== checkInDay()) return;
      if (signed) {
        const saved = signedRoles();
        const countByRole = new Map(
          saved?.day === target.day ? saved.claimedDaysByRole : undefined
        );
        countByRole.set(target.roleId, claimedDays);
        setSignedRoles({
          day: target.day,
          claimedDaysByRole: countByRole,
        });
      }
      if (checkInTarget()?.key === target.key)
        setCheckInReply({ key: target.key, state, claimedDays });
    });
  }

  async function refreshCheckInStatus() {
    refreshCheckInDay();
    const target = checkInTarget();
    const status = checkInStatus();
    if (
      !target ||
      busy() ||
      checkingIn() ||
      status === "checking" ||
      status === "signed"
    )
      return;
    const pending = { key: target.key, state: "checking" } as const;
    setCheckInReply(pending);
    const reply = await bridge("status", [
      target.game,
      target.role.uid,
      target.role.region,
      target.id,
    ]);
    if (checkInReply() === pending)
      recordCheckIn(target, reply.state, reply.claimedDays);
  }

  createEffect(() => {
    if (
      checkInMenuOpen() &&
      checkInTarget() &&
      !busy() &&
      !checkingIn() &&
      !checkInStatus()
    )
      void refreshCheckInStatus();
  });

  function applyRegistry(reply: Reply, refreshedId?: string) {
    if (disposed) return false;
    if (reply.state !== "ok" || !Array.isArray(reply.accounts)) {
      setError(reply.state === "ok" ? "unavailable" : reply.state);
      return false;
    }
    const entries = reply.accounts.filter(account =>
      accountIdPattern.test(account.id)
    );
    const id = entries.find(
      account => account.id === reply.activeAccountId
    )?.id;
    batch(() => {
      const changed = Boolean(refreshedId) || activeId() !== id;
      const previous = new Map(
        accounts().map(account => [account.id, account])
      );
      setAccounts(
        entries.map(account => {
          const saved = previous.get(account.id);
          const profile = { ...saved?.profile, ...account.profile };
          return saved &&
            saved.profile.nickname === profile.nickname &&
            saved.profile.avatar === profile.avatar &&
            saved.profile.maskedId === profile.maskedId
            ? saved
            : { ...account, profile };
        })
      );
      setActiveId(id);
      setError(undefined);
      if (refreshedId)
        setExpired(
          ids => new Set([...ids].filter(value => value !== refreshedId))
        );
      if (changed) setRevision(value => value + 1);
      const old = settings();
      const kept = Object.fromEntries(
        Object.entries(old).filter(([id]) =>
          entries.some(account => account.id === id)
        )
      );
      if (Object.keys(kept).length !== Object.keys(old).length)
        setSettings(kept);
    });
    return true;
  }

  async function load() {
    const reply = await bridge("accounts");
    if (disposed) return;
    batch(() => {
      applyRegistry(reply);
      setLoading(false);
    });
  }

  createEffect(
    on(game, currentGame => {
      if (!usingMiyoushePrototype || !currentGame || started) return;
      started = true;
      void load();
    })
  );

  function markExpired(id: string) {
    setExpired(ids => new Set([...ids, id]));
  }

  createEffect(
    on(
      () => [activeId(), game(), revision(), roleRefresh()] as const,
      ([id, currentGame]) => {
        const request = ++roleRequest;
        setRolesReply(undefined);
        if (!id || !currentGame) return;
        void bridge("roles", [currentGame, id]).then(reply => {
          if (request !== roleRequest || disposed) return;
          batch(() => {
            if (reply.state === "unbound") markExpired(id);
            else if (reply.state === "ok" && expired().has(id))
              setExpired(
                ids => new Set([...ids].filter(value => value !== id))
              );
            setRolesReply({ id, game: currentGame, reply });
          });
        });
      }
    )
  );

  createEffect(
    on(activeId, id => {
      if (!id || active()?.profile.nickname) return;
      const request = revision();
      void bridge("profile", [id]).then(reply => {
        if (disposed || request !== revision()) return;
        const profile = reply.profile;
        if (profile)
          setAccounts(entries =>
            entries.map(account =>
              account.id === id ? { id, profile } : account
            )
          );
      });
    })
  );

  async function updateRegistry(action: "select" | "unbind", id: string) {
    if (busy() || loading()) return;
    setBusy(true);
    try {
      applyRegistry(await bridge(action, [id]));
    } finally {
      setBusy(false);
    }
  }

  async function login(
    currentGame: MiyousheGame,
    qr: (image: string, scanned: boolean) => void,
    signal: AbortSignal,
    confirming: () => void
  ) {
    if (!usingMiyoushePrototype || busy() || loading()) return "unavailable";
    setBusy(true);
    try {
      const state = await bindAccount(
        bridge,
        qr,
        signal,
        undefined,
        currentGame,
        confirming
      );
      if (state !== "ok") return state;
      const reply = await bridge("accounts");
      return applyRegistry(reply, reply.activeAccountId) ? "ok" : "unavailable";
    } finally {
      setBusy(false);
    }
  }

  function setPreference(
    id: string,
    currentGame: MiyousheGame,
    value: NonNullable<AccountPreferences[MiyousheGame]>
  ) {
    if (!accounts().some(account => account.id === id)) return;
    const all = settings();
    setSettings({ ...all, [id]: { ...all[id], [currentGame]: value } });
  }

  async function sign(diagnose?: CheckInDiagnostic): Promise<CheckInResult> {
    const day = checkInDay();
    refreshCheckInDay();
    if (day !== checkInDay()) return "day-changed";
    if (status() !== "bound") return "unbound";
    const target = checkInTarget();
    if (!target || busy()) return "no-role";
    const state = checkInStatus();
    if (state === "signed") return "already";
    if (checkingIn() || state === "checking") return "uncertain";
    if (state && state !== "unsigned") return state;
    setCheckingIn(true);
    try {
      let claimedDays: number | undefined;
      const result = await checkIn(
        target.game,
        target.role,
        target.id,
        (stage, reply) => {
          if (reply.state === "signed" && stage !== "sign")
            claimedDays = reply.claimedDays;
          diagnose?.(stage, reply);
        }
      );
      recordCheckIn(target, result, claimedDays);
      return result;
    } finally {
      setCheckingIn(false);
    }
  }

  return {
    accounts,
    active,
    status,
    error,
    busy,
    revision,
    roles,
    selectedRole,
    preferences,
    setPreference,
    checkInStatus,
    checkInDay,
    checkInClaimedDays: () => currentCheckIn()?.claimedDays,
    checkingIn,
    openCheckInMenu,
    closeCheckInMenu: () => setCheckInMenuOpen(false),
    refreshCheckInStatus,
    sign,
    request,
    rolesLoading: () => Boolean(activeId() && game() && !activeRoles()),
    roleError: () =>
      activeRoles()?.state === "ok" ? undefined : activeRoles()?.state,
    refreshRoles: () => refreshRoles(value => value + 1),
    select: (id: string) => updateRegistry("select", id),
    remove: (id: string) => updateRegistry("unbind", id),
    login,
  };
}

export type MiyousheSession = ReturnType<typeof createMiyousheSession>;
