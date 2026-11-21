import { Text } from "@hope-ui/solid";
import { Show, type Accessor } from "solid-js";
import { AppModal, AppModalButton } from "../components/app-modal";
import type { Locale } from "../locale";

export function GameUpdatePromptModal<T>(props: {
  game: Accessor<T | undefined>;
  locale: Locale;
  onClose: () => void;
  onConfirm: (game: T) => void;
}) {
  return (
    <AppModal
      opened={!!props.game()}
      onClose={props.onClose}
      title={props.locale.get("SETTING_GAME_UPDATE_AVAILABLE")}
      footer={
        <>
          <AppModalButton variant="secondary" onClick={props.onClose}>
            {props.locale.get("SETTING_CANCEL_INSTALL")}
          </AppModalButton>
          <AppModalButton
            variant="primary"
            onClick={() => {
              const game = props.game();
              if (game) props.onConfirm(game);
            }}
          >
            {props.locale.get("SETTING_CONFIRM_INSTALL")}
          </AppModalButton>
        </>
      }
    >
      <Show when={props.game()}>
        <Text class="app-modal-message">
          {props.locale.get("SETTING_GAME_UPDATE_AVAILABLE_DESC")}
        </Text>
      </Show>
    </AppModal>
  );
}
