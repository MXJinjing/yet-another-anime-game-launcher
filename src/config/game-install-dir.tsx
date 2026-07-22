import {
  Box,
  Button,
  Checkbox,
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
import { exec, env, openDir, rawString, setKey } from "../utils";
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
  const home = await env("HOME");
  const [diskUsage, setDiskUsage] = createSignal("");
  const [deleteScreenshots, setDeleteScreenshots] = createSignal(false);

  async function onSave(apply: boolean) {
    return NOOP;
  }

  function isSafeGameDir(path: string) {
    if (!path || !path.startsWith("/") || path === "/" || path === home) {
      return false;
    }
    return path.split("/").filter(Boolean).length >= 2;
  }

  async function updateDiskUsage(path: string) {
    if (!path) {
      setDiskUsage(locale.get("SETTING_GAME_DIR_SIZE_NOT_SET"));
      return;
    }
    try {
      const ret = await exec(["du", "-sh", path], {}, false);
      setDiskUsage(ret.stdOut.trim().split(/\s+/)[0] || "-");
    } catch {
      setDiskUsage("-");
    }
  }

  async function clearGameDir(path: string) {
    if (!isSafeGameDir(path)) {
      await locale.alert("PATH_INVALID", "PATH_INVALID_FORBIDDEN_DIR");
      return;
    }
    await exec([
      "find",
      path,
      "-mindepth",
      "1",
      "-maxdepth",
      "1",
      "-exec",
      "rm",
      "-rf",
      rawString("{}"),
      rawString("+"),
    ]);
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
              <Input disabled readOnly value={gameInstallDir()} />
              <Text
                size="sm"
                userSelect="none"
                style={{ "white-space": "nowrap" }}
              >
                {locale.format("SETTING_GAME_DIR_SIZE", [diskUsage()])}
              </Text>
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
            <Box>
              <Checkbox
                checked={deleteScreenshots()}
                onChange={() => setDeleteScreenshots(x => !x)}
                size="sm"
              >
                {locale.get("SETTING_UNINSTALL_DELETE_SCREENSHOTS")}
              </Checkbox>
            </Box>
            <Button
              size="sm"
              variant="ghost"
              colorScheme="danger"
              alignSelf="start"
              disabled={!gameInstallDir() || !deleteScreenshots()}
              onClick={async () => {
                const path = gameInstallDir();
                const confirmed = await locale.prompt(
                  "SETTING_UNINSTALL_GAME",
                  "SETTING_UNINSTALL_GAME_CONFIRM",
                  [path]
                );
                if (!confirmed) return;
                await clearGameDir(path);
                await setKey("game_install_dir", null);
                await onGameInstallDirChange?.("");
                setDeleteScreenshots(false);
                await updateDiskUsage("");
              }}
            >
              {locale.get("SETTING_UNINSTALL_GAME")}
            </Button>
          </VStack>
        </FormControl>
      );
    },
    onSave,
  ] as const;
}
