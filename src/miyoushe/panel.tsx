import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { AppModal, AppModalButton } from "@src/components/app-modal";
import { open, writeFile } from "@platform/neutralino";
import {
  bindAccount,
  createCheckIn,
  type CheckInResult,
  type GameRole,
  type Reply,
} from "./account";
import {
  readAccountPreferences,
  shanghaiDay,
  storeAccountPreferences,
  type AccountPreferences,
} from "./account-preferences";
import userIcon from "@src/assets/icons/user.svg";
import { miyousheCheckInUrl, type MiyousheGame } from "./games";
import { PullDashboard } from "./pull-dashboard";
import { initialCatalog } from "./genshin-catalog";
import {
  readGenshinCatalog,
  refreshGenshinCatalog,
} from "./genshin-catalog-local";
import { readGameHistory } from "./history-local";
import { GameIcon } from "@src/launcher/components/game-icon";
import {
  mergeLocalArchive,
  readGachaArchive,
  runMiyoushePrototype,
  usingMiyoushePrototype,
} from "./local";
import {
  exportUigf,
  parseUigf,
  summarizePulls,
  type GachaArchive,
} from "./uigf";
import "./panel.css";
import "./account.css";

export type MiyousheHomeStatus = {
  pulls: number | "loading" | "unavailable";
  checkIn:
    | "official"
    | "loading"
    | "bound"
    | "unbound"
    | "expired"
    | "unavailable";
  verifiedDate?: string;
};

export function MiyoushePanel(props: {
  dialog?: "pulls" | "account" | "check-in";
  installDir?: string;
  winePrefix?: string;
  onOpenAccount: () => void;
  onClose: () => void;
  onHomeStatusChange?: (status: MiyousheHomeStatus) => void;
  game: MiyousheGame;
  title: string;
  icon?: string;
  chinese: boolean;
  accent: string;
  accentText: string;
}) {
  const t = (zh: string, en: string) => (props.chinese ? zh : en);
  const panelTheme = () => ({
    "--miyo-accent": props.accent,
    "--miyo-accent-text": props.accentText,
  });
  const [archive, setArchive] = createSignal<GachaArchive>({});
  const [archiveLoaded, setArchiveLoaded] = createSignal(false);
  const [storageError, setStorageError] = createSignal(false);
  const [importBusy, setImportBusy] = createSignal(false);
  const [fileNotice, setFileNotice] = createSignal("");
  const [catalog, setCatalog] = createSignal(initialCatalog);
  const catalogItems = createMemo(
    () => new Map(catalog().items.map(item => [item.id, item]))
  );
  const historyChecked = new Map<string, number>();
  const [selectedUid, setSelectedUid] = createSignal("");
  const [linkError, setLinkError] = createSignal(false);
  const [poolType, setPoolType] = createSignal("");
  const [visiblePulls, setVisiblePulls] = createSignal(50);
  const [bindingStatus, setBindingStatus] = createSignal<
    MiyousheHomeStatus["checkIn"]
  >(usingMiyoushePrototype ? "loading" : "official");
  const [preferences, setPreferences] = createSignal<AccountPreferences>({});
  const [today, setToday] = createSignal(shanghaiDay());
  const bound = () => bindingStatus() === "bound";
  const [roles, setRoles] = createSignal<GameRole[]>([]);
  const [rolesLoading, setRolesLoading] = createSignal(false);
  const [roleError, setRoleError] = createSignal<Reply["state"]>();
  const [profile, setProfile] = createSignal<Reply["profile"]>();
  const [profileLoading, setProfileLoading] = createSignal(false);
  const selectedRole = createMemo(
    () =>
      roles().find(role => key(role) === preferences()[props.game]?.role) ??
      (roles().length === 1 ? roles()[0] : undefined)
  );
  const [working, setWorking] = createSignal(false);
  const [notice, setNotice] = createSignal<CheckInResult | "cancelled">();
  const [qr, setQr] = createSignal<{ image: string; scanned: boolean }>();
  const [qrLoading, setQrLoading] = createSignal(false);
  const [qrFinishing, setQrFinishing] = createSignal(false);
  const [diagnostic, setDiagnostic] = createSignal<{
    stage: "status" | "sign" | "verify";
    code?: number;
  }>();
  let login: AbortController | undefined;
  let fileInput: HTMLInputElement | undefined;
  let profileRequest = 0;
  let writingPreferences = Promise.resolve();
  const checkIn = createCheckIn(runMiyoushePrototype, (stage, reply) => {
    if (
      reply.state !== "ok" &&
      reply.state !== "signed" &&
      reply.state !== "unsigned"
    )
      setDiagnostic({ stage, code: reply.code });
  });
  const requiresManualAction = () =>
    notice() === "first-check-in" ||
    notice() === "manual" ||
    notice() === "limited";

  const accounts = () => archive()[props.game] ?? [];
  const active = createMemo(
    () =>
      accounts().find(account => account.uid === selectedUid()) ?? accounts()[0]
  );
  const summary = createMemo(() => {
    const account = active();
    return account ? summarizePulls(account) : undefined;
  });
  const currentPool = createMemo(() => {
    const pools = summary()?.pools ?? [];
    return pools.find(pool => pool.type === poolType()) ?? pools[0];
  });

  function key(role: GameRole) {
    return role.region + ":" + role.uid;
  }

  function persistPreferences(value: AccountPreferences) {
    setPreferences(value);
    writingPreferences = writingPreferences
      .catch(() => undefined)
      .then(() => storeAccountPreferences(value));
    void writingPreferences.catch(() => setNotice("unavailable"));
  }

  async function refreshRoles(game?: MiyousheGame, loadProfile = false) {
    const request = ++profileRequest;
    setRoles([]);
    setRoleError(undefined);
    setRolesLoading(Boolean(game));
    setProfileLoading(loadProfile);
    const binding = await runMiyoushePrototype("bound");
    if (request !== profileRequest) return;
    if (binding.state !== "ok") {
      setBindingStatus(binding.state === "unbound" ? "unbound" : "unavailable");
      setRolesLoading(false);
      setProfileLoading(false);
      setProfile(undefined);
      if (binding.state !== "unbound") setRoleError(binding.state);
      return;
    }
    if (!game) {
      setBindingStatus(previous =>
        previous === "expired" ? "expired" : "bound"
      );
      return;
    }
    const roleReply = await runMiyoushePrototype("roles", [game]);
    if (request !== profileRequest) return;
    setRolesLoading(false);
    if (roleReply.state !== "ok") {
      setBindingStatus(roleReply.state === "unbound" ? "expired" : "bound");
      setRoleError(roleReply.state);
      setProfileLoading(false);
      return;
    }
    setBindingStatus("bound");
    setRoles(roleReply.roles ?? []);
    if (!loadProfile) return;
    const profileReply = await runMiyoushePrototype("profile");
    if (request !== profileRequest) return;
    setProfileLoading(false);
    setProfile(profileReply.profile);
    if (profileReply.state !== "ok") setNotice(profileReply.state);
  }

  createEffect(
    on(
      () => props.dialog,
      dialog => {
        if (dialog !== "account") login?.abort();
        if (dialog !== "pulls" && archiveLoaded()) return;
        if (!importBusy()) {
          void readGachaArchive().then(
            value => {
              if (importBusy()) return;
              setArchive(value);
              setArchiveLoaded(true);
              setStorageError(false);
            },
            () => {
              setArchiveLoaded(true);
              setStorageError(true);
            }
          );
        }
      }
    )
  );

  createEffect(
    on(
      () => [props.dialog, props.game] as const,
      ([dialog, game]) => {
        profileRequest++;
        setLinkError(false);
        if (dialog === "pulls") {
          setPoolType("");
          setVisiblePulls(50);
        }
        setToday(shanghaiDay());
        setNotice(undefined);
        setDiagnostic(undefined);
        if (dialog !== "account") login?.abort();
        if (usingMiyoushePrototype && !working())
          void refreshRoles(dialog ? game : undefined, dialog === "account");
      }
    )
  );
  createEffect(() => {
    props.onHomeStatusChange?.({
      pulls: storageError()
        ? "unavailable"
        : archiveLoaded()
        ? accounts().reduce((total, account) => total + account.list.length, 0)
        : "loading",
      checkIn: bindingStatus(),
      verifiedDate:
        bound() &&
        (!props.dialog ||
          (selectedRole() &&
            key(selectedRole()!) === preferences()[props.game]?.role)) &&
        today() === preferences()[props.game]?.verifiedDay
          ? new Intl.DateTimeFormat(props.chinese ? "zh-CN" : "en-GB", {
              timeZone: "Asia/Shanghai",
              day: "numeric",
              month: "numeric",
            }).format(new Date(today() + "T00:00:00+08:00"))
          : undefined,
    });
  });
  if (usingMiyoushePrototype) {
    const initialPreferences = preferences();
    void readAccountPreferences().then(value => {
      if (initialPreferences === preferences()) setPreferences(value);
    });
  }
  const dayTimer = setInterval(() => setToday(shanghaiDay()), 60_000);
  onCleanup(() => {
    profileRequest++;
    login?.abort();
    clearInterval(dayTimer);
  });

  async function startLogin() {
    if (working()) return;
    setWorking(true);
    setQrLoading(true);
    setNotice(undefined);
    profileRequest++;
    const game = props.game;
    const controller = new AbortController();
    login = controller;
    try {
      const state = await bindAccount(
        runMiyoushePrototype,
        (image, scanned) => {
          setQrLoading(false);
          setQr({ image, scanned });
        },
        controller.signal,
        undefined,
        game,
        () => setQrFinishing(true)
      );
      if (state === "ok") {
        setProfile(undefined);
        persistPreferences({});
        await refreshRoles(props.game, props.dialog === "account");
      }
      if (props.dialog === "account") setNotice(state);
    } finally {
      login = undefined;
      setQr(undefined);
      setQrLoading(false);
      setQrFinishing(false);
      setWorking(false);
      if (props.dialog !== "account")
        void refreshRoles(props.dialog ? props.game : undefined);
    }
  }

  async function unbind() {
    if (working()) return;
    setWorking(true);
    profileRequest++;
    try {
      const { state } = await runMiyoushePrototype("unbind");
      if (state === "ok") {
        setBindingStatus("unbound");
        setRoles([]);
        setRoleError(undefined);
        setProfile(undefined);
        persistPreferences({});
        setNotice(undefined);
      } else setNotice(state);
    } finally {
      setWorking(false);
    }
  }

  async function sign() {
    const role = selectedRole();
    if (
      working() ||
      rolesLoading() ||
      requiresManualAction() ||
      !bound() ||
      !role
    )
      return;
    const game = props.game;
    setWorking(true);
    setNotice(undefined);
    setDiagnostic(undefined);
    try {
      const result = await checkIn(game, role);
      if (props.game === game && props.dialog === "check-in") setNotice(result);
      if (result === "unbound") setBindingStatus("expired");
      if (result === "signed" || result === "already") {
        const day = shanghaiDay();
        setToday(day);
        persistPreferences({
          ...preferences(),
          [game]: { role: key(role), verifiedDay: day },
        });
      }
    } finally {
      setWorking(false);
      if (props.game !== game || props.dialog !== "check-in")
        void refreshRoles(
          props.dialog ? props.game : undefined,
          props.dialog === "account"
        );
    }
  }

  createEffect(
    on(
      () => props.dialog === "pulls" && props.game === "hk4e",
      open => {
        if (!open) return;
        void readGenshinCatalog().then(async current => {
          setCatalog(current);
          setCatalog(await refreshGenshinCatalog(current));
        });
      }
    )
  );

  createEffect(
    on(
      () =>
        [
          props.dialog,
          props.game,
          bound() ? selectedRole()?.uid : undefined,
        ] as const,
      ([dialog, game, uid]) => {
        if (
          (dialog === "pulls" || dialog === "account") &&
          game === "hk4e" &&
          uid &&
          usingMiyoushePrototype
        )
          void importGame("cached", uid);
      }
    )
  );

  async function mergeIncoming(incoming: GachaArchive, uid?: string) {
    const merged = await mergeLocalArchive(incoming);
    setArchive(merged);
    setArchiveLoaded(true);
    setStorageError(false);
    if (uid) setSelectedUid(uid);
    setVisiblePulls(50);
  }

  async function importGame(mode: "cached" | "authorized", uid?: string) {
    if (importBusy()) return;
    if (mode === "cached" && uid) {
      const now = Date.now();
      if (now - (historyChecked.get(uid) ?? 0) < 5 * 60 * 1000) return;
      historyChecked.set(uid, now);
    }
    setImportBusy(true);
    try {
      const reply = await readGameHistory(
        props.installDir,
        props.winePrefix,
        mode,
        uid
      );
      if (reply.state !== "ok" || !reply.history) {
        if (mode === "cached") return;
        if (reply.state === "no-history" || reply.state === "history-expired") {
          setFileNotice(
            t(
              "请在游戏内打开祈愿历史后重试，或导入 UIGF 文件。",
              "Open Wish History in the game and try again, or import a UIGF file."
            )
          );
        } else if (reply.state === "manual" || reply.state === "limited") {
          setFileNotice(
            t(
              "官方服务暂时限制读取。请在游戏内查看祈愿历史后再试。",
              "The official service restricted access. Check Wish History in the game before retrying."
            )
          );
        } else {
          setFileNotice(
            t("暂时无法读取游戏记录。", "Could not read game history.")
          );
        }
        return;
      }
      const { uid: historyUid, list } = reply.history;
      if (uid && uid !== historyUid) return;
      const catalogByName = new Map(
        catalog().items.map(item => [item.name, item.id])
      );
      const incoming = parseUigf(
        exportUigf(
          {
            hk4e: [
              {
                uid: historyUid,
                timezone: 8,
                lang: "zh-cn",
                sources: ["game"],
                list: list.map(pull => ({
                  ...pull,
                  item_id:
                    pull.item_id || catalogByName.get(pull.name ?? "") || "",
                })),
              },
            ],
          },
          true
        ),
        true
      );
      await mergeIncoming(
        incoming,
        props.game === "hk4e" ? historyUid : undefined
      );
      if (props.game === "hk4e")
        setFileNotice(t("已更新游戏记录。", "Game history updated."));
    } catch {
      if (mode === "authorized")
        setFileNotice(
          t(
            "游戏记录无法导入，原有档案已保留。",
            "Game history import failed. Your archive is intact."
          )
        );
    } finally {
      setImportBusy(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file || importBusy()) return;
    setImportBusy(true);
    try {
      const incoming = parseUigf(await file.text());
      for (const accounts of Object.values(incoming))
        for (const account of accounts) account.sources = ["file"];
      await mergeIncoming(incoming);
      setFileNotice(t("导入完成。", "Import complete."));
    } catch {
      setFileNotice(
        t(
          "导入失败。请检查文件格式和本地存储权限。",
          "Import failed. Check the file format and local storage access."
        )
      );
    } finally {
      setImportBusy(false);
    }
  }

  async function exportFile() {
    if (importBusy() || !accounts().length) return;
    setImportBusy(true);
    try {
      const game = props.game;
      const snapshot = { [game]: accounts() };
      const path = await Neutralino.os.showSaveDialog(
        t("导出抽卡记录", "Export pull history"),
        {
          defaultPath: game + "-uigf-v4.2.json",
        }
      );
      if (path) {
        await writeFile(path, exportUigf(snapshot));
        setFileNotice(t("导出完成。", "Export complete."));
      }
    } catch {
      setFileNotice(t("无法写入导出文件。", "Could not write export file."));
    } finally {
      setImportBusy(false);
    }
  }

  const messages = () => ({
    unavailable: t(
      "本地米游社原型不可用。",
      "The local Miyoushe prototype is unavailable."
    ),
    invalid: t(
      "米游社返回了未识别的结果。",
      "Miyoushe returned an unrecognized result."
    ),
    unbound: t(
      "登录已过期，请重新扫码。",
      "Session expired. Scan again to reconnect."
    ),
    "no-history": t(
      "游戏尚未缓存抽卡记录。",
      "No pull history was cached by the game."
    ),
    "history-expired": t(
      "游戏缓存授权已过期。",
      "The cached game authorization expired."
    ),
    network: t("暂时无法连接米游社。", "Could not reach Miyoushe."),
    limited: t(
      "请求受限，请稍后再试。",
      "Request rate limited. Try again later."
    ),
    "first-check-in": t(
      "此角色需先在官方签到页完成首次签到。",
      "This character must first check in on the official page."
    ),
    manual: t(
      "需要在官方签到页面手动处理。",
      "Continue on the official check-in page."
    ),
    expired: t("二维码已过期。", "The QR code expired."),
    cancelled: t("已取消扫码。", "Scan cancelled."),
    ok: t("账号已绑定。", "Account connected."),
    signed: t("今日签到成功。", "Checked in for today."),
    already: t("今日已签到。", "Already checked in today."),
    uncertain: t(
      "暂时无法确认签到结果，再试时会先查询状态。",
      "Check-in could not be confirmed. Retrying checks your current status first."
    ),
    "no-role": t("请选择签到角色。", "Select a character to check in."),
    waiting: "",
    scanned: "",
    confirmed: "",
    unsigned: "",
  });

  function openLink(url: string) {
    const dialog = props.dialog;
    setLinkError(false);
    void open(url).catch(() => {
      if (props.dialog === dialog) setLinkError(true);
    });
  }

  function RolePicker() {
    return (
      <Show
        when={!rolesLoading()}
        fallback={
          <p role="status">{t("正在读取角色…", "Checking characters…")}</p>
        }
      >
        <Show
          when={!roleError()}
          fallback={<p role="status">{messages()[roleError()!]}</p>}
        >
          <Show
            when={roles().length}
            fallback={
              <p class="miyoushe-muted">
                {t(
                  "当前没有可用的官服角色。",
                  "No eligible official CN characters are available."
                )}
              </p>
            }
          >
            <label class="miyoushe-field">
              {t("当前角色", "Current character")}
              <select
                disabled={working()}
                value={selectedRole() ? key(selectedRole()!) : ""}
                onChange={event => {
                  persistPreferences({
                    ...preferences(),
                    [props.game]: { role: event.currentTarget.value },
                  });
                  setNotice(undefined);
                  setDiagnostic(undefined);
                }}
              >
                <Show when={!selectedRole()}>
                  <option value="" disabled>
                    {t("请选择角色", "Select a character")}
                  </option>
                </Show>
                <For each={roles()}>
                  {role => (
                    <option value={key(role)}>
                      {role.nickname || role.region} · ••••{role.uid.slice(-4)}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
        </Show>
      </Show>
    );
  }

  function DialogTitle(title: { text: string }) {
    return (
      <span class="miyoushe-brand">
        <Show when={props.icon}>
          {icon => (
            <span class="miyoushe-brand-icon">
              <GameIcon src={icon()} title={props.title} channel={props.game} />
            </span>
          )}
        </Show>
        <span>
          <strong>{title.text}</strong>
          <span class="miyoushe-brand-game">{props.title}</span>
        </span>
      </span>
    );
  }

  function LinkError() {
    return (
      <Show when={linkError()}>
        <p class="miyoushe-file-notice" role="status">
          {t("无法打开系统浏览器。", "Could not open the system browser.")}
        </p>
      </Show>
    );
  }

  return (
    <>
      <AppModal
        opened={props.dialog === "pulls"}
        onClose={props.onClose}
        contentClass="miyoushe-modal miyoushe-pull-modal"
        bodyClass="miyoushe-modal-body"
        title={
          <div class="miyoushe-pull-header" style={panelTheme()}>
            <strong>{t("抽卡分析", "Pull analysis")}</strong>
            <div class="miyoushe-pull-actions">
              <button
                class="miyoushe-link-button"
                type="button"
                title={t("UIGF v4.2 格式说明", "UIGF v4.2 format guide")}
                onClick={() =>
                  openLink("https://uigf.org/zh/standards/uigf.html")
                }
              >
                UIGF <span aria-hidden="true">↗</span>
              </button>
              <Show
                when={
                  props.game === "hk4e" &&
                  usingMiyoushePrototype &&
                  props.installDir
                }
              >
                <AppModalButton
                  disabled={importBusy()}
                  onClick={() =>
                    void importGame(
                      "authorized",
                      bound() ? selectedRole()?.uid : undefined
                    )
                  }
                >
                  {t("从游戏读取", "Read from game")}
                </AppModalButton>
              </Show>
              <Show when={active()}>
                <AppModalButton
                  disabled={importBusy()}
                  onClick={() => void exportFile()}
                >
                  {t("导出", "Export")}
                </AppModalButton>
              </Show>
              <AppModalButton
                variant="primary"
                disabled={importBusy()}
                onClick={() => fileInput?.click()}
              >
                {t("导入", "Import")}
              </AppModalButton>
            </div>
          </div>
        }
        maxWidth={1040}
      >
        <div class="miyoushe-panel" style={panelTheme()}>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".json,application/json"
            onChange={event => {
              void importFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <Show when={storageError()}>
            <p role="status">
              {t(
                "无法读取本地抽卡档案。",
                "Could not read the local pull archive."
              )}
            </p>
          </Show>
          <Show when={fileNotice()}>
            <p class="miyoushe-file-notice" role="status">
              {fileNotice()}
            </p>
          </Show>
          <Show
            when={active()}
            fallback={
              <section
                class="miyoushe-empty"
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  void importFile(event.dataTransfer?.files[0]);
                }}
              >
                <span class="miyoushe-empty-icon" aria-hidden="true">
                  ✦
                </span>
                <h3>{t("导入你的抽卡记录", "Import your pull history")}</h3>
                <p>
                  {t(
                    "拖入 UIGF v4.2 JSON 文件，或从本机选取。",
                    "Drop a UIGF v4.2 JSON file here or choose one from your device."
                  )}
                </p>
                <AppModalButton
                  variant="primary"
                  disabled={importBusy()}
                  onClick={() => fileInput?.click()}
                >
                  {t("选择文件", "Choose file")}
                </AppModalButton>
              </section>
            }
          >
            {account => (
              <PullDashboard
                t={t}
                game={props.game}
                catalog={props.game === "hk4e" ? catalogItems() : undefined}
                accounts={accounts()}
                account={account()}
                summary={summary()!}
                pool={currentPool()}
                visiblePulls={visiblePulls()}
                onAccountChange={uid => {
                  setSelectedUid(uid);
                  setVisiblePulls(50);
                }}
                onPoolChange={type => {
                  setPoolType(type);
                  setVisiblePulls(50);
                }}
                onShowMore={() => setVisiblePulls(count => count + 50)}
              />
            )}
          </Show>

          <LinkError />
        </div>
      </AppModal>
      <AppModal
        opened={props.dialog === "account"}
        onClose={props.onClose}
        contentClass="miyoushe-modal miyoushe-check-in-modal"
        bodyClass="miyoushe-modal-body"
        title={<DialogTitle text={t("米游社账号", "Miyoushe account")} />}
        maxWidth={520}
      >
        <div class="miyoushe-panel" style={panelTheme()}>
          <Show
            when={usingMiyoushePrototype}
            fallback={
              <p class="miyoushe-muted" role="status">
                {t(
                  "此版本尚未启用启动器内登录。",
                  "In-launcher sign-in is unavailable in this build."
                )}
              </p>
            }
          >
            <Show
              when={!qrLoading() && !qr()}
              fallback={
                <section class="miyoushe-card miyoushe-login-scan">
                  <Show
                    when={qr()}
                    fallback={
                      <div class="miyoushe-qr-placeholder" aria-hidden="true" />
                    }
                  >
                    {code => (
                      <img
                        class="miyoushe-qr"
                        src={"data:image/png;base64," + code().image}
                        alt={t("米游社登录二维码", "Miyoushe sign-in QR code")}
                      />
                    )}
                  </Show>
                  <p role="status">
                    {qrLoading()
                      ? t("正在获取二维码…", "Requesting a QR code…")
                      : qrFinishing()
                      ? t("正在校验登录状态…", "Verifying the connection…")
                      : qr()?.scanned
                      ? t(
                          "已扫码，请在手机上确认。",
                          "Scanned. Confirm on your phone."
                        )
                      : t(
                          "请用米游社 App 扫码。",
                          "Scan with the Miyoushe app."
                        )}
                  </p>
                  <AppModalButton
                    disabled={qrFinishing()}
                    onClick={() => login?.abort()}
                  >
                    {t("取消", "Cancel")}
                  </AppModalButton>
                </section>
              }
            >
              <section class="miyoushe-card miyoushe-account">
                <Show
                  when={bound()}
                  fallback={
                    <h3>{t("扫码绑定账号", "Connect your account")}</h3>
                  }
                >
                  <div class="miyoushe-user-profile">
                    <img
                      class="miyoushe-user-avatar"
                      src={profile()?.avatar ?? userIcon}
                      referrerpolicy="no-referrer"
                      alt=""
                      onError={event => {
                        if (
                          event.currentTarget.getAttribute("src") !== userIcon
                        )
                          event.currentTarget.src = userIcon;
                      }}
                    />
                    <div>
                      <h3>
                        {profile()?.nickname ||
                          t("已绑定米游社账号", "Account connected")}
                      </h3>
                      <Show when={profile()?.maskedId}>
                        {id => <span class="miyoushe-muted">ID {id()}</span>}
                      </Show>
                      <Show when={profileLoading()}>
                        <small role="status">
                          {t("正在读取账号资料…", "Loading profile…")}
                        </small>
                      </Show>
                    </div>
                  </div>
                  <RolePicker />
                </Show>
                <div class="miyoushe-actions">
                  <AppModalButton
                    variant={bound() ? undefined : "primary"}
                    disabled={working()}
                    onClick={() => void startLogin()}
                  >
                    {notice() === "expired"
                      ? t("刷新二维码", "Refresh QR code")
                      : bound() || bindingStatus() === "expired"
                      ? t("重新扫码", "Reconnect")
                      : t("扫码绑定", "Connect with QR code")}
                  </AppModalButton>
                  <Show when={bound() || bindingStatus() === "expired"}>
                    <AppModalButton
                      disabled={working()}
                      onClick={() => void unbind()}
                    >
                      {t("解绑", "Disconnect")}
                    </AppModalButton>
                  </Show>
                </div>
              </section>
            </Show>
            <Show when={notice()}>
              {state => <p role="status">{messages()[state()]}</p>}
            </Show>
          </Show>
        </div>
      </AppModal>
      <AppModal
        opened={props.dialog === "check-in"}
        onClose={props.onClose}
        contentClass="miyoushe-modal miyoushe-check-in-modal"
        bodyClass="miyoushe-modal-body"
        title={<DialogTitle text={t("每日签到", "Daily check-in")} />}
        maxWidth={520}
      >
        <div class="miyoushe-panel" style={panelTheme()}>
          <Show
            when={usingMiyoushePrototype}
            fallback={
              <p class="miyoushe-muted">
                {t(
                  "前往官方签到页查看本月奖励并完成签到。",
                  "View this month's rewards and check in on the official page."
                )}
              </p>
            }
          >
            <section class="miyoushe-card miyoushe-account">
              <Show
                when={bound()}
                fallback={
                  <>
                    <p class="miyoushe-muted">
                      {bindingStatus() === "expired"
                        ? messages().unbound
                        : t(
                            "绑定账号后可为当前游戏角色签到。",
                            "Connect your account to check in for your character."
                          )}
                    </p>
                    <div class="miyoushe-actions">
                      <AppModalButton onClick={props.onOpenAccount}>
                        {t("账号登录", "Account sign-in")}
                      </AppModalButton>
                    </div>
                  </>
                }
              >
                <RolePicker />
                <div class="miyoushe-actions">
                  <AppModalButton
                    variant="primary"
                    disabled={
                      working() ||
                      rolesLoading() ||
                      requiresManualAction() ||
                      !selectedRole()
                    }
                    onClick={() => void sign()}
                  >
                    {working()
                      ? t("正在确认签到…", "Checking in…")
                      : t("一键签到", "Check in")}
                  </AppModalButton>
                  <Show when={roleError() || notice() === "unbound"}>
                    <AppModalButton
                      disabled={working()}
                      onClick={props.onOpenAccount}
                    >
                      {t("账号设置", "Account settings")}
                    </AppModalButton>
                  </Show>
                </div>
              </Show>
              <Show when={notice()}>
                {state => <p role="status">{messages()[state()]}</p>}
              </Show>
              <Show
                when={
                  diagnostic() &&
                  notice() &&
                  notice() !== "signed" &&
                  notice() !== "already"
                }
              >
                <small class="miyoushe-muted">
                  {diagnostic()?.stage === "status"
                    ? t("查询签到状态", "Check status")
                    : diagnostic()?.stage === "sign"
                    ? t("提交签到", "Submit check-in")
                    : t("复查签到结果", "Verify check-in")}
                  {diagnostic()?.code === undefined
                    ? ""
                    : ` · ${diagnostic()?.code}`}
                </small>
              </Show>
            </section>
          </Show>
          <div class="miyoushe-actions">
            <AppModalButton
              onClick={() => openLink(miyousheCheckInUrl[props.game])}
            >
              {t("打开官方签到页", "Open official check-in")}
            </AppModalButton>
          </div>
          <LinkError />
        </div>
      </AppModal>
    </>
  );
}
