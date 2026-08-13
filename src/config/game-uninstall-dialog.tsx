import { createSignal } from "solid-js";
import { Locale } from "../locale";
import { env, exec, rawString, setKey } from "../utils";
import { AppModal, AppModalButton } from "../components/app-modal";

export async function createGameUninstallDialog({
  locale,
  gameInstallDir,
  onGameInstallDirChange,
  actionDisabled,
  onUninstall,
}: {
  locale: Locale;
  gameInstallDir: () => string;
  onGameInstallDirChange?: (path: string) => Promise<void>;
  actionDisabled?: () => boolean;
  onUninstall?: () => Promise<void>;
}) {
  const home = await env("HOME");
  const [open, setOpen] = createSignal(false);

  function isSafeGameDir(path: string) {
    if (!path || !path.startsWith("/") || path === "/" || path === home) {
      return false;
    }
    return path.split("/").filter(Boolean).length >= 2;
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

  async function uninstallGame() {
    const path = gameInstallDir();
    const cleared = await clearGameDir(path);
    if (!cleared) return;
    if (onUninstall) {
      await onUninstall();
    } else {
      await setKey("game_install_dir", null);
      await onGameInstallDirChange?.("");
    }
    setOpen(false);
  }

  function UI() {
    return (
      <AppModal
        opened={open()}
        onClose={() => setOpen(false)}
        title={locale.get("SETTING_UNINSTALL_GAME")}
        footer={
          <>
            <AppModalButton variant="secondary" onClick={() => setOpen(false)}>
              {locale.get("SETTING_CANCEL")}
            </AppModalButton>
            <AppModalButton
              variant="danger"
              disabled={!gameInstallDir() || actionDisabled?.()}
              onClick={() => uninstallGame()}
            >
              {locale.get("SETTING_UNINSTALL_GAME")}
            </AppModalButton>
          </>
        }
      >
        <div class="app-modal-message">
          {locale.format("SETTING_UNINSTALL_GAME_CONFIRM", [gameInstallDir()])}
        </div>
        <div class="app-modal-warning">
          {locale.get("SETTING_UNINSTALL_SCREENSHOTS_NOTICE")}
        </div>
      </AppModal>
    );
  }

  return { UI, open: () => setOpen(true) };
}
