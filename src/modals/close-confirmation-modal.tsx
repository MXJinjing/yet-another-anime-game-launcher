import { AppModal, AppModalButton } from "../components/app-modal";
import type { Accessor } from "solid-js";
import type { Locale } from "../locale";

export type ClosePrompt = "download" | "game" | null;
export type CloseDecision = "EXIT" | "CANCEL" | "CLOSE_GAME";

export function CloseConfirmationModal(props: {
  prompt: Accessor<ClosePrompt>;
  locale: Locale;
  resolve: (decision: CloseDecision) => void;
}) {
  return (
    <AppModal
      opened={props.prompt() != null}
      onClose={() => undefined}
      title={
        props.prompt() == "game"
          ? props.locale.get("GAME_RUNNING_CLOSE_TITLE")
          : props.locale.get("DOWNLOAD_RUNNING_CLOSE_TITLE")
      }
      footer={
        props.prompt() == "game" ? (
          <>
            <AppModalButton
              variant="secondary"
              onClick={() => props.resolve("CANCEL")}
            >
              {props.locale.get("SETTING_CANCEL")}
            </AppModalButton>
            <AppModalButton
              variant="danger"
              onClick={() => props.resolve("CLOSE_GAME")}
            >
              {props.locale.get("GAME_RUNNING_CLOSE_EXIT")}
            </AppModalButton>
          </>
        ) : (
          <>
            <AppModalButton
              variant="secondary"
              onClick={() => props.resolve("CANCEL")}
            >
              {props.locale.get("SETTING_CANCEL")}
            </AppModalButton>
            <AppModalButton
              variant="danger"
              onClick={() => props.resolve("EXIT")}
            >
              {props.locale.get("DOWNLOAD_RUNNING_CLOSE_EXIT")}
            </AppModalButton>
          </>
        )
      }
    >
      <div class="app-modal-message">
        {props.prompt() == "game"
          ? props.locale.get("GAME_RUNNING_CLOSE_DESC")
          : props.locale.get("DOWNLOAD_RUNNING_CLOSE_DESC")}
      </div>
    </AppModal>
  );
}
