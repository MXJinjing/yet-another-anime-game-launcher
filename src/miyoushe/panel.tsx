import { useClickOutside } from "@hope-ui/solid";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  Show,
} from "solid-js";
import { AppModal, AppModalButton } from "@src/components/app-modal";
import settingsIcon from "@src/assets/icons/settings.svg";
import { chooseSavePath } from "@platform/macos/save-dialog";
import { open, readFile, writeFile } from "@platform/neutralino";
import { MiyousheRolePicker } from "./account-entry";
import type { MiyousheSession } from "./session";
import type { MiyousheGame } from "./games";
import { PullDashboard } from "./pull-dashboard";
import { PullSettings } from "./pull-settings";
import { miyousheProgress, notifyMiyoushe } from "./notifications";
import { initialCatalog } from "./genshin-catalog";
import {
  readGenshinCatalog,
  refreshGenshinCatalog,
} from "./genshin-catalog-local";
import { warmGenshinPortraits } from "./genshin-portrait-cache";
import { readAccountWishHistory, readGameHistory } from "./history-local";
import {
  mergeLocalArchive,
  readGachaArchive,
  removeLocalPullAccount,
  removeRadianceMarks,
  usingMiyoushePrototype,
} from "./local";
import {
  exportUigf,
  parseUigf,
  selectGamePullArchive,
  summarizePulls,
  type GachaArchive,
} from "./uigf";
import "./panel.css";

export type PullArchiveStatus = number | "loading" | "unavailable";

export function MiyoushePanel(props: {
  opened: boolean;
  installDir?: string;
  winePrefix?: string;
  session: MiyousheSession;
  loginOpen: boolean;
  onLogin: (onSuccess: () => void) => void;
  onClose: () => void;
  onArchiveStatusChange?: (status: PullArchiveStatus) => void;
  game: MiyousheGame;
  preloadGenshin: boolean;
  title: string;
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
  const [pullSettings, setPullSettings] = createSignal(false);
  const [importBusy, setImportBusy] = createSignal(false);
  const [syncing, setSyncing] = createSignal(false);
  const [accountSyncRequested, setAccountSyncRequested] = createSignal(false);
  const [syncRoleOpen, setSyncRoleOpen] = createSignal(false);
  const [reauthorizeRevision, setReauthorizeRevision] = createSignal<number>();
  const [catalog, setCatalog] = createSignal(initialCatalog);
  const catalogItems = createMemo(
    () => new Map(catalog().items.map(item => [item.id, item]))
  );
  const historyHeads = new Map<string, Record<string, string>>();
  const [selectedUid, setSelectedUid] = createSignal("");
  const [poolType, setPoolType] = createSignal("");
  const [visiblePulls, setVisiblePulls] = createSignal(50);
  let archiveRead = 0;
  const session = props.session;
  const bindingStatus = session.status;
  const selectedRole = session.selectedRole;
  const rolesLoading = session.rolesLoading;
  const bound = () => bindingStatus() === "bound";
  const historyAvailable = () =>
    usingMiyoushePrototype && props.game === "hk4e";
  const accounts = () => archive()[props.game] ?? [];
  const active = createMemo(
    () =>
      accounts().find(account => account.uid === selectedUid()) ?? accounts()[0]
  );
  const summary = createMemo(() => {
    const account = active();
    return account ? summarizePulls(account, props.game) : undefined;
  });
  const currentPool = createMemo(() => {
    const pools = summary()?.pools ?? [];
    return pools.find(pool => pool.type === poolType()) ?? pools[0];
  });

  function showArchive(records: GachaArchive) {
    archiveRead++;
    batch(() => {
      setArchive(records);
      setArchiveLoaded(true);
      setStorageError(false);
    });
  }

  function loadArchive() {
    const read = ++archiveRead;
    void readGachaArchive().then(
      value => {
        if (read !== archiveRead || importBusy()) return;
        showArchive(value);
      },
      () => {
        if (read !== archiveRead || importBusy()) return;
        setArchiveLoaded(true);
        setStorageError(true);
        if (props.opened)
          notifyMiyoushe(
            "danger",
            t("无法读取本地抽卡档案", "Could not read the local pull archive")
          );
      }
    );
  }

  createEffect(
    on(
      () => props.opened,
      opened => {
        if (!importBusy() && (opened || !archiveLoaded())) loadArchive();
      }
    )
  );

  createEffect(
    on(
      () => [props.opened, props.game] as const,
      ([opened]) => {
        setPullSettings(false);
        setAccountSyncRequested(false);
        setSyncRoleOpen(false);
        if (opened) {
          setPoolType("");
          setVisiblePulls(50);
        }
        if (opened) session.refreshRoles();
      }
    )
  );
  createEffect(() => {
    props.onArchiveStatusChange?.(
      storageError()
        ? "unavailable"
        : archiveLoaded()
        ? accounts().reduce((total, account) => total + account.list.length, 0)
        : "loading"
    );
  });

  createEffect(
    on(
      () => props.preloadGenshin,
      enabled => {
        if (!enabled) return;
        void readGenshinCatalog().then(async current => {
          setCatalog(current);
          void warmGenshinPortraits(current.items);
          const updated = await refreshGenshinCatalog(current);
          setCatalog(updated);
          if (updated.commit !== current.commit)
            void warmGenshinPortraits(updated.items);
        });
      }
    )
  );

  async function mergeIncoming(incoming: GachaArchive) {
    showArchive(await mergeLocalArchive(incoming));
    setVisiblePulls(50);
  }

  function requestAccountSync() {
    const next = () => {
      if (!props.opened || props.game !== "hk4e") return;
      if (session.roleError()) session.refreshRoles();
      setAccountSyncRequested(true);
    };
    if (!bound() || reauthorizeRevision() === session.revision()) {
      props.onLogin(next);
    } else {
      next();
    }
  }

  function syncSelectedRole() {
    const role = selectedRole();
    const account = session.active();
    if (!role || role.region !== "cn_gf01" || !account) return;
    setSyncRoleOpen(false);
    void importGame({ id: account.id, uid: role.uid });
  }

  createEffect(() => {
    if (!accountSyncRequested() || rolesLoading() || session.busy()) return;
    setAccountSyncRequested(false);
    if (!bound() || session.roleError()) {
      notifyMiyoushe(
        "warning",
        t("暂时无法读取官服角色", "Could not load official CN characters")
      );
    } else if (!session.roles().some(role => role.region === "cn_gf01")) {
      notifyMiyoushe(
        "warning",
        t(
          "当前账号没有可用的官服角色",
          "This account has no eligible CN characters"
        )
      );
    } else if (selectedRole()?.region === "cn_gf01") {
      syncSelectedRole();
    } else {
      setSyncRoleOpen(true);
    }
  });

  async function importGame(account?: { id: string; uid: string }) {
    if (importBusy()) return;
    const revision = session.revision();
    const current = () => !account || revision === session.revision();
    const noticeTitle = t("祈愿记录未同步", "Wish History was not synced");
    const notifyFailure = (text: string) => {
      if (current()) notifyMiyoushe("warning", noticeTitle, text);
    };
    setImportBusy(true);
    setSyncing(true);
    try {
      const reply = account
        ? await readAccountWishHistory(
            session.request,
            account.id,
            account.uid,
            historyHeads.get(account.uid)
          )
        : await readGameHistory(
            props.installDir,
            props.winePrefix,
            Object.fromEntries(historyHeads)
          );
      if (!current()) return;
      if (reply.state !== "ok") {
        const openHistory = t(
          "请在游戏内打开祈愿历史后重试，或导入 UIGF 文件。",
          "Open Wish History in the game and try again, or import a UIGF file."
        );
        if (
          account &&
          (reply.state === "account-authorization-expired" ||
            reply.state === "history-expired")
        )
          setReauthorizeRevision(revision);
        const errors = {
          "no-history": account
            ? t(
                "当前角色没有可同步的记录。",
                "This character has no history to sync."
              )
            : openHistory,
          "history-expired": account
            ? t(
                "祈愿授权已过期，请重新扫码。",
                "Wish History authorization expired. Sign in again."
              )
            : openHistory,
          "account-authorization-expired": t(
            "米游社祈愿授权已过期，请重新扫码。",
            "Miyoushe Wish History authorization expired. Sign in again."
          ),
          "history-mismatch": t(
            "祈愿记录的 UID 不一致。请核对角色，或在游戏内重新打开祈愿历史。",
            "The Wish History UIDs do not match. Check the character or reopen Wish History in the game."
          ),
          manual: t(
            "需要人工验证。请在游戏内处理后再试。",
            "Verification required. Complete it in the game before retrying."
          ),
          limited: t(
            "读取请求受限，请稍后再试。",
            "Rate limited. Try again later."
          ),
          invalid: t(
            "祈愿服务返回了无法识别的数据。",
            "Unrecognized data from Wish History."
          ),
          network: t(
            "暂时无法连接祈愿服务。可稍后重试或导入 UIGF 文件。",
            "Could not reach the Wish History service. Try again later or import a UIGF file."
          ),
          unavailable: t(
            "暂时无法读取游戏记录。",
            "Could not read game history."
          ),
        };
        notifyFailure(errors[reply.state]);
        return;
      }
      const { uid: historyUid, list } = reply.history;
      if (account && account.uid !== historyUid)
        throw new Error("Unexpected history UID");
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
      await mergeIncoming(incoming);
      if (!current()) return;
      if (props.game === "hk4e") {
        setSelectedUid(historyUid);
        setPoolType("");
      }
      if (reply.source === "remote") {
        // For each pool, resume at a previously merged remote record for this UID.
        const heads: Record<string, string> = {};
        for (const pull of list) {
          const pool = pull.uigf_gacha_type ?? pull.gacha_type;
          heads[pool] ??= pull.id;
        }
        historyHeads.set(historyUid, {
          ...historyHeads.get(historyUid),
          ...heads,
        });
      }
      notifyMiyoushe(
        "success",
        reply.source === "cache"
          ? t("已读取游戏缓存", "Read game cache")
          : t("同步完成", "Sync complete")
      );
    } catch {
      notifyFailure(
        t(
          "游戏记录无法导入，原有档案已保留。",
          "Game history import failed. Your archive is intact."
        )
      );
    } finally {
      setSyncing(false);
      setImportBusy(false);
      if (!archiveLoaded() && !importBusy()) loadArchive();
    }
  }

  async function importFile(file?: File) {
    if (importBusy()) return;
    setImportBusy(true);
    const progressNotice = miyousheProgress(
      t("导入抽卡记录", "Import pull history")
    );
    try {
      let contents: string;
      if (file) {
        progressNotice.update(t("正在读取 UIGF 文件…", "Reading UIGF file…"));
        contents = await file.text();
      } else {
        const [path] = await Neutralino.os.showOpenDialog(
          t("导入抽卡记录", "Import pull history"),
          { filters: [{ name: "UIGF JSON", extensions: ["json"] }] }
        );
        if (!path) return;
        progressNotice.update(t("正在读取 UIGF 文件…", "Reading UIGF file…"));
        contents = await readFile(path);
      }
      progressNotice.update(
        t("正在校验 UIGF 记录…", "Validating UIGF records…")
      );
      const incoming = parseUigf(contents);
      let count = 0;
      for (const accounts of Object.values(incoming))
        for (const account of accounts) {
          account.sources = ["file"];
          count += account.list.length;
        }
      progressNotice.update(
        t(
          `正在合并并保存 ${count} 条记录…`,
          `Merging and saving ${count} records…`
        )
      );
      await mergeIncoming(incoming);
      progressNotice.close();
      notifyMiyoushe(
        "success",
        t("导入完成", "Import complete"),
        t(`已读取并合并 ${count} 条记录。`, `Read and merged ${count} records.`)
      );
    } catch {
      progressNotice.close();
      notifyMiyoushe(
        "danger",
        t("导入失败", "Import failed"),
        t(
          "请检查文件格式和本地存储权限。",
          "Check the file format and local storage access."
        )
      );
    } finally {
      progressNotice.close();
      setImportBusy(false);
    }
  }

  async function exportFile(uid?: string) {
    const game = props.game;
    const snapshot = selectGamePullArchive(archive(), game, uid);
    if (importBusy() || !snapshot) return;
    setImportBusy(true);
    try {
      const path = await chooseSavePath(
        t("导出抽卡记录", "Export pull history"),
        [game, uid, "uigf-v4.2.json"].filter(Boolean).join("-")
      );
      if (path) {
        await writeFile(path, exportUigf(snapshot));
        notifyMiyoushe("success", t("导出完成", "Export complete"));
      }
    } catch {
      notifyMiyoushe(
        "danger",
        t("无法导出抽卡记录", "Could not export pull history")
      );
    } finally {
      setImportBusy(false);
    }
  }

  async function clearPulls(uid: string) {
    if (
      importBusy() ||
      storageError() ||
      !accounts().some(account => account.uid === uid)
    )
      return false;
    const game = props.game;
    const removingActive = active()?.uid === uid;
    setImportBusy(true);
    try {
      const updated = await removeLocalPullAccount(game, uid);
      batch(() => {
        showArchive(updated);
        if (props.game === game && removingActive) {
          setSelectedUid("");
          setPoolType("");
          setVisiblePulls(50);
        }
      });
      if (game === "hk4e") {
        historyHeads.delete(uid);
        const marksCleared = await removeRadianceMarks(uid).then(
          () => true,
          () => false
        );
        if (!marksCleared) {
          notifyMiyoushe(
            "warning",
            t(
              "部分明光标记清理失败",
              "Some Radiance marks could not be removed"
            ),
            t(
              `已清除 UID ${uid} 的抽卡记录。`,
              `Cleared pull records for UID ${uid}.`
            )
          );
          return true;
        }
      }
      notifyMiyoushe(
        "success",
        t(
          `已清除 UID ${uid} 的本地抽卡记录`,
          `Cleared local pull records for UID ${uid}`
        )
      );
      return true;
    } catch {
      notifyMiyoushe(
        "danger",
        t("无法清除记录", "Could not clear records"),
        t("请检查本地存储权限。", "Check local storage access.")
      );
      return false;
    } finally {
      setImportBusy(false);
    }
  }

  function openLink(url: string) {
    const dialog = props.opened;
    void open(url).catch(() => {
      if (props.opened === dialog)
        notifyMiyoushe(
          "warning",
          t("无法打开系统浏览器", "Could not open the system browser")
        );
    });
  }

  function HistoryRefresh() {
    const [opened, setOpened] = createSignal(false);
    const menuId = createUniqueId();
    let menu: HTMLDivElement | undefined;
    let trigger: HTMLButtonElement | undefined;
    const busy = () => importBusy() || accountSyncRequested();
    useClickOutside({
      element: () => menu,
      handler: () => setOpened(false),
    });

    function choose(action: () => void) {
      setOpened(false);
      trigger?.focus();
      action();
    }

    return (
      <Show when={historyAvailable()}>
        <div
          class="miyoushe-refresh-control"
          ref={menu}
          onFocusOut={event => {
            if (
              event.relatedTarget instanceof Node &&
              !event.currentTarget.contains(event.relatedTarget)
            )
              setOpened(false);
          }}
          onKeyDown={event => {
            if (event.key !== "Escape" || !opened()) return;
            event.preventDefault();
            event.stopPropagation();
            setOpened(false);
            trigger?.focus();
          }}
        >
          <button
            ref={trigger}
            class="app-modal-button app-modal-button--secondary miyoushe-refresh-button"
            type="button"
            aria-busy={syncing()}
            aria-expanded={opened()}
            aria-controls={opened() ? menuId : undefined}
            disabled={busy()}
            onClick={() => setOpened(value => !value)}
          >
            <svg
              class="miyoushe-refresh-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 5v5h-5M4 19v-5h5" />
              <path d="M4.9 9a8 8 0 0 1 13-3l2.1 4M4 14l2.1 4a8 8 0 0 0 13-3" />
            </svg>
            {syncing() ? t("刷新中…", "Refreshing…") : t("刷新", "Refresh")}
            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="m4 6 4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </button>
          <Show when={opened()}>
            <div
              id={menuId}
              class="miyoushe-refresh-menu"
              role="group"
              aria-label={t("刷新方式", "Refresh options")}
            >
              <button
                type="button"
                disabled={busy()}
                onClick={() => choose(() => void importGame())}
              >
                {t("从游戏读取", "Read from game")}
              </button>
              <button
                type="button"
                disabled={
                  busy() || session.busy() || bindingStatus() === "loading"
                }
                onClick={() => choose(requestAccountSync)}
              >
                {bound() && reauthorizeRevision() !== session.revision()
                  ? t("米游社账号同步", "Sync with Miyoushe")
                  : t("登录米游社同步", "Sign in to sync")}
              </button>
            </div>
          </Show>
        </div>
      </Show>
    );
  }

  function HistoryControls() {
    return (
      <>
        <HistoryRefresh />
        <button
          class="app-modal-button app-modal-button--secondary miyoushe-settings-button"
          type="button"
          aria-label={t("抽卡设置", "Pull settings")}
          aria-haspopup="dialog"
          onClick={() => {
            setPullSettings(true);
          }}
        >
          <img src={settingsIcon} alt="" width="14" height="14" />
          {t("设置", "Settings")}
        </button>
      </>
    );
  }

  return (
    <>
      <AppModal
        opened={props.opened}
        onClose={() => {
          if (!pullSettings() && !props.loginOpen && !syncRoleOpen())
            props.onClose();
        }}
        contentClass="miyoushe-modal miyoushe-pull-modal window-no-drag"
        bodyClass="miyoushe-modal-body"
        title={
          <strong class="miyoushe-pull-title">
            {t("抽卡分析", "Pull analysis")}
          </strong>
        }
        maxWidth={1040}
      >
        <div class="miyoushe-panel" style={panelTheme()}>
          <Show
            when={active()}
            fallback={
              <section
                class="miyoushe-empty"
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  const file = event.dataTransfer?.files[0];
                  if (file) void importFile(file);
                }}
              >
                <span class="miyoushe-empty-icon" aria-hidden="true">
                  ✦
                </span>
                <h3>{t("导入你的抽卡记录", "Import your pull history")}</h3>
                <p>
                  {t(
                    "拖入 UIGF v4.2 JSON 文件，或从抽卡设置导入。",
                    "Drop a UIGF v4.2 JSON file here or open Pull settings to import."
                  )}
                </p>
                <div class="miyoushe-actions">
                  <HistoryControls />
                </div>
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
                historyControls={<HistoryControls />}
                summary={summary()!}
                pool={currentPool()}
                visiblePulls={visiblePulls()}
                onAccountChange={uid => {
                  setSelectedUid(uid);
                  setPoolType("");
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
        </div>
      </AppModal>
      <AppModal
        opened={props.opened && pullSettings()}
        onClose={() => setPullSettings(false)}
        overlayClass="app-modal-overlay--nested miyoushe-settings-overlay"
        contentClass="app-modal-content--nested miyoushe-modal miyoushe-pull-settings-modal window-no-drag"
        bodyClass="miyoushe-modal-body"
        title={
          <strong class="miyoushe-pull-title">
            {t("抽卡设置", "Pull settings")}
          </strong>
        }
        maxWidth={560}
      >
        <div class="miyoushe-panel" style={panelTheme()}>
          <PullSettings
            t={t}
            gameTitle={props.title}
            accounts={accounts()}
            busy={importBusy()}
            loaded={archiveLoaded()}
            storageError={storageError()}
            onGuide={() => openLink("https://uigf.org/zh/standards/uigf.html")}
            onImport={() => void importFile()}
            onExport={uid => void exportFile(uid)}
            onClear={clearPulls}
          />
        </div>
      </AppModal>
      <AppModal
        opened={props.opened && syncRoleOpen()}
        onClose={() => setSyncRoleOpen(false)}
        overlayClass="app-modal-overlay--nested"
        contentClass="app-modal-content--nested miyoushe-modal window-no-drag"
        title={
          <strong>{t("选择同步角色", "Choose a character to sync")}</strong>
        }
        footer={
          <AppModalButton
            variant="primary"
            disabled={selectedRole()?.region !== "cn_gf01" || importBusy()}
            onClick={syncSelectedRole}
          >
            {t("同步记录", "Sync history")}
          </AppModalButton>
        }
      >
        <MiyousheRolePicker t={t} game="hk4e" session={session} />
      </AppModal>
    </>
  );
}
