import { AppModal, AppModalButton } from "../components/app-modal";
import { createMemo, type Accessor } from "solid-js";
import type { Locale } from "../locale";
import { renderMarkdownHtml } from "./markdown";
import "./launcher-update-modal.css";
import "./modal-markdown.css";

export type LauncherUpdateInfo = {
  version?: string;
  description?: string;
  appDownloadUrl?: string;
};

export function LauncherUpdateModal(props: {
  opened: Accessor<boolean>;
  onClose: () => void;
  pendingUpdateInfo: Accessor<LauncherUpdateInfo>;
  locale: Locale;
  onIgnore: (version: string) => void | Promise<void>;
  onUpdate: (info: LauncherUpdateInfo) => void;
}) {
  // The GitHub release body is markdown (GFM); render it to sanitized HTML.
  const changelogHtml = createMemo(() =>
    renderMarkdownHtml(props.pendingUpdateInfo().description ?? "")
  );

  return (
    <AppModal
      opened={props.opened()}
      onClose={props.onClose}
      title={props.locale.get("NEW_VERSION_AVAILABLE")}
      maxWidth={640}
      footer={
        <>
          <AppModalButton
            variant="danger"
            onClick={async () => {
              await props.onIgnore(props.pendingUpdateInfo().version ?? "");
              props.onClose();
            }}
          >
            {props.locale.get("UPDATE_PROMPT_IGNORE")}
          </AppModalButton>
          <AppModalButton variant="secondary" onClick={props.onClose}>
            {props.locale.get("SETTING_CANCEL")}
          </AppModalButton>
          <AppModalButton
            variant="primary"
            onClick={() => {
              props.onUpdate(props.pendingUpdateInfo());
              props.onClose();
            }}
          >
            {props.locale.get("UPDATE_LAUNCHER")}
          </AppModalButton>
        </>
      }
    >
      <div class="app-modal-message">
        <p class="launcher-update-prompt">
          {props.locale.format("NEW_VERSION_AVAILABLE_DESC", [
            props.pendingUpdateInfo().version ?? "",
            "",
          ])}
        </p>
        <div
          class="launcher-update-changelog modal-markdown"
          innerHTML={changelogHtml()}
        />
      </div>
    </AppModal>
  );
}
