import {
  Box,
  Button,
  HStack,
  Input,
  Text,
  Tooltip,
  VStack,
} from "@hope-ui/solid";
import { createSignal, For, Show } from "solid-js";
import { Locale } from "@locale";
import { Config } from "../../../config/config-def";
import { AppModal, AppModalButton } from "../../../components/app-modal";
import { AppSelect } from "../../../components/app-select";
import closeIcon from "../../../assets/icons/close.svg";
import downloadIcon from "../../../assets/icons/download.svg";
import editIcon from "../../../assets/icons/edit.svg";
import trashIcon from "../../../assets/icons/trash.svg";
import { getWineDistributions, isWineDistroInstalled } from "@wine";
import type { WineDistribution } from "@wine";
import {
  type CustomWineEntry,
  findConfiguredWine,
  readCustomWineEntries,
  writeCustomWineEntries,
} from "../../../wine/system-wine";
import "./wine-distribution.css";

declare module "../../../config/config-def" {
  interface Config {
    wineDistro: string;
    customWineEntries: CustomWineEntry[];
  }
}

type WineDistroActionDone = (distro: WineDistribution) => void;
type WineDistroDownloadProgress = (
  progress: number | undefined,
  phase?: "extracting"
) => void;
type WineDistroDownloadFinished = () => void;

export type WineDistroUsage = {
  distroId: string;
  label: string;
};

export async function createWineDistroConfig({
  locale,
  config,
  wineInstalled,
  wineDistroId,
  wineActionDisabled,
  onEnableWineDistro,
  onDownloadWineDistro,
  onUninstallWineDistro,
  wineDistroUsages = () => [],
}: {
  locale: Locale;
  config: Partial<Config>;
  wineInstalled: () => boolean;
  wineDistroId: string;
  wineActionDisabled: () => boolean;
  onEnableWineDistro: (
    distro: WineDistribution,
    onDone: WineDistroActionDone
  ) => void;
  onDownloadWineDistro: (
    distro: WineDistribution,
    onDone: WineDistroActionDone,
    onProgress: WineDistroDownloadProgress,
    onFinished: WineDistroDownloadFinished
  ) => void;
  onUninstallWineDistro: (
    distro: WineDistribution,
    onDone: WineDistroActionDone
  ) => void;
  /** Per-game Wine selections that must not be removed from the global list. */
  wineDistroUsages?: () => WineDistroUsage[];
}) {
  config.wineDistro = wineDistroId;
  const initialCustomWineEntries = await readCustomWineEntries();
  config.customWineEntries = initialCustomWineEntries;

  const initialVersions = await getWineDistributions();
  const initialInstalled = new Set(
    (
      await Promise.all(
        initialVersions.map(async distro =>
          (await isWineDistroInstalled(distro.id)) ? distro.id : undefined
        )
      )
    ).filter((id): id is string => id != undefined)
  );

  const [activeWineDistroId, setActiveWineDistroId] =
    createSignal(wineDistroId);
  const [selectedWineDistroId, setSelectedWineDistroId] =
    createSignal(wineDistroId);
  const [versions, setVersions] = createSignal(initialVersions);
  const [customWineEntries, setCustomWineEntries] = createSignal(
    initialCustomWineEntries
  );
  const [editingWine, setEditingWine] = createSignal<WineDistribution>();
  const [editName, setEditName] = createSignal("");
  const [editBinary, setEditBinary] = createSignal("");
  const [installedWineDistroIds, setInstalledWineDistroIds] =
    createSignal(initialInstalled);
  const [downloadProgresses, setDownloadProgresses] = createSignal(
    new Map<string, { progress: number | undefined; extracting: boolean }>()
  );

  function markInstalled(distro: WineDistribution) {
    setInstalledWineDistroIds(prev => new Set([...prev, distro.id]));
  }

  function markEnabled(distro: WineDistribution) {
    markInstalled(distro);
    setActiveWineDistroId(distro.id);
    setSelectedWineDistroId(distro.id);
    config.wineDistro = distro.id;
  }

  function markUninstalled(distro: WineDistribution) {
    setInstalledWineDistroIds(prev => {
      const next = new Set(prev);
      next.delete(distro.id);
      return next;
    });
    if (selectedWineDistroId() == distro.id)
      setSelectedWineDistroId(activeWineDistroId());
  }

  function getWineDistroRank(distro: WineDistribution) {
    const installed = installedWineDistroIds().has(distro.id);
    if (installed && isWineDistroInUse(distro)) return 0;
    if (installed) return 1;
    return 2;
  }

  function sortedVersions() {
    return [...versions()].sort(
      (a, b) => getWineDistroRank(a) - getWineDistroRank(b)
    );
  }

  function downloadedVersions() {
    return sortedVersions().filter(distro =>
      installedWineDistroIds().has(distro.id)
    );
  }

  function downloadableVersions() {
    return sortedVersions().filter(
      distro => !installedWineDistroIds().has(distro.id)
    );
  }

  function getWineDistroStatus(distro: WineDistribution) {
    const installed = installedWineDistroIds().has(distro.id);
    if (installed && isWineDistroInUse(distro)) return "active";
    if (installed) return "installed";
    return "not-installed";
  }

  function wineDistroUsageLabels(distro: WineDistribution) {
    const usages = wineDistroUsages()
      .filter(usage => usage.distroId == distro.id)
      .map(usage => usage.label);
    if (activeWineDistroId() == distro.id) {
      usages.unshift(
        locale.currentLanguage.startsWith("zh")
          ? "全局 Wine 环境"
          : "Global Wine environment"
      );
    }
    return usages;
  }

  function isWineDistroInUse(distro: WineDistribution) {
    return wineDistroUsageLabels(distro).length > 0;
  }

  function wineDistroStatusTitle(distro: WineDistribution) {
    const usages = wineDistroUsageLabels(distro);
    if (usages.length > 0) {
      const heading = locale.currentLanguage.startsWith("zh")
        ? "正在使用："
        : "In use by:";
      return `${heading}\n${usages.map(usage => `• ${usage}`).join("\n")}`;
    }
    return getWineDistroStatus(distro) == "installed"
      ? locale.get("SETTING_WINE_STATUS_INSTALLED")
      : locale.get("SETTING_WINE_STATUS_NOT_INSTALLED");
  }

  async function saveGlobalWineDistro() {
    const distro = downloadedVersions().find(
      item => item.id == selectedWineDistroId()
    );
    if (!distro || distro.id == activeWineDistroId()) return;
    if (!wineInstalled()) {
      await locale.alert(
        "INIT_ENVIRONMENT_TITLE",
        "SETTING_WINE_INSTALL_INITIALIZES_ENVIRONMENT"
      );
    }
    onEnableWineDistro(distro, markEnabled);
  }

  function uninstallWineDistro(distro: WineDistribution) {
    if (isWineDistroInUse(distro)) return;
    onUninstallWineDistro(distro, markUninstalled);
  }

  function downloadWineDistro(distro: WineDistribution) {
    if (wineActionDisabled()) return;
    setDownloadProgresses(previous => {
      const next = new Map(previous);
      next.set(distro.id, { progress: 0, extracting: false });
      return next;
    });
    onDownloadWineDistro(
      distro,
      markInstalled,
      (progress, phase) => {
        setDownloadProgresses(previous => {
          const next = new Map(previous);
          next.set(distro.id, {
            progress,
            extracting: phase == "extracting",
          });
          return next;
        });
      },
      () => {
        setDownloadProgresses(previous => {
          const next = new Map(previous);
          next.delete(distro.id);
          return next;
        });
      }
    );
  }

  async function refreshVersions() {
    const nextVersions = await getWineDistributions();
    setVersions(nextVersions);
    const installed = new Set(
      (
        await Promise.all(
          nextVersions.map(async distro =>
            (await isWineDistroInstalled(distro.id)) ? distro.id : undefined
          )
        )
      ).filter((id): id is string => id != undefined)
    );
    setInstalledWineDistroIds(installed);
    return nextVersions;
  }

  async function chooseCustomWine() {
    const picked = await Neutralino.os.showOpenDialog(
      locale.get("SETTING_WINE_SELECT_BINARY"),
      {
        filter: [
          { name: locale.get("SETTING_WINE_BINARY_FILE"), extensions: ["*"] },
        ],
      }
    );
    const selected = picked[0];
    const selectedWine = selected
      ? await findConfiguredWine(selected)
      : undefined;
    if (!selected || !selectedWine) {
      if (selected) {
        await Neutralino.os.showMessageBox(
          "Wine",
          locale.get("SETTING_WINE_INVALID_BINARY"),
          "OK",
          "ERROR"
        );
      }
      return;
    }
    const configuredWines = await Promise.all(
      customWineEntries().map(entry => findConfiguredWine(entry.binary))
    );
    if (configuredWines.some(wine => wine?.root == selectedWine.root)) return;
    const nextEntries = [
      ...customWineEntries(),
      { name: locale.get("SETTING_WINE_CUSTOM_NAME"), binary: selected },
    ];
    config.customWineEntries = nextEntries;
    setCustomWineEntries(nextEntries);
    await writeCustomWineEntries(nextEntries);
    await refreshVersions();
  }

  async function removeCustomWine(distro: WineDistribution) {
    if (!distro.customWine || isWineDistroInUse(distro)) return;
    const nextEntries = customWineEntries().filter(
      entry => entry.binary != distro.customWine?.binary
    );
    config.customWineEntries = nextEntries;
    setCustomWineEntries(nextEntries);
    await writeCustomWineEntries(nextEntries);
    await refreshVersions();
  }

  function startEditCustomWine(distro: WineDistribution) {
    if (!distro.customWine) return;
    setEditingWine(distro);
    setEditName(distro.customWine.name);
    setEditBinary(distro.customWine.binary);
  }

  async function saveCustomWine() {
    const original = editingWine();
    if (!original?.customWine) return;
    const binary = editBinary().trim();
    const name = editName().trim() || locale.get("SETTING_WINE_CUSTOM_NAME");
    const wine = await findConfiguredWine(binary);
    if (!wine) return;
    const nextEntries = customWineEntries().map(entry =>
      entry.binary == original.customWine?.binary ? { name, binary } : entry
    );
    config.customWineEntries = nextEntries;
    setCustomWineEntries(nextEntries);
    await writeCustomWineEntries(nextEntries);
    const nextVersions = await refreshVersions();
    setEditingWine();
    if (activeWineDistroId() == original.id) {
      const updated = nextVersions.find(
        distro => distro.customWine?.binary == binary
      );
      if (updated) setSelectedWineDistroId(updated.id);
    }
  }

  return [
    function UI() {
      const versionHeader = locale.get("SETTING_WINE_TABLE_VERSION");
      const statusHeader = locale.get("SETTING_WINE_TABLE_STATUS");
      const actionHeader = locale.get("SETTING_WINE_TABLE_ACTION");

      function sourceLabel(distro: WineDistribution) {
        if (distro.customWine) return locale.get("SETTING_WINE_SOURCE_LOCAL");
        if (distro.systemWineRoot)
          return locale.get("SETTING_WINE_SOURCE_SYSTEM");
        return locale.get("SETTING_WINE_SOURCE_OFFICIAL");
      }

      function WineRows(props: { distros: WineDistribution[] }) {
        return (
          <For each={props.distros}>
            {distro => {
              const status = () => getWineDistroStatus(distro);
              const installed = () => status() != "not-installed";
              const active = () => status() == "active";
              const inUse = () => isWineDistroInUse(distro);
              const usageCount = () => wineDistroUsageLabels(distro).length;
              const downloadState = () => downloadProgresses().get(distro.id);
              const downloading = () => downloadProgresses().has(distro.id);
              return (
                <tr
                  class={`wine-distribution-version-row wine-distribution-version-row--${status()}`}
                >
                  <td class="wine-distribution-status-cell">
                    <Tooltip label={wineDistroStatusTitle(distro)}>
                      <Box
                        class={`wine-distribution-status-dot wine-distribution-status-dot--${status()}`}
                        aria-label={wineDistroStatusTitle(distro)}
                      >
                        <Show when={active()}>{usageCount()}</Show>
                      </Box>
                    </Tooltip>
                  </td>
                  <td class="wine-distribution-version-cell">
                    <HStack
                      class="wine-distribution-version-heading"
                      spacing="$2"
                      alignItems="center"
                    >
                      <Text
                        class="wine-distribution-version-name"
                        title={distro.displayName}
                      >
                        {distro.displayName}
                      </Text>
                      <Text class="wine-distribution-source-label">
                        {sourceLabel(distro)}
                      </Text>
                    </HStack>
                  </td>
                  <td class="wine-distribution-actions-cell">
                    <HStack
                      class="wine-distribution-version-actions"
                      spacing="$2"
                      justifyContent="center"
                    >
                      <Show when={!installed()}>
                        <Button
                          class={
                            downloading()
                              ? "wine-distribution-button wine-distribution-button--primary wine-distribution-download-progress"
                              : "wine-distribution-button wine-distribution-button--primary wine-distribution-icon-button"
                          }
                          size="sm"
                          disabled={downloading() || wineActionDisabled()}
                          title={
                            downloading()
                              ? undefined
                              : wineActionDisabled()
                              ? locale.get("SETTING_WINE_VERSION_UPDATE_BUSY")
                              : locale.get("SETTING_DOWNLOAD")
                          }
                          onClick={() => downloadWineDistro(distro)}
                        >
                          {downloading() ? (
                            downloadState()?.extracting ? (
                              locale.get("SETTING_WINE_EXTRACTING")
                            ) : downloadState()?.progress == undefined ? (
                              locale.get("SETTING_WINE_DOWNLOADING")
                            ) : (
                              `${Math.round(downloadState()?.progress ?? 0)}%`
                            )
                          ) : (
                            <img src={downloadIcon} alt="" />
                          )}
                        </Button>
                      </Show>
                      <Show
                        when={
                          installed() &&
                          !distro.systemWineRoot &&
                          !distro.customWine
                        }
                      >
                        <Button
                          size="sm"
                          class="wine-distribution-button wine-distribution-button--danger wine-distribution-icon-button"
                          disabled={wineActionDisabled() || inUse()}
                          title={
                            wineActionDisabled()
                              ? locale.get("SETTING_WINE_VERSION_UPDATE_BUSY")
                              : inUse()
                              ? wineDistroStatusTitle(distro)
                              : locale.get("SETTING_WINE_UNINSTALL")
                          }
                          onClick={() => uninstallWineDistro(distro)}
                        >
                          <img src={trashIcon} alt="" />
                        </Button>
                      </Show>
                      <Show when={distro.customWine}>
                        <Button
                          size="sm"
                          class="wine-distribution-icon-button"
                          disabled={wineActionDisabled()}
                          title={locale.get("SETTING_WINE_EDIT")}
                          onClick={() => startEditCustomWine(distro)}
                        >
                          <img src={editIcon} alt="" />
                        </Button>
                        <Button
                          size="sm"
                          class="wine-distribution-icon-button wine-distribution-button--danger"
                          disabled={inUse() || wineActionDisabled()}
                          title={
                            inUse()
                              ? wineDistroStatusTitle(distro)
                              : locale.get("SETTING_WINE_REMOVE")
                          }
                          onClick={() => void removeCustomWine(distro)}
                        >
                          <img src={closeIcon} alt="" />
                        </Button>
                      </Show>
                    </HStack>
                  </td>
                </tr>
              );
            }}
          </For>
        );
      }

      return (
        <VStack
          class="wine-distribution"
          spacing="$4"
          w="100%"
          alignItems="stretch"
        >
          <VStack
            class="wine-distribution-section"
            spacing="$2"
            alignItems="stretch"
          >
            <HStack justifyContent="space-between" alignItems="center">
              <Text class="wine-distribution-heading" fontWeight="$semibold">
                {locale.get("SETTING_WINE_DOWNLOADED")}
              </Text>
              <Button
                size="sm"
                variant="ghost"
                disabled={wineActionDisabled()}
                onClick={() => void chooseCustomWine()}
              >
                {locale.get("SETTING_WINE_ADD_LOCAL")}
              </Button>
            </HStack>
            <div class="wine-distribution-table-shell">
              <table class="wine-distribution-table">
                <colgroup>
                  <col class="wine-distribution-status-column" />
                  <col />
                  <col class="wine-distribution-actions-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{statusHeader}</th>
                    <th>{versionHeader}</th>
                    <th>{actionHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  <WineRows distros={downloadedVersions()} />
                </tbody>
              </table>
            </div>
          </VStack>
          <VStack
            class="wine-distribution-section"
            spacing="$2"
            alignItems="stretch"
          >
            <Text class="wine-distribution-heading" fontWeight="$semibold">
              {locale.get("SETTING_WINE_AVAILABLE")}
            </Text>
            <div class="wine-distribution-table-shell">
              <table class="wine-distribution-table">
                <colgroup>
                  <col class="wine-distribution-status-column" />
                  <col />
                  <col class="wine-distribution-actions-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{statusHeader}</th>
                    <th>{versionHeader}</th>
                    <th>{actionHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  <WineRows distros={downloadableVersions()} />
                </tbody>
              </table>
            </div>
          </VStack>
          <AppModal
            opened={editingWine() != undefined}
            onClose={() => setEditingWine()}
            title={locale.get("SETTING_WINE_EDIT_LOCAL_TITLE")}
            contentClass="wine-edit-modal-content"
            overlayClass="wine-edit-modal-overlay"
            footer={
              <>
                <AppModalButton
                  variant="secondary"
                  onClick={() => setEditingWine()}
                >
                  {locale.get("SETTING_CANCEL")}
                </AppModalButton>
                <AppModalButton
                  variant="primary"
                  onClick={() => void saveCustomWine()}
                >
                  {locale.get("SETTING_SAVE")}
                </AppModalButton>
              </>
            }
          >
            <VStack spacing="$3" alignItems="stretch">
              <Input
                value={editName()}
                placeholder={locale.get("SETTING_WINE_LOCAL_NAME")}
                onInput={event => setEditName(event.currentTarget.value)}
              />
              <Input
                value={editBinary()}
                placeholder={locale.get("SETTING_WINE_BINARY_PATH")}
                onInput={event => setEditBinary(event.currentTarget.value)}
              />
            </VStack>
          </AppModal>
        </VStack>
      );
    },
    function GlobalWineDistroConfig() {
      return (
        <VStack spacing="$2" alignItems="stretch">
          <div class="hyp-setting-row">
            <span>{locale.get("SETTING_WINE_GLOBAL")}</span>
            <AppSelect
              value={selectedWineDistroId()}
              onChange={setSelectedWineDistroId}
              width={280}
              disabled={wineActionDisabled()}
              options={downloadedVersions().map(distro => ({
                value: distro.id,
                label: distro.displayName,
              }))}
            />
          </div>
          <Show when={selectedWineDistroId() != activeWineDistroId()}>
            <Button
              class="wine-global-save-button"
              size="sm"
              alignSelf="flex-end"
              disabled={wineActionDisabled()}
              onClick={() => void saveGlobalWineDistro()}
            >
              {locale.get("SETTING_SAVE")}
            </Button>
          </Show>
        </VStack>
      );
    },
    {
      markEnabled,
    },
  ] as const;
}
