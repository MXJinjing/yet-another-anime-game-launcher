import { Box, Button, HStack, Text, VStack } from "@hope-ui/solid";
import { createSignal, For, Show } from "solid-js";
import { Locale } from "../locale";
import { Config } from "./config-def";
import { getWineDistributions, isWineDistroInstalled } from "@wine";
import type { WineDistribution } from "@wine";
import "./wine-distribution.css";

declare module "./config-def" {
  interface Config {
    wineDistro: string;
  }
}

type WineDistroActionDone = (distro: WineDistribution) => void;

export async function createWineDistroConfig({
  locale,
  config,
  wineInstalled,
  wineDistroId,
  wineActionDisabled,
  onEnableWineDistro,
  onUninstallWineDistro,
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
  onUninstallWineDistro: (
    distro: WineDistribution,
    onDone: WineDistroActionDone
  ) => void;
}) {
  config.wineDistro = wineDistroId;

  const versions = await getWineDistributions();
  const initialInstalled = new Set(
    (
      await Promise.all(
        versions.map(async distro =>
          (await isWineDistroInstalled(distro.id)) ? distro.id : undefined
        )
      )
    ).filter((id): id is string => id != undefined)
  );

  const [activeWineDistroId, setActiveWineDistroId] =
    createSignal(wineDistroId);
  const [installedWineDistroIds, setInstalledWineDistroIds] =
    createSignal(initialInstalled);

  function markInstalled(distro: WineDistribution) {
    setInstalledWineDistroIds(prev => new Set([...prev, distro.id]));
  }

  function markEnabled(distro: WineDistribution) {
    markInstalled(distro);
    setActiveWineDistroId(distro.id);
    config.wineDistro = distro.id;
  }

  function markUninstalled(distro: WineDistribution) {
    setInstalledWineDistroIds(prev => {
      const next = new Set(prev);
      next.delete(distro.id);
      return next;
    });
  }

  function getWineDistroRank(distro: WineDistribution) {
    const installed = installedWineDistroIds().has(distro.id);
    const active = installed && activeWineDistroId() == distro.id;
    if (active) return 0;
    if (installed) return 1;
    return 2;
  }

  function sortedVersions() {
    return [...versions].sort(
      (a, b) => getWineDistroRank(a) - getWineDistroRank(b)
    );
  }

  function getWineDistroStatus(distro: WineDistribution) {
    const installed = installedWineDistroIds().has(distro.id);
    const active = installed && activeWineDistroId() == distro.id;
    if (active) return "active";
    if (installed) return "installed";
    return "not-installed";
  }

  async function enableWineDistro(distro: WineDistribution) {
    if (!wineInstalled()) {
      await locale.alert(
        "INIT_ENVIRONMENT_TITLE",
        "SETTING_WINE_INSTALL_INITIALIZES_ENVIRONMENT"
      );
    }
    onEnableWineDistro(distro, markEnabled);
  }

  function uninstallWineDistro(distro: WineDistribution) {
    onUninstallWineDistro(distro, markUninstalled);
  }

  return [
    function UI() {
      return (
        <VStack
          class="wine-distribution"
          spacing={"$2"}
          w="100%"
          alignItems="stretch"
        >
          <Text class="wine-distribution-heading" fontWeight="$semibold">
            {locale.get("SETTING_WINE_VERSION")}
          </Text>
          <For each={sortedVersions()}>
            {distro => {
              const status = () => getWineDistroStatus(distro);
              const installed = () => status() != "not-installed";
              const active = () => status() == "active";
              return (
                <Box
                  class={`wine-distribution-version-row wine-distribution-version-row--${status()}`}
                >
                  <HStack
                    class="wine-distribution-version-body"
                    justifyContent="space-between"
                    spacing="$3"
                    alignItems="center"
                  >
                    <HStack
                      class="wine-distribution-version-heading"
                      spacing="$2"
                      alignItems="center"
                    >
                      <Box
                        class={`wine-distribution-status-dot wine-distribution-status-dot--${status()}`}
                      />
                      <Text class="wine-distribution-version-name">
                        {distro.displayName}
                      </Text>
                      <Text
                        class={`wine-distribution-status-label wine-distribution-status-label--${status()}`}
                      >
                        {active()
                          ? locale.get("SETTING_WINE_STATUS_ENABLED")
                          : installed()
                          ? locale.get("SETTING_WINE_STATUS_INSTALLED")
                          : locale.get("SETTING_WINE_STATUS_NOT_INSTALLED")}
                      </Text>
                    </HStack>
                    <HStack
                      class="wine-distribution-version-actions"
                      spacing="$2"
                    >
                      <Button
                        class={
                          active()
                            ? "wine-distribution-button wine-distribution-button--active"
                            : "wine-distribution-button wine-distribution-button--primary"
                        }
                        size="sm"
                        disabled={active() || wineActionDisabled()}
                        title={
                          wineActionDisabled()
                            ? locale.get("SETTING_WINE_VERSION_UPDATE_BUSY")
                            : undefined
                        }
                        onClick={() => enableWineDistro(distro)}
                      >
                        {active()
                          ? locale.get("SETTING_WINE_STATUS_ENABLED")
                          : installed()
                          ? locale.get("SETTING_WINE_ENABLE")
                          : locale.get("SETTING_WINE_INSTALL")}
                      </Button>
                      <Show when={installed() && !active()}>
                        <Button
                          size="sm"
                          class="wine-distribution-button wine-distribution-button--danger"
                          disabled={wineActionDisabled()}
                          title={
                            wineActionDisabled()
                              ? locale.get("SETTING_WINE_VERSION_UPDATE_BUSY")
                              : undefined
                          }
                          onClick={() => uninstallWineDistro(distro)}
                        >
                          {locale.get("SETTING_WINE_UNINSTALL")}
                        </Button>
                      </Show>
                    </HStack>
                  </HStack>
                </Box>
              );
            }}
          </For>
        </VStack>
      );
    },
    {
      markEnabled,
    },
  ] as const;
}
