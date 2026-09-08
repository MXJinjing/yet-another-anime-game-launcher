import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Text,
  VStack,
} from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { humanFileSize } from "../../../runtime/format";
import { configEntries, type ConfigStore } from "@config";
import { Config, NOOP } from "../../../config/config-def";
import { selectGameInstallationDirectory } from "../../../services/game-installation";
import { getDirectorySize } from "../../../services/directory-size";

export async function createGameInstallDirConfig({
  locale,
  gameInstallDir,
  gameVersion,
  onGameInstallDirChange,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  gameInstallDir: () => string;
  gameVersion: () => string;
  onGameInstallDirChange?: (path: string) => Promise<void>;
  store: ConfigStore;
}) {
  const [diskUsage, setDiskUsage] = createSignal("");

  async function onSave(apply: boolean) {
    return NOOP;
  }

  async function updateDiskUsage(path: string) {
    if (!path) {
      setDiskUsage(locale.get("SETTING_GAME_DIR_SIZE_NOT_SET"));
      return;
    }
    const size = await getDirectorySize(path);
    setDiskUsage(size == null ? "-" : humanFileSize(size, false, 2));
  }

  createEffect(() => {
    updateDiskUsage(gameInstallDir());
  });

  return [
    function UI() {
      return (
        <FormControl id="gameInstallDir">
          <FormLabel>{locale.get("SETTING_GAME_INSTALL_DIR")}</FormLabel>
          <VStack spacing={"$3"} alignItems="stretch">
            <HStack spacing={"$2"} alignItems="center">
              <Input disabled readOnly value={gameInstallDir()} flex={1} />
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const path = await selectGameInstallationDirectory(locale);
                  if (!path) return;
                  if (onGameInstallDirChange) {
                    await onGameInstallDirChange(path);
                    await updateDiskUsage(gameInstallDir());
                  } else {
                    await store.write(configEntries.gameInstallDir, path);
                    await updateDiskUsage(path);
                  }
                }}
              >
                {locale.get("SETTING_CHANGE_GAME_INSTALL_DIR")}
              </Button>
            </HStack>
            <HStack spacing="$4">
              <Text size="sm" userSelect="none" color="$neutral11">
                {locale.get("GAME_VERSION")}: {gameVersion()}
              </Text>
              <Text size="sm" userSelect="none" color="$neutral11">
                {locale.format("SETTING_GAME_DIR_SIZE", [diskUsage()])}
              </Text>
            </HStack>
          </VStack>
        </FormControl>
      );
    },
    onSave,
  ] as const;
}
