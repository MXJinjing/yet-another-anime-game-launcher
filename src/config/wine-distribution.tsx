import {
  Box,
  Button,
  HStack,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
  Text,
  VStack,
} from "@hope-ui/solid";
import { createSignal, For, Show } from "solid-js";
import { Locale } from "../locale";
import { Config } from "./config-def";
import { getWineDistributions, isWineDistroInstalled } from "@wine";
import type { WineDistribution } from "@wine";

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

  function getStatusDotColor(distro: WineDistribution) {
    const installed = installedWineDistroIds().has(distro.id);
    const active = installed && activeWineDistroId() == distro.id;
    if (active) return "$success9";
    if (installed) return "$warning9";
    return "$neutral8";
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
        <VStack spacing={"$2"} w="100%" alignItems="stretch">
          <Text fontWeight="$semibold">
            {locale.get("SETTING_WINE_VERSION")}
          </Text>
          <For each={sortedVersions()}>
            {distro => {
              const installed = () => installedWineDistroIds().has(distro.id);
              const active = () =>
                installed() && activeWineDistroId() == distro.id;
              return (
                <Box
                  bg={active() ? "$success2" : undefined}
                  border="1px solid"
                  borderColor={active() ? "$success7" : "$neutral6"}
                  borderRadius="$sm"
                  px="$3"
                  py="$2"
                >
                  <HStack justifyContent="space-between" spacing="$3">
                    <VStack alignItems="start" spacing={0}>
                      <HStack spacing="$2">
                        <Box
                          w="8px"
                          h="8px"
                          borderRadius="$full"
                          bg={getStatusDotColor(distro)}
                        />
                        <Text>{distro.displayName}</Text>
                      </HStack>
                      <Text size="sm" color="$neutral11">
                        {active()
                          ? locale.get("SETTING_WINE_STATUS_ENABLED")
                          : installed()
                          ? locale.get("SETTING_WINE_STATUS_INSTALLED")
                          : locale.get("SETTING_WINE_STATUS_NOT_INSTALLED")}
                      </Text>
                    </VStack>
                    <HStack spacing="$2">
                      <Button
                        size="sm"
                        colorScheme={active() ? "neutral" : "primary"}
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
                        <Popover placement="left" triggerMode="click">
                          {({ onClose }) => (
                            <>
                              <PopoverTrigger
                                as={Button}
                                size="sm"
                                colorScheme="danger"
                                disabled={wineActionDisabled()}
                                title={
                                  wineActionDisabled()
                                    ? locale.get(
                                        "SETTING_WINE_VERSION_UPDATE_BUSY"
                                      )
                                    : undefined
                                }
                              >
                                {locale.get("SETTING_WINE_UNINSTALL")}
                              </PopoverTrigger>
                              <PopoverContent>
                                <PopoverArrow />
                                <PopoverHeader>
                                  {locale.get(
                                    "SETTING_WINE_UNINSTALL_CONFIRM_TITLE"
                                  )}
                                </PopoverHeader>
                                <PopoverBody>
                                  <Text size="sm">
                                    {locale.format(
                                      "SETTING_WINE_UNINSTALL_CONFIRM_DESC",
                                      [distro.displayName]
                                    )}
                                  </Text>
                                </PopoverBody>
                                <PopoverFooter>
                                  <HStack justifyContent="end" w="100%">
                                    <Button size="sm" onClick={onClose}>
                                      {locale.get("SETTING_CANCEL")}
                                    </Button>
                                    <Button
                                      size="sm"
                                      colorScheme="danger"
                                      onClick={() => {
                                        onClose();
                                        uninstallWineDistro(distro);
                                      }}
                                    >
                                      {locale.get(
                                        "SETTING_WINE_UNINSTALL_CONFIRM"
                                      )}
                                    </Button>
                                  </HStack>
                                </PopoverFooter>
                              </PopoverContent>
                            </>
                          )}
                        </Popover>
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
