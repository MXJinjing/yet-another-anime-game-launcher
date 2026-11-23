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
} from "./account";
import { miyousheCheckInUrl, type MiyousheGame } from "./games";
import { PullDashboard } from "./pull-dashboard";
import { GameIcon } from "@src/launcher/components/game-icon";
import {
  readGachaArchive,
  runMiyoushePrototype,
  saveGachaArchive,
  usingMiyoushePrototype,
} from "./local";
import {
  exportUigf,
  mergeGachaArchives,
  parseUigf,
  summarizePulls,
  type GachaArchive,
} from "./uigf";
import "./panel.css";

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
  dialog?: "pulls" | "account";
  onClose: () => void;
  onHomeStatusChange?: (status: MiyousheHomeStatus) => void;
  game: MiyousheGame;
  title: string;
  icon?: string;
  chinese: boolean;
}) {
  const t = (zh: string, en: string) => (props.chinese ? zh : en);
  const [archive, setArchive] = createSignal<GachaArchive>({});
  const [archiveLoaded, setArchiveLoaded] = createSignal(false);
  const [storageError, setStorageError] = createSignal(false);
  const [importBusy, setImportBusy] = createSignal(false);
  const [fileNotice, setFileNotice] = createSignal("");
  const [selectedUid, setSelectedUid] = createSignal("");
  const [linkError, setLinkError] = createSignal(false);
  const [poolType, setPoolType] = createSignal("");
  const [visiblePulls, setVisiblePulls] = createSignal(50);
  const [bindingStatus, setBindingStatus] = createSignal<
    MiyousheHomeStatus["checkIn"]
  >(usingMiyoushePrototype ? "loading" : "official");
  const [verifiedDates, setVerifiedDates] = createSignal<
    Partial<Record<MiyousheGame, string>>
  >({});
  const bound = () => bindingStatus() === "bound";
  const [roles, setRoles] = createSignal<GameRole[]>([]);
  const [roleKey, setRoleKey] = createSignal("");
  const selectedRole = createMemo(
    () => roles().find(role => key(role) === roleKey()) ?? roles()[0]
  );
  const [working, setWorking] = createSignal(false);
  const [notice, setNotice] = createSignal<CheckInResult | "cancelled">();
  const [qr, setQr] = createSignal<{ image: string; scanned: boolean }>();
  let login: AbortController | undefined;
  let fileInput: HTMLInputElement | undefined;
  let profileRequest = 0;
  const checkIn = createCheckIn(runMiyoushePrototype);

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

  async function refreshRoles(game?: MiyousheGame) {
    const request = ++profileRequest;
    setRoles([]);
    const binding = await runMiyoushePrototype("bound");
    if (request !== profileRequest) return;
    setBindingStatus(previous => {
      if (binding.state === "ok")
        return previous === "expired" ? "expired" : "bound";
      return binding.state === "unbound" ? "unbound" : "unavailable";
    });
    if (binding.state !== "ok") {
      if (binding.state !== "unbound") setNotice(binding.state);
      return;
    }
    if (!game) return;
    const profile = await runMiyoushePrototype("roles", [game]);
    if (request !== profileRequest) return;
    if (profile.state === "ok") setRoles(profile.roles ?? []);
    else {
      if (profile.state === "unbound") setBindingStatus("expired");
      setNotice(profile.state);
    }
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
        if (!working()) {
          setNotice(undefined);
          if (usingMiyoushePrototype)
            void refreshRoles(dialog === "account" ? game : undefined);
        }
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
      verifiedDate: bound() ? verifiedDates()[props.game] : undefined,
    });
  });
  onCleanup(() => {
    profileRequest++;
    login?.abort();
  });

  async function startLogin() {
    if (working()) return;
    setWorking(true);
    setNotice(undefined);
    profileRequest++;
    const controller = new AbortController();
    login = controller;
    try {
      const state = await bindAccount(
        runMiyoushePrototype,
        (image, scanned) => setQr({ image, scanned }),
        controller.signal
      );
      setNotice(state);
      if (state === "ok") {
        setBindingStatus("bound");
        setVerifiedDates({});
        setRoleKey("");
        await refreshRoles(props.game);
      }
    } finally {
      login = undefined;
      setQr(undefined);
      setWorking(false);
    }
  }

  async function unbind() {
    if (working()) return;
    setWorking(true);
    profileRequest++;
    try {
      const { state } = await runMiyoushePrototype("unbind");
      if (state === "ok") {
        profileRequest++;
        setBindingStatus("unbound");
        setVerifiedDates({});
        setRoles([]);
        setRoleKey("");
        setNotice(undefined);
      } else setNotice(state);
    } finally {
      setWorking(false);
    }
  }

  async function sign() {
    const role = selectedRole();
    if (working()) return;
    const game = props.game;
    setWorking(true);
    setNotice(undefined);
    try {
      const result = await checkIn(game, role);
      setNotice(result);
      if (result === "unbound") setBindingStatus("expired");
      if (result === "signed" || result === "already") {
        const date = new Intl.DateTimeFormat(
          props.chinese ? "zh-CN" : "en-GB",
          {
            timeZone: "Asia/Shanghai",
            day: "numeric",
            month: "numeric",
          }
        ).format(new Date());
        setVerifiedDates(dates => ({ ...dates, [game]: date }));
      }
    } finally {
      setWorking(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file || importBusy()) return;
    setImportBusy(true);
    try {
      const incoming = parseUigf(await file.text());
      const merged = mergeGachaArchives(await readGachaArchive(), incoming);
      await saveGachaArchive(merged);
      setArchive(merged);
      setArchiveLoaded(true);
      setStorageError(false);
      setVisiblePulls(50);
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
    network: t("暂时无法连接米游社。", "Could not reach Miyoushe."),
    limited: t(
      "请求受限，请稍后再试。",
      "Request rate limited. Try again later."
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
        title={<DialogTitle text={t("抽卡分析", "Pull analysis")} />}
        maxWidth={1040}
      >
        <div class="miyoushe-panel">
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
          <div class="miyoushe-page-heading">
            <button
              class="miyoushe-link-button"
              type="button"
              onClick={() =>
                openLink("https://uigf.org/zh/standards/uigf.html")
              }
            >
              {t("UIGF v4.2 格式说明", "UIGF v4.2 format guide")}{" "}
              <span aria-hidden="true">↗</span>
            </button>
            <Show when={active()}>
              <div class="miyoushe-actions">
                <AppModalButton
                  disabled={importBusy()}
                  onClick={() => void exportFile()}
                >
                  {t("导出记录", "Export")}
                </AppModalButton>
                <AppModalButton
                  variant="primary"
                  disabled={importBusy()}
                  onClick={() => fileInput?.click()}
                >
                  {t("导入记录", "Import")}
                </AppModalButton>
              </div>
            </Show>
          </div>
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
        title={<DialogTitle text={t("每日签到", "Daily check-in")} />}
        maxWidth={520}
      >
        <div class="miyoushe-panel">
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
              <div class="miyoushe-section-heading">
                <h3>
                  {bound()
                    ? t("已绑定米游社账号", "Account connected")
                    : t("绑定米游社账号", "Connect a Miyoushe account")}
                </h3>
                <span>{t("本地原型", "Local prototype")}</span>
              </div>
              <div class="miyoushe-actions">
                <Show
                  when={qr()}
                  fallback={
                    <AppModalButton
                      disabled={working()}
                      onClick={() => void startLogin()}
                    >
                      {bound()
                        ? t("重新扫码", "Reconnect")
                        : t("扫码绑定", "Connect with QR code")}
                    </AppModalButton>
                  }
                >
                  {code => (
                    <>
                      <img
                        class="miyoushe-qr"
                        src={"data:image/png;base64," + code().image}
                        alt={t("米游社登录二维码", "Miyoushe sign-in QR code")}
                      />
                      <p role="status">
                        {code().scanned
                          ? t("请在手机上确认。", "Confirm on your phone.")
                          : t(
                              "请用米游社 App 扫码。",
                              "Scan with the Miyoushe app."
                            )}
                      </p>
                      <AppModalButton onClick={() => login?.abort()}>
                        {t("取消", "Cancel")}
                      </AppModalButton>
                    </>
                  )}
                </Show>
                <Show when={bound() && !qr()}>
                  <AppModalButton
                    disabled={working()}
                    onClick={() => void unbind()}
                  >
                    {t("解绑", "Disconnect")}
                  </AppModalButton>
                </Show>
              </div>
              <Show when={bound() && !qr()}>
                <Show
                  when={roles().length}
                  fallback={
                    <p>
                      {t(
                        "当前没有可签到的官服角色。",
                        "No eligible official CN characters are available."
                      )}
                    </p>
                  }
                >
                  <div class="miyoushe-actions">
                    <label>
                      {t("签到角色", "Check-in character")}{" "}
                      <select
                        disabled={working()}
                        value={selectedRole() ? key(selectedRole()!) : ""}
                        onChange={event => {
                          setRoleKey(event.currentTarget.value);
                          setNotice(undefined);
                        }}
                      >
                        <For each={roles()}>
                          {role => (
                            <option value={key(role)}>
                              {role.nickname || role.region} · ••••
                              {role.uid.slice(-4)}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                    <AppModalButton
                      variant="primary"
                      disabled={working()}
                      onClick={() => void sign()}
                    >
                      {t("一键签到", "Check in")}
                    </AppModalButton>
                  </div>
                </Show>
              </Show>
              <Show when={notice()}>
                {state => <p role="status">{messages()[state()]}</p>}
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
