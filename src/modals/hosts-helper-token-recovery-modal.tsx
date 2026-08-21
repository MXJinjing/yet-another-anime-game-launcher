import { AppModal, AppModalButton } from "../components/app-modal";
import type { Accessor } from "solid-js";
import type { Locale } from "../locale";

export function HostsHelperTokenRecoveryModal(props: {
  opened: Accessor<boolean>;
  busy: Accessor<boolean>;
  error: Accessor<string>;
  description: Accessor<string>;
  busyText: Accessor<string>;
  locale: Locale;
  onClose: () => void;
  onRepair: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  return (
    <AppModal
      opened={props.opened()}
      onClose={() => {
        if (!props.busy()) props.onClose();
      }}
      title={props.locale.get("SETTING_HOSTS_HELPER_TOKEN_MISSING_TITLE")}
      footer={
        <>
          <AppModalButton
            variant="secondary"
            disabled={props.busy()}
            onClick={props.onClose}
          >
            {props.locale.get("SETTING_HOSTS_HELPER_LATER")}
          </AppModalButton>
          <AppModalButton
            variant="primary"
            disabled={props.busy()}
            onClick={() => void props.onRepair()}
          >
            {props.locale.get("SETTING_HOSTS_HELPER_REREGISTER")}
          </AppModalButton>
          <AppModalButton
            variant="danger"
            disabled={props.busy()}
            onClick={() => void props.onDelete()}
          >
            {props.locale.get("SETTING_HOSTS_HELPER_DELETE_REGISTRATION")}
          </AppModalButton>
        </>
      }
    >
      <div class="app-modal-message">{props.description()}</div>
      {props.busy() ? (
        <div class="app-modal-message">{props.busyText()}</div>
      ) : null}
      {props.error() ? (
        <div class="app-modal-message" style={{ color: "#ff8080" }}>
          {props.error()}
        </div>
      ) : null}
    </AppModal>
  );
}
