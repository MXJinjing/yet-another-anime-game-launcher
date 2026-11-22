import type { Locale } from "@locale";
import { AppModal, AppModalButton } from "../components/app-modal";

/**
 * The Wine the launcher selected is gone (a system Wine was uninstalled, or the
 * channel's tag no longer matches the shipped list).
 *
 * The dialog only explains the situation and points at the Wine settings page:
 * version selection and downloads both live there, so offering a second
 * "download a built-in Wine" shortcut here would silently install a version the
 * user never got to pick.
 */
export function WineMissingModal(props: {
  locale: Locale;
  /** The distribution whose files are gone. */
  missing: string;
  onOpenSettings: () => void;
  onCancel: () => void;
}) {
  const { locale } = props;

  return (
    <AppModal
      opened
      onClose={props.onCancel}
      title={locale.get("WINE_MISSING_TITLE")}
      footer={
        <>
          <AppModalButton onClick={props.onCancel}>
            {locale.get("SETTING_CANCEL")}
          </AppModalButton>
          <AppModalButton variant="primary" onClick={props.onOpenSettings}>
            {locale.get("WINE_MISSING_SETTINGS")}
          </AppModalButton>
        </>
      }
    >
      <div class="app-modal-message">
        {locale.format("WINE_MISSING_DESC", [props.missing])}
      </div>
    </AppModal>
  );
}
