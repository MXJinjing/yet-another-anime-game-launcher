import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  VStack,
} from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { createGameInstallationDirectorySanitizer } from "../accidental-complexity";
import { Locale } from "../locale";
import {
  exec,
  exec2,
  env,
  humanFileSize,
  openDir,
  rawString,
  setKey,
} from "../utils";
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
  const [uninstallDialogOpen, setUninstallDialogOpen] = createSignal(false);

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

  async function clearGameDir(path: string) {
    if (!isSafeGameDir(path)) {
      await locale.alert("PATH_INVALID", "PATH_INVALID_FORBIDDEN_DIR");
      return false;
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
    return true;
  }

  createEffect(() => {
    updateDiskUsage(gameInstallDir());
  });

  async function uninstallGame() {
    const path = gameInstallDir();
    const cleared = await clearGameDir(path);
    if (!cleared) return;
    await setKey("game_install_dir", null);
    await onGameInstallDirChange?.("");
    setUninstallDialogOpen(false);
    await updateDiskUsage("");
  }

  return [
    function UI() {
      return (
        <>
          <FormControl id="gameInstallDir">
            <FormLabel>{locale.get("SETTING_GAME_INSTALL_DIR")}</FormLabel>
            <VStack spacing={"$3"} alignItems="stretch">
              <HStack spacing={"$2"} alignItems="center">
                <Input disabled readOnly value={gameInstallDir()} flex={1} />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!gameInstallDir()}
                  onClick={() =>
                    exec2(["open", gameInstallDir()], {}, false, "/dev/null")
                  }
                >
                  {locale.get("SETTING_OPEN")}
                </Button>
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
              <Button
                size="sm"
                variant="ghost"
                alignSelf="start"
                color="$danger8"
                _hover={{ bg: "$danger3", color: "$danger9" }}
                disabled={!gameInstallDir()}
                onClick={() => setUninstallDialogOpen(true)}
              >
                {locale.get("SETTING_UNINSTALL_GAME")}
              </Button>
            </VStack>
          </FormControl>
          <Modal
            opened={uninstallDialogOpen()}
            onClose={() => setUninstallDialogOpen(false)}
          >
            <ModalOverlay />
            <ModalContent>
              <ModalHeader>{locale.get("SETTING_UNINSTALL_GAME")}</ModalHeader>
              <ModalBody>
                <VStack spacing={"$3"} alignItems="stretch">
                  <Text style={{ "white-space": "pre-wrap" }}>
                    {locale.format("SETTING_UNINSTALL_GAME_CONFIRM", [
                      gameInstallDir(),
                    ])}
                  </Text>
                  <Text color="$danger10">
                    {locale.get("SETTING_UNINSTALL_SCREENSHOTS_NOTICE")}
                  </Text>
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="ghost"
                  mr="$3"
                  onClick={() => setUninstallDialogOpen(false)}
                >
                  {locale.get("SETTING_CANCEL")}
                </Button>
                <Button
                  colorScheme="danger"
                  onClick={() => uninstallGame()}
                  disabled={!gameInstallDir()}
                >
                  {locale.get("SETTING_UNINSTALL_GAME")}
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        </>
      );
    },
    onSave,
  ] as const;
}
