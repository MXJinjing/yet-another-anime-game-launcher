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
import { miyousheLinks, type MiyousheGame } from "./games";
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

export function MiyoushePanel(props: {
  opened: boolean;
  onClose: () => void;
  game: MiyousheGame;
  title: string;
  chinese: boolean;
}) {
  const t = (zh: string, en: string) => (props.chinese ? zh : en);
  const [archive, setArchive] = createSignal<GachaArchive>({});
  const [storageError, setStorageError] = createSignal(false);
  const [importBusy, setImportBusy] = createSignal(false);
  const [fileNotice, setFileNotice] = createSignal("");
  const [selectedUid, setSelectedUid] = createSignal("");
  const [linkError, setLinkError] = createSignal(false);
  const [poolType, setPoolType] = createSignal("");
  const [visiblePulls, setVisiblePulls] = createSignal(50);
  const [bound, setBound] = createSignal(false);
  const [roles, setRoles] = createSignal<GameRole[]>([]);
  const [roleKey, setRoleKey] = createSignal("");
  const selectedRole = createMemo(
    () => roles().find(role => key(role) === roleKey()) ?? roles()[0]
  );
  const [working, setWorking] = createSignal(false);
  const [notice, setNotice] = createSignal<CheckInResult | "cancelled">();
  const [qr, setQr] = createSignal<{ image: string; scanned: boolean }>();
  let login: AbortController | undefined;
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

  async function refreshRoles(game: MiyousheGame) {
    const request = ++profileRequest;
    setRoles([]);
    const binding = await runMiyoushePrototype("bound");
    if (request !== profileRequest) return;
    setBound(binding.state === "ok");
    if (binding.state !== "ok") {
      if (binding.state !== "unbound") setNotice(binding.state);
      return;
    }
    const profile = await runMiyoushePrototype("roles", [game]);
    if (request !== profileRequest) return;
    if (profile.state === "ok") setRoles(profile.roles ?? []);
    else setNotice(profile.state);
  }

  createEffect(
    on(
      () => props.opened,
      opened => {
        if (!opened) {
          login?.abort();
          return;
        }
        if (!importBusy()) {
          void readGachaArchive().then(
            value => {
              if (importBusy()) return;
              setArchive(value);
              setStorageError(false);
            },
            () => setStorageError(true)
          );
        }
      }
    )
  );

  createEffect(
    on(
      () => [props.opened, props.game] as const,
      ([opened, game]) => {
        profileRequest++;
        if (!opened) return;
        setPoolType("");
        setVisiblePulls(50);
        setLinkError(false);
        if (!working()) setNotice(undefined);
        if (usingMiyoushePrototype) void refreshRoles(game);
      }
    )
  );
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
        setBound(false);
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
    setWorking(true);
    setNotice(undefined);
    try {
      setNotice(await checkIn(props.game, role));
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
          filters: [{ name: "JSON", extensions: ["json"] }],
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
    setLinkError(false);
    void open(url).catch(() => setLinkError(true));
  }

  return (
    <AppModal
      opened={props.opened}
      onClose={props.onClose}
      title={t("米游社", "Miyoushe") + " · " + props.title}
      maxWidth={760}
    >
      <div class="miyoushe-panel">
        <nav
          aria-label={t("官方链接", "Official links")}
          class="miyoushe-actions"
        >
          <AppModalButton
            onClick={() => openLink(miyousheLinks[props.game].community)}
          >
            {t("社区", "Community")}
          </AppModalButton>
          <AppModalButton
            onClick={() => openLink(miyousheLinks[props.game].guides)}
          >
            {t("攻略", "Guides")}
          </AppModalButton>
          <AppModalButton
            onClick={() => openLink(miyousheLinks[props.game].checkIn)}
          >
            {t("打开官方签到页", "Open official check-in")}
          </AppModalButton>
        </nav>
        <Show when={linkError()}>
          <p role="status">
            {t("无法打开系统浏览器。", "Could not open the system browser.")}
          </p>
        </Show>
        <Show when={usingMiyoushePrototype}>
          <section class="miyoushe-section">
            <h3>
              {t(
                "账号与每日签到 · 本地原型",
                "Account and daily check-in · Local prototype"
              )}
            </h3>
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
            <p role="status">{notice() ? messages()[notice()!] : ""}</p>
          </section>
        </Show>
        <section class="miyoushe-section">
          <h3>{t("抽卡分析", "Pull history")}</h3>
          <div class="miyoushe-actions">
            <label class="miyoushe-import">
              {t("导入 UIGF v4.2", "Import UIGF v4.2")}{" "}
              <input
                type="file"
                accept=".json,application/json"
                disabled={importBusy()}
                onChange={event => {
                  void importFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <AppModalButton
              disabled={importBusy() || !accounts().length}
              onClick={() => void exportFile()}
            >
              {t("导出当前游戏", "Export current game")}
            </AppModalButton>
            <AppModalButton
              onClick={() =>
                openLink("https://uigf.org/zh/standards/uigf.html")
              }
            >
              {t("格式说明", "Format guide")}
            </AppModalButton>
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
            <p role="status">{fileNotice()}</p>
          </Show>
          <Show
            when={active()}
            fallback={
              <p>
                {t(
                  "导入此游戏的抽卡记录后，即可查看统计。",
                  "Import this game's pull history to see statistics."
                )}
              </p>
            }
          >
            {account => (
              <>
                <label>
                  UID{" "}
                  <select
                    value={account().uid}
                    onChange={event => {
                      setSelectedUid(event.currentTarget.value);
                      setVisiblePulls(50);
                    }}
                  >
                    <For each={accounts()}>
                      {item => <option value={item.uid}>{item.uid}</option>}
                    </For>
                  </select>
                </label>
                <p>
                  {t("已导入", "Imported")} {account().list.length}{" "}
                  {t("抽", "pulls")}
                  {summary()?.first
                    ? " · " + summary()?.first + " — " + summary()?.last
                    : ""}
                </p>
                <p class="miyoushe-note">
                  {t(
                    "统计仅覆盖已导入记录。出货间隔仅计算同卡池内两次已知五星之间的记录。",
                    "Stats cover the imported history. Intervals use records between two known top-rank pulls in the same pool."
                  )}
                </p>
                <Show when={currentPool()}>
                  {pool => (
                    <>
                      <label>
                        {t("卡池", "Pool")}{" "}
                        <select
                          value={pool().type}
                          onChange={event => {
                            setPoolType(event.currentTarget.value);
                            setVisiblePulls(50);
                          }}
                        >
                          <For each={summary()?.pools}>
                            {entry => (
                              <option value={entry.type}>
                                {entry.type} · {entry.pulls.length}
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                      <p>
                        {t("出货间隔", "Top-rank intervals")}:{" "}
                        {pool().intervals.slice(-20).join(" / ") || "—"}
                      </p>
                      <ul class="miyoushe-pulls">
                        <For
                          each={pool().pulls.slice(-visiblePulls()).reverse()}
                        >
                          {pull => (
                            <li>
                              <span>{pull.name || pull.item_id}</span>
                              <span>{pull.rank_type ?? "—"}★</span>
                              <time>{pull.time}</time>
                            </li>
                          )}
                        </For>
                      </ul>
                      <Show when={pool().pulls.length > visiblePulls()}>
                        <AppModalButton
                          onClick={() => setVisiblePulls(count => count + 50)}
                        >
                          {t("加载更早的记录", "Show older pulls")}
                        </AppModalButton>
                      </Show>
                    </>
                  )}
                </Show>
              </>
            )}
          </Show>
        </section>
      </div>
    </AppModal>
  );
}
