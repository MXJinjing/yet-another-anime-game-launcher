import { AppModal, AppModalButton } from "../components/app-modal";
import type { Accessor } from "solid-js";
import type { Locale } from "../locale";

export type LauncherUpdateInfo = {
  version?: string;
  description?: string;
  downloadUrl?: string;
  sidecarDownloadUrl?: string;
};

export function LauncherUpdateModal(props: {
  opened: Accessor<boolean>;
  onClose: () => void;
  pendingUpdateInfo: Accessor<LauncherUpdateInfo>;
  locale: Locale;
  onIgnore: (version: string) => void | Promise<void>;
  onUpdate: (info: LauncherUpdateInfo) => void;
}) {
  return (
    <AppModal
      opened={props.opened()}
      onClose={props.onClose}
      title={props.locale.get("NEW_VERSION_AVAILABLE")}
      footer={
        <>
          <AppModalButton
            variant="danger"
            onClick={async () => {
              await props.onIgnore(props.pendingUpdateInfo().version!);
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
      <div class="app-modal-message" style={{ "white-space": "pre-wrap" }}>
        {props.locale.format("NEW_VERSION_AVAILABLE_DESC", [
          props.pendingUpdateInfo().version!,
          props.pendingUpdateInfo().description!,
        ])}
      </div>
    </AppModal>
  );
}
