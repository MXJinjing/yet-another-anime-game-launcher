import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Button, Checkbox, HStack, VStack } from "@hope-ui/solid";
import { Locale } from "../../locale";
import { AppModal, AppModalButton } from "../../components/app-modal";
import { AppSelect } from "../../components/app-select";
import { SettingSwitch } from "../../components/setting-switch";
import {
  WineEnvironmentActions,
  WineEnvironmentInfo,
} from "../../components/wine-environment";
import { SettingsTabPanel } from "./settings-tab-panel";

const AUTO_TAG = "__auto__";

function normalizeWineTag(tag: string | undefined) {
  return !tag || tag == AUTO_TAG || tag == "__shared__" ? AUTO_TAG : tag;
}

function autoWineOptionLabel(locale: Locale, label?: string) {
  const base = locale.get("SETTING_GAME_WINE_AUTO");
  if (!label) return base;
  return locale.currentLanguage.startsWith("zh")
    ? `${base}（${label}）`
    : `${base} (${label})`;
}

export function GameWineTab(props: {
  locale: Locale;
  wineEnabled?: () => boolean;
  autoWineLabel?: string;
  wineDataSupported?: boolean;
  onWineEnabledChange?: (
    enabled: boolean,
    options: { migrate: boolean; overwrite?: boolean }
  ) => void | Promise<void>;
  wineTag?: () => string;
  wineOptions?: { tag: string; displayName: string }[];
  onWineTagChange?: (
    tag: string,
    options: { migrate: boolean }
  ) => void | Promise<void>;
  onOpenWineCmd?: () => void | Promise<void>;
  onOpenWineCfg?: () => void | Promise<void>;
  winePrefix?: () => string;
  wineInstalled?: () => boolean;
  wineActionDisabled?: () => boolean;
  onResetWineEnv?: () => Promise<void>;
  gameWinePrefixExists?: () => boolean;
  onRemoveGameWinePrefix?: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const currentEnabled = () => props.wineEnabled?.() ?? false;
  const currentTag = () => normalizeWineTag(props.wineTag?.());

  // Everything below is a draft: nothing is applied until the user presses the
  // tab's Save button.
  const [draftEnabled, setDraftEnabled] = createSignal(currentEnabled());
  const [draftTag, setDraftTag] = createSignal(currentTag());
  const [migrate, setMigrate] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = createSignal(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = createSignal(false);

  createEffect(() => setDraftEnabled(currentEnabled()));
  createEffect(() => setDraftTag(currentTag()));

  const dirty = () =>
    draftEnabled() != currentEnabled() ||
    (draftEnabled() && draftTag() != currentTag());

  createEffect(() => props.onDirtyChange?.(dirty()));
  // Leaving the tab discards the draft, so the shared dirty flag must not stay
  // behind - otherwise every later tab switch would keep prompting.
  onCleanup(() => props.onDirtyChange?.(false));

  const wineOptions = () =>
    (props.wineOptions ?? []).filter(item => item.tag != "__shared__");

  async function run(action: () => void | Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      await Neutralino.os.showMessageBox(
        "Wine",
        `${props.locale.get("SETTING_GAME_WINE_PREPARE_FAILED")}\n\n${String(
          error
        )}`,
        "OK",
        "ERROR"
      );
    } finally {
      setBusy(false);
    }
  }

  // Migration is always the user's explicit choice, in both directions.
  const migrateOnSave = () => migrate();

  function save() {
    if (!dirty()) return;
    if (draftEnabled() != currentEnabled()) {
      if (draftEnabled() && props.gameWinePrefixExists?.()) {
        setOverwriteConfirmOpen(true);
        return;
      }
      void run(() =>
        props.onWineEnabledChange?.(draftEnabled(), {
          migrate: migrateOnSave(),
        })
      );
      return;
    }
    if (draftEnabled()) {
      void run(() =>
        props.onWineTagChange?.(draftTag(), { migrate: migrateOnSave() })
      );
    }
  }

  return (
    <SettingsTabPanel>
      <>
        <Show when={props.onWineEnabledChange}>
          <SettingSwitch
            id="gameWineEnabled"
            label={props.locale.get("SETTING_GAME_WINE_ENABLE")}
            description={
              props.wineDataSupported === false
                ? props.locale.currentLanguage.startsWith("zh")
                  ? "该游戏暂不支持独立 Wine 环境（缺少数据迁移映射）。"
                  : "This game does not support a separate Wine environment yet (no data migration mapping)."
                : props.locale.get("SETTING_GAME_WINE_ENABLE_DESC")
            }
            checked={draftEnabled()}
            disabled={
              busy() ||
              (props.wineActionDisabled?.() ?? false) ||
              props.wineDataSupported === false
            }
            onChange={setDraftEnabled}
          />
        </Show>

        <Show when={draftEnabled()}>
          <VStack spacing="$2" alignItems="stretch">
            <div class="hyp-setting-row">
              <span>{props.locale.get("SETTING_GAME_WINE")}</span>
              <AppSelect
                value={draftTag()}
                onChange={setDraftTag}
                disabled={busy() || (props.wineActionDisabled?.() ?? false)}
                width={280}
                options={[
                  {
                    value: AUTO_TAG,
                    label: autoWineOptionLabel(
                      props.locale,
                      props.autoWineLabel
                    ),
                  },
                  ...wineOptions().map(item => ({
                    value: item.tag,
                    label: item.displayName,
                  })),
                ]}
              />
            </div>
          </VStack>

          <Show
            when={
              props.winePrefix &&
              props.wineInstalled &&
              props.wineActionDisabled &&
              props.onResetWineEnv
            }
          >
            <WineEnvironmentInfo
              locale={props.locale}
              winePrefix={props.winePrefix?.() ?? ""}
              wineInstalled={props.wineInstalled!}
            />
            <WineEnvironmentActions
              locale={props.locale}
              onOpenCmd={props.onOpenWineCmd}
              onOpenWinecfg={props.onOpenWineCfg}
              winePrefix={props.winePrefix?.() ?? ""}
              wineInstalled={props.wineInstalled!}
              wineActionDisabled={props.wineActionDisabled!}
              onResetWineEnv={props.onResetWineEnv!}
              resetMessage={
                props.locale.currentLanguage.startsWith("zh")
                  ? "此操作将删除该游戏独立 Wine Prefix 中的所有数据（全局环境不受影响）。"
                  : "This deletes all data in this game's own Wine prefix. The global environment is untouched."
              }
            />
          </Show>
        </Show>

        <Show
          when={
            !currentEnabled() &&
            props.gameWinePrefixExists?.() &&
            props.onRemoveGameWinePrefix
          }
        >
          <HStack spacing="$2">
            <Button
              variant="ghost"
              size="sm"
              colorScheme="danger"
              disabled={(props.wineActionDisabled?.() ?? false) || busy()}
              onClick={() => setRemoveConfirmOpen(true)}
            >
              {props.locale.get("SETTING_GAME_WINE_REMOVE_PREFIX")}
            </Button>
          </HStack>
        </Show>

        <HStack
          justifyContent="flex-end"
          alignItems="center"
          spacing="$3"
          w="100%"
          mt="$4"
        >
          <Checkbox
            checked={migrate()}
            disabled={busy() || (props.wineActionDisabled?.() ?? false)}
            title={props.locale.get("SETTING_GAME_WINE_MIGRATE_DESC")}
            onChange={event =>
              setMigrate((event.currentTarget as HTMLInputElement).checked)
            }
          >
            {props.locale.get("SETTING_GAME_WINE_MIGRATE")}
          </Checkbox>
          <Show when={!draftEnabled() && currentEnabled()}>
            <span class="hyp-settings-muted">
              {props.locale.currentLanguage.startsWith("zh")
                ? "不勾选则数据保留在独立 Prefix 中（可稍后手动清理）"
                : "Unchecked keeps the data in the per-game prefix (clean it up manually later)"}
            </span>
          </Show>
          <Button
            size="sm"
            disabled={
              !dirty() || busy() || (props.wineActionDisabled?.() ?? false)
            }
            onClick={() => save()}
          >
            {props.locale.get("SETTING_SAVE")}
          </Button>
        </HStack>

        <AppModal
          opened={overwriteConfirmOpen()}
          onClose={() => setOverwriteConfirmOpen(false)}
          title={
            props.locale.currentLanguage.startsWith("zh")
              ? "该游戏已存在独立 Wine 环境"
              : "This game already has its own Wine environment"
          }
          contentClass="app-modal-content--nested"
          overlayClass="app-modal-overlay--nested"
          footer={
            <>
              <AppModalButton
                variant="secondary"
                onClick={() => setOverwriteConfirmOpen(false)}
              >
                {props.locale.currentLanguage.startsWith("zh")
                  ? "取消"
                  : "Cancel"}
              </AppModalButton>
              <AppModalButton
                variant="danger"
                disabled={busy()}
                onClick={() => {
                  setOverwriteConfirmOpen(false);
                  void run(() =>
                    props.onWineEnabledChange?.(true, {
                      migrate: migrate(),
                      overwrite: true,
                    })
                  );
                }}
              >
                {props.locale.currentLanguage.startsWith("zh")
                  ? "覆盖并重建"
                  : "Overwrite"}
              </AppModalButton>
            </>
          }
        >
          <div class="app-modal-message">
            {props.locale.currentLanguage.startsWith("zh")
              ? "已存在独立的 Wine Prefix。继续将删除它并重新创建（可选择同时迁移数据）。"
              : "A per-game Wine prefix already exists. Continuing deletes and recreates it (data can be migrated)."}
          </div>
          <div class="app-modal-warning">
            {props.locale.currentLanguage.startsWith("zh")
              ? "此操作不可恢复。"
              : "This action cannot be undone."}
          </div>
        </AppModal>

        <AppModal
          opened={removeConfirmOpen()}
          onClose={() => setRemoveConfirmOpen(false)}
          title={
            props.locale.currentLanguage.startsWith("zh")
              ? "删除独立 Wine 环境？"
              : "Remove the game's own Wine environment?"
          }
          contentClass="app-modal-content--nested"
          overlayClass="app-modal-overlay--nested"
          footer={
            <>
              <AppModalButton
                variant="secondary"
                onClick={() => setRemoveConfirmOpen(false)}
              >
                {props.locale.currentLanguage.startsWith("zh")
                  ? "取消"
                  : "Cancel"}
              </AppModalButton>
              <AppModalButton
                variant="danger"
                disabled={busy()}
                onClick={() => {
                  setRemoveConfirmOpen(false);
                  void run(() => props.onRemoveGameWinePrefix?.());
                }}
              >
                {props.locale.get("SETTING_GAME_WINE_REMOVE_PREFIX")}
              </AppModalButton>
            </>
          }
        >
          <div class="app-modal-message">
            {props.locale.get("SETTING_GAME_WINE_REMOVE_PREFIX_DESC")}
          </div>
          <div class="app-modal-warning">
            {props.locale.currentLanguage.startsWith("zh")
              ? "此操作不可恢复。"
              : "This action cannot be undone."}
          </div>
        </AppModal>
      </>
    </SettingsTabPanel>
  );
}
