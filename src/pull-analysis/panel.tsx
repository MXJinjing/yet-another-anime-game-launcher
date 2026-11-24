import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
} from "solid-js";
import { AppModal, AppModalButton } from "@src/components/app-modal";
import settingsIcon from "@src/assets/icons/settings.svg";
import { chooseSavePath } from "@platform/macos/save-dialog";
import { open, readFile, writeFile } from "@platform/neutralino";
import { pullPoolTabs, type PullGame } from "./games";
import { PullDashboard, pullPoolLabel } from "./pull-dashboard";
import { PullSettings } from "./pull-settings";
import { pullAnalysisProgress, notifyPullAnalysis } from "./notifications";
import { initialCatalog } from "./hk4e-catalog";
import {
  readGameHistory,
  type HistoryProgress,
  type OnlineHistoryStatus,
} from "./history-local";
import {
  mergeLocalArchive,
  readGachaArchive,
  removeLocalPullAccount,
  removeRadianceMarks,
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

export function PullAnalysisDialog(props: {
  opened: boolean;
  installDir?: string;
  executable?: string;
  winePrefix?: string;
  onClose: () => void;
  onArchiveStatusChange?: (status: PullArchiveStatus) => void;
  game: PullGame;
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
  const [syncProgress, setSyncProgress] = createSignal<
    HistoryProgress | "saving"
  >();
  const catalogItems = new Map(
    initialCatalog.items.map(item => [item.id, item])
  );
  const catalogByName = new Map(
    initialCatalog.items.map(item => [item.name, item.id])
  );
  const [selectedUid, setSelectedUid] = createSignal("");
  const [poolType, setPoolType] = createSignal("");
  const [visiblePulls, setVisiblePulls] = createSignal(50);
  let archiveRead = 0;
  const historyAvailable = () => props.game === "hk4e";
  const accounts = () => archive()[props.game] ?? [];
  const active = createMemo(
    () =>
      accounts().find(account => account.uid === selectedUid()) ?? accounts()[0]
  );
  const activeReport = createMemo(() => {
    const account = active();
    return account && { account, summary: summarizePulls(account, props.game) };
  });
  const poolTabs = createMemo(() =>
    pullPoolTabs(
      props.game,
      activeReport()?.summary.pools.map(pool => pool.type) ?? []
    )
  );
  const currentPool = () =>
    poolType() || activeReport()?.summary.pools[0]?.type || poolTabs()[0];

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
          notifyPullAnalysis(
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
        if (opened) {
          setPoolType("");
          setVisiblePulls(50);
        }
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

  async function mergeIncoming(incoming: GachaArchive) {
    showArchive(await mergeLocalArchive(incoming));
    setVisiblePulls(50);
  }

  function historySyncDetail(status?: OnlineHistoryStatus) {
    switch (status) {
      case "no-link":
      case "expired":
        return t(
          "请在游戏内重新打开祈愿历史以更新临时授权。",
          "Reopen Wish History in the game to renew access."
        );
      case "rate-limited":
        return t(
          "祈愿服务限制了请求频率。",
          "The Wish History service rate-limited the request."
        );
      case "needs-attention":
        return t(
          "请在游戏内处理祈愿服务的验证提示。",
          "Complete the verification in the game."
        );
      case "unavailable":
        return t(
          "暂时无法连接祈愿服务。",
          "The Wish History service is temporarily unavailable."
        );
      case "incomplete":
        return t(
          "祈愿服务的分页读取未完成。",
          "The Wish History sync did not finish."
        );
      default:
        return undefined;
    }
  }

  async function importGame() {
    if (importBusy() || !historyAvailable()) return;
    setImportBusy(true);
    setSyncing(true);
    setSyncProgress(undefined);
    try {
      const reply = await readGameHistory(
        props.installDir,
        props.executable,
        props.winePrefix,
        true,
        setSyncProgress
      );
      const syncDetail = historySyncDetail(reply.onlineStatus);
      if (reply.state !== "ok") {
        const detail =
          syncDetail ??
          (reply.state === "no-history"
            ? t(
                "请先在游戏内打开并翻阅祈愿历史，或导入 UIGF 文件。",
                "Open and browse Wish History in the game, or import a UIGF file."
              )
            : t(
                "无法读取本地游戏缓存。",
                "Could not read the local game cache."
              ));
        notifyPullAnalysis(
          "warning",
          t("未读入祈愿记录", "Wish History was not imported"),
          detail
        );
        return;
      }
      const incoming = parseUigf(
        exportUigf(
          {
            hk4e: reply.accounts.map(account => ({
              uid: account.uid,
              timezone: 8,
              lang: "zh-cn",
              sources: ["game"],
              list: account.list.map(pull => ({
                ...pull,
                item_id:
                  pull.item_id || catalogByName.get(pull.name ?? "") || "",
              })),
            })),
          },
          true
        ),
        true
      );
      setSyncProgress("saving");
      await mergeIncoming(incoming);
      if (props.game === "hk4e") {
        setSelectedUid(uid =>
          reply.accounts.some(account => account.uid === uid)
            ? uid
            : reply.accounts[0]?.uid ?? ""
        );
        setPoolType("");
      }
      notifyPullAnalysis(
        syncDetail ? "warning" : "success",
        reply.source === "online"
          ? syncDetail
            ? t("已合并部分祈愿记录", "Merged available wish records")
            : t("已同步祈愿记录", "Synced wish records")
          : t("已合并游戏缓存", "Merged game cache"),
        syncDetail
      );
    } catch {
      notifyPullAnalysis(
        "warning",
        t(
          "游戏记录无法导入，原有档案已保留。",
          "Game history import failed. Your archive is intact."
        )
      );
    } finally {
      setSyncing(false);
      setSyncProgress(undefined);
      setImportBusy(false);
      if (!archiveLoaded()) loadArchive();
    }
  }

  async function importFile(file?: File) {
    if (importBusy()) return;
    setImportBusy(true);
    const progressNotice = pullAnalysisProgress(
      t("导入抽卡记录", "Import pull history")
    );
    try {
      let contents: string;
      if (file) {
        progressNotice.update(t("正在读取 UIGF 文件…", "Reading UIGF file…"));
        contents = await file.text();
      } else {
        const [path] = await Neutralino.os.showOpenDialog(
          t("导入抽卡记录", "Import pull history")
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
      notifyPullAnalysis(
        "success",
        t("导入完成", "Import complete"),
        t(`已读取并合并 ${count} 条记录。`, `Read and merged ${count} records.`)
      );
    } catch {
      progressNotice.close();
      notifyPullAnalysis(
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
        notifyPullAnalysis("success", t("导出完成", "Export complete"));
      }
    } catch {
      notifyPullAnalysis(
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
        const marksCleared = await removeRadianceMarks(uid).then(
          () => true,
          () => false
        );
        if (!marksCleared) {
          notifyPullAnalysis(
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
      notifyPullAnalysis(
        "success",
        t(
          `已清除 UID ${uid} 的本地抽卡记录`,
          `Cleared local pull records for UID ${uid}`
        )
      );
      return true;
    } catch {
      notifyPullAnalysis(
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
        notifyPullAnalysis(
          "warning",
          t("无法打开系统浏览器", "Could not open the system browser")
        );
    });
  }

  function syncProgressText() {
    const progress = syncProgress();
    if (!progress)
      return t("正在检查游戏授权…", "Checking game authorization…");
    if (progress === "saving") return t("正在合并记录…", "Merging records…");
    if (progress.phase === "cache")
      return t("正在读取游戏缓存…", "Reading the game cache…");
    const pool = pullPoolLabel("hk4e", progress.pool, t);
    return t(
      `${pool} · 已读 ${progress.pages} 页 · 累计 ${progress.records} 条`,
      `${pool} · ${progress.pages} pages read · ${progress.records} records total`
    );
  }

  function HistoryRefresh(buttonProps: { primary?: boolean }) {
    return (
      <Show when={historyAvailable()}>
        <button
          class="app-modal-button pull-analysis-refresh-button"
          classList={{
            "app-modal-button--primary": buttonProps.primary,
            "app-modal-button--secondary": !buttonProps.primary,
          }}
          type="button"
          aria-busy={syncing()}
          disabled={importBusy()}
          onClick={() => void importGame()}
        >
          <svg
            class="pull-analysis-refresh-icon"
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
          {syncing()
            ? t("读取中…", "Reading…")
            : t("从游戏读取", "Read from game")}
        </button>
        <Show when={syncing()}>
          <span class="pull-analysis-sync-progress" role="status">
            {syncProgressText()}
          </span>
        </Show>
      </Show>
    );
  }

  function SettingsButton(buttonProps: { iconOnly?: boolean }) {
    return (
      <button
        class="app-modal-button app-modal-button--secondary pull-analysis-settings-button"
        classList={{ "pull-analysis-empty-settings": buttonProps.iconOnly }}
        type="button"
        aria-label={t("抽卡设置", "Pull settings")}
        title={
          buttonProps.iconOnly ? t("抽卡设置", "Pull settings") : undefined
        }
        aria-haspopup="dialog"
        onClick={() => setPullSettings(true)}
      >
        <img src={settingsIcon} alt="" width="14" height="14" />
        <Show when={!buttonProps.iconOnly}>{t("设置", "Settings")}</Show>
      </button>
    );
  }

  return (
    <>
      <AppModal
        opened={props.opened}
        onClose={() => {
          if (!pullSettings()) props.onClose();
        }}
        contentClass="pull-analysis-modal pull-analysis-pull-modal window-no-drag"
        bodyClass="pull-analysis-modal-body"
        title={
          <strong class="pull-analysis-pull-title">
            {t("抽卡分析", "Pull analysis")}
          </strong>
        }
        maxWidth={1040}
      >
        <div class="pull-analysis-panel" style={panelTheme()}>
          <Show
            when={activeReport()}
            fallback={
              <section
                class="pull-analysis-empty"
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  const file = event.dataTransfer?.files[0];
                  if (file) void importFile(file);
                }}
              >
                <span class="pull-analysis-empty-icon" aria-hidden="true">
                  ✦
                </span>
                <h3>{t("暂无抽卡记录", "No pull records yet")}</h3>
                <p>
                  {t(
                    "也可以将 UIGF v4.2 文件拖到这里。",
                    "You can also drop a UIGF v4.2 file here."
                  )}
                </p>
                <div class="pull-analysis-empty-actions">
                  <HistoryRefresh primary />
                  <AppModalButton
                    variant={historyAvailable() ? "secondary" : "primary"}
                    disabled={importBusy()}
                    onClick={() => void importFile()}
                  >
                    <span class="pull-analysis-file-icon" aria-hidden="true" />
                    {t("导入 UIGF", "Import UIGF")}
                  </AppModalButton>
                </div>
                <SettingsButton iconOnly />
              </section>
            }
          >
            {report => (
              <PullDashboard
                t={t}
                game={props.game}
                catalog={props.game === "hk4e" ? catalogItems : undefined}
                accounts={accounts()}
                account={report().account}
                historyControls={
                  <>
                    <HistoryRefresh />
                    <SettingsButton />
                  </>
                }
                summary={report().summary}
                poolType={currentPool()}
                poolTabs={poolTabs()}
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
        overlayClass="app-modal-overlay--nested pull-analysis-settings-overlay"
        contentClass="app-modal-content--nested pull-analysis-modal pull-analysis-pull-settings-modal window-no-drag"
        bodyClass="pull-analysis-modal-body"
        title={
          <strong class="pull-analysis-pull-title">
            {t("抽卡设置", "Pull settings")}
          </strong>
        }
        maxWidth={560}
      >
        <div class="pull-analysis-panel" style={panelTheme()}>
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
    </>
  );
}
