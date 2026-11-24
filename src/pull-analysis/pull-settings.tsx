import { Button, colorModeClassNames } from "@hope-ui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import fileIcon from "@src/assets/icons/file.svg";
import type { GachaArchive } from "./uigf";
import type { PullGame } from "./games";

type Account = NonNullable<GachaArchive[PullGame]>[number];
const accountsPerPage = 5;

export function PullSettings(props: {
  t: (zh: string, en: string) => string;
  gameTitle: string;
  accounts: Account[];
  busy: boolean;
  loaded: boolean;
  storageError: boolean;
  onGuide: () => void;
  onImport: () => void;
  onExport: (uid?: string) => void;
  onClear: (uid: string) => Promise<boolean>;
}) {
  const t = props.t;
  const [confirmUid, setConfirmUid] = createSignal<string>();
  const [page, setPage] = createSignal(1);
  const pageCount = () =>
    Math.max(1, Math.ceil(props.accounts.length / accountsPerPage));
  const currentPage = () => Math.min(page(), pageCount());
  const visibleAccounts = createMemo(() =>
    props.accounts.slice(
      (currentPage() - 1) * accountsPerPage,
      currentPage() * accountsPerPage
    )
  );
  const unavailable = () => props.busy || !props.loaded || props.storageError;
  const countText = (count: number) => t(`${count} 条记录`, `${count} records`);

  createEffect(() => {
    if (page() > pageCount()) setPage(pageCount());
  });

  function changePage(next: number) {
    setConfirmUid(undefined);
    setPage(next);
  }

  return (
    <div class={`pull-analysis-pull-settings ${colorModeClassNames.dark}`}>
      <section
        class="pull-analysis-card pull-analysis-file-settings"
        aria-labelledby="pull-analysis-uigf-settings"
      >
        <img src={fileIcon} alt="" width="20" height="20" />
        <div class="pull-analysis-settings-details">
          <h2 id="pull-analysis-uigf-settings">
            {t("UIGF 文件", "UIGF files")}
          </h2>
          <button
            class="pull-analysis-link-button"
            type="button"
            onClick={props.onGuide}
          >
            {t("v4.2 格式说明", "v4.2 format guide")}{" "}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
        <Button
          class="pull-analysis-import-button"
          type="button"
          size="xs"
          variant="solid"
          colorScheme="primary"
          disabled={unavailable() || !!confirmUid()}
          onClick={props.onImport}
        >
          {t("导入文件", "Import file")}
        </Button>
      </section>

      <section
        class="pull-analysis-card pull-analysis-archive-settings"
        aria-labelledby="pull-analysis-local-pull-settings"
      >
        <div class="pull-analysis-settings-heading">
          <div class="pull-analysis-settings-details">
            <h2 id="pull-analysis-local-pull-settings">
              {t("本地抽卡档案", "Local pull archive")}
            </h2>
            <span class="pull-analysis-muted">{props.gameTitle}</span>
          </div>
          <Show when={props.accounts.length > 1}>
            <Button
              type="button"
              size="xs"
              variant="subtle"
              colorScheme="neutral"
              disabled={unavailable()}
              onClick={() => props.onExport()}
            >
              {t("导出全部", "Export all")}
            </Button>
          </Show>
        </div>
        <Show
          when={props.accounts.length}
          fallback={
            <Show when={!props.storageError}>
              <p class="pull-analysis-muted">
                {props.loaded
                  ? t(
                      "当前游戏没有本地抽卡记录。",
                      "This game has no local pull records."
                    )
                  : t("正在读取本地档案…", "Reading the local archive…")}
              </p>
            </Show>
          }
        >
          <ul class="pull-analysis-uid-list">
            <For each={visibleAccounts()}>
              {account => {
                const confirming = () => confirmUid() === account.uid;
                return (
                  <li>
                    <div class="pull-analysis-uid-row">
                      <div class="pull-analysis-settings-details">
                        <strong>UID {account.uid}</strong>
                        <span class="pull-analysis-muted">
                          {countText(account.list.length)}
                        </span>
                      </div>
                      <div class="pull-analysis-uid-actions">
                        <Button
                          type="button"
                          size="xs"
                          variant="subtle"
                          colorScheme="neutral"
                          aria-label={t(
                            `导出 UID ${account.uid}`,
                            `Export UID ${account.uid}`
                          )}
                          disabled={unavailable()}
                          onClick={() => props.onExport(account.uid)}
                        >
                          {t("导出", "Export")}
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="subtle"
                          colorScheme="danger"
                          leftIcon={
                            <span
                              class="pull-analysis-trash-icon"
                              aria-hidden="true"
                            />
                          }
                          aria-label={t(
                            `删除 UID ${account.uid}`,
                            `Delete UID ${account.uid}`
                          )}
                          aria-expanded={confirming()}
                          disabled={
                            unavailable() || (!!confirmUid() && !confirming())
                          }
                          onClick={() =>
                            setConfirmUid(
                              confirming() ? undefined : account.uid
                            )
                          }
                        >
                          {t("删除", "Delete")}
                        </Button>
                      </div>
                    </div>
                    <Show when={confirming()}>
                      <div
                        class="pull-analysis-clear-confirm"
                        role="group"
                        aria-label={t(
                          "确认删除记录",
                          "Confirm deleting records"
                        )}
                      >
                        <p>
                          {t(
                            `将永久删除 UID ${
                              account.uid
                            } 在此设备上的 ${countText(account.list.length)}。`,
                            `Permanently delete ${countText(
                              account.list.length
                            )} for UID ${account.uid} from this device.`
                          )}
                        </p>
                        <div class="pull-analysis-uid-actions">
                          <Button
                            type="button"
                            size="xs"
                            variant="subtle"
                            colorScheme="neutral"
                            disabled={props.busy}
                            onClick={() => setConfirmUid(undefined)}
                          >
                            {t("取消", "Cancel")}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="solid"
                            colorScheme="danger"
                            disabled={unavailable()}
                            onClick={async () => {
                              if (await props.onClear(account.uid))
                                setConfirmUid(undefined);
                            }}
                          >
                            {t("确认删除", "Delete records")}
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
          <Show when={pageCount() > 1}>
            <nav
              class="pull-analysis-uid-pagination"
              aria-label={t("UID 列表分页", "UID list pagination")}
            >
              <Button
                type="button"
                size="xs"
                variant="subtle"
                colorScheme="neutral"
                disabled={props.busy || currentPage() === 1}
                onClick={() => changePage(currentPage() - 1)}
              >
                {t("上一页", "Previous")}
              </Button>
              <span class="pull-analysis-muted" aria-live="polite">
                {t(
                  `第 ${currentPage()} / ${pageCount()} 页`,
                  `Page ${currentPage()} of ${pageCount()}`
                )}
              </span>
              <Button
                type="button"
                size="xs"
                variant="subtle"
                colorScheme="neutral"
                disabled={props.busy || currentPage() === pageCount()}
                onClick={() => changePage(currentPage() + 1)}
              >
                {t("下一页", "Next")}
              </Button>
            </nav>
          </Show>
        </Show>
      </section>
    </div>
  );
}
