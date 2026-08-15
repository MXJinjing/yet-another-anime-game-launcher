import { createSignal } from "solid-js";
import { Locale } from "../locale";
import { log } from "../logging/logger";
import { env } from "../platform/neutralino";
import { setKey } from "../runtime/storage";
import { AppModal, AppModalButton } from "../components/app-modal";
import {
  clearGameInstallDirectory,
  normalizeGameInstallDir,
} from "../services/game-uninstallation";

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

  async function clearGameDir(path: string) {
    const normalizedPath = normalizeGameInstallDir(path, home);
    if (!normalizedPath) {
      await locale.alert("PATH_INVALID", "PATH_INVALID_FORBIDDEN_DIR");
      return false;
    }
    try {
      await clearGameInstallDirectory(normalizedPath);
      return true;
    } catch (error) {
      await log(
        `Game uninstall failed for ${normalizedPath}: ${String(error)}`
      );
      await locale.alert(
        "NOTIFICATION_TASK_FAILED_TITLE",
        "NOTIFICATION_TASK_FAILED"
      );
      return false;
    }
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
