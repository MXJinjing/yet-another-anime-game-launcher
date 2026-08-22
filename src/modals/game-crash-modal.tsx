import type { Locale } from "../locale";
import { LaunchErrorModal } from "./runtime-replacement-error-modal";

export function GameCrashModal(props: {
  opened: boolean;
  locale: Locale;
  onIgnore: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <LaunchErrorModal
      opened={props.opened}
      title={props.locale.get("GAME_CRASHED")}
      message={props.locale.get("GAME_CRASHED_DESC")}
      cancelLabel={props.locale.get("GAME_CRASHED_IGNORE")}
      settingsLabel={props.locale.get("GAME_CRASHED_SETTINGS")}
      onCancel={props.onIgnore}
      onOpenSettings={props.onOpenSettings}
    />
  );
}
