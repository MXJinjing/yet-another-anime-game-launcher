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
import { createGameInstallationDirectorySanitizer } from "../accidental-complexity";
import { Locale } from "../locale";
import { exec, humanFileSize, openDir, setKey } from "../utils";
import { Config, NOOP } from "./config-def";

export async function createGameInstallDirConfig({
  locale,
  gameInstallDir,
  onGameInstallDirChange,
}: {
  config: Partial<Config>;
  locale: Locale;
  gameInstallDir: () => string;
  onGameInstallDirChange?: (path: string) => Promise<void>;
}) {
  const { selectPath } = await createGameInstallationDirectorySanitizer({
    openFolderDialog: async () =>
      await openDir(locale.get("SELECT_INSTALLATION_DIR")),
    locale,
  });
  const [diskUsage, setDiskUsage] = createSignal("");

  async function onSave(apply: boolean) {
    return NOOP;
  }

  async function updateDiskUsage(path: string) {
    if (!path) {
      setDiskUsage(locale.get("SETTING_GAME_DIR_SIZE_NOT_SET"));
      return;
    }
    try {
      const ret = await exec(["du", "-sk", path], {}, false);
      const sizeInKiB = Number(ret.stdOut.trim().split(/\s+/)[0]);
      setDiskUsage(
        Number.isFinite(sizeInKiB)
          ? humanFileSize(sizeInKiB * 1024, false, 2)
          : "-"
      );
    } catch {
      setDiskUsage("-");
    }
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
                  const path = await selectPath();
                  if (!path) return;
                  if (onGameInstallDirChange) {
                    await onGameInstallDirChange(path);
                    await updateDiskUsage(gameInstallDir());
                  } else {
                    await setKey("game_install_dir", path);
                    await updateDiskUsage(path);
                  }
                }}
              >
                {locale.get("SETTING_CHANGE_GAME_INSTALL_DIR")}
              </Button>
            </HStack>
            <Text size="sm" userSelect="none" color="$neutral11">
              {locale.format("SETTING_GAME_DIR_SIZE", [diskUsage()])}
            </Text>
          </VStack>
        </FormControl>
      );
    },
    onSave,
  ] as const;
}
