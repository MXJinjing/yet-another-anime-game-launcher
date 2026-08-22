import { AppModal, AppModalButton } from "../components/app-modal";
import type { Locale } from "../locale";
import type { JSXElement } from "solid-js";

export function LaunchErrorModal(props: {
  opened: boolean;
  title: JSXElement;
  message: JSXElement;
  cancelLabel: JSXElement;
  settingsLabel: JSXElement;
  details?: string;
  onCancel: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <AppModal
      opened={props.opened}
      onClose={props.onCancel}
      title={props.title}
      footer={
        <>
          <AppModalButton variant="secondary" onClick={props.onCancel}>
            {props.cancelLabel}
          </AppModalButton>
          <AppModalButton variant="primary" onClick={props.onOpenSettings}>
            {props.settingsLabel}
          </AppModalButton>
        </>
      }
    >
      <div class="app-modal-message">{props.message}</div>
      {props.details ? (
        <pre class="app-modal-error-details">{props.details}</pre>
      ) : null}
    </AppModal>
  );
}

export function RuntimeReplacementErrorModal(props: {
  opened: boolean;
  locale: Locale;
  details: string;
  onCancel: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <LaunchErrorModal
      opened={props.opened}
      title={props.locale.get("RUNTIME_REPLACEMENT_ERROR")}
      message={props.locale.get("RUNTIME_REPLACEMENT_ERROR_DESC")}
      details={props.details}
      cancelLabel={props.locale.get("SETTING_CANCEL")}
      settingsLabel={props.locale.get("GAME_CRASHED_SETTINGS")}
      onCancel={props.onCancel}
      onOpenSettings={props.onOpenSettings}
    />
  );
}
