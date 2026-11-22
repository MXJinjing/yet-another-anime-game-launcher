import { createSignal } from "solid-js";
import type { Locale } from "@locale";
import type { WineDistribution } from "@wine";
import { AppModal, AppModalButton } from "../components/app-modal";
import { AppSelect } from "../components/app-select";

/**
 * The Wine the launcher selected is gone (a system Wine was uninstalled, or the
 * channel's tag no longer matches the shipped list). Silently reinstalling
 * would throw away a working distribution that is already on disk, so the user
 * picks: reuse one of those, download the built-in Wine, or cancel.
 */
export function WineMissingModal(props: {
  locale: Locale;
  /** The distribution whose files are gone. */
  missing: string;
  /** Distributions that are installed and can be used right away. */
  installed: WineDistribution[];
  onUseInstalled: (distro: WineDistribution) => void;
  onDownloadBuiltin: () => void;
  onCancel: () => void;
}) {
  const { locale } = props;
  const [selectedId, setSelectedId] = createSignal(
    props.installed[0]?.id ?? ""
  );
  const selected = () =>
    props.installed.find(distro => distro.id === selectedId()) ??
    props.installed[0];

  return (
    <AppModal
      opened
      onClose={props.onCancel}
      title={locale.get("WINE_MISSING_TITLE")}
      maxWidth={560}
      footer={
        <>
          <AppModalButton onClick={props.onCancel}>
            {locale.get("SETTING_CANCEL")}
          </AppModalButton>
          <AppModalButton onClick={props.onDownloadBuiltin}>
            {locale.get("WINE_MISSING_DOWNLOAD")}
          </AppModalButton>
          <AppModalButton
            variant="primary"
            disabled={!selected()}
            onClick={() => {
              const distro = selected();
              if (distro) props.onUseInstalled(distro);
            }}
          >
            {locale.format("WINE_MISSING_USE", [selected()?.displayName ?? ""])}
          </AppModalButton>
        </>
      }
    >
      <div class="app-modal-message">
        {locale.format("WINE_MISSING_DESC", [props.missing])}
      </div>
      {props.installed.length > 1 ? (
        <>
          <label for="wine-missing-distro">
            {locale.get("INIT_ENVIRONMENT_WINE_VERSION")}
          </label>
          <AppSelect
            id="wine-missing-distro"
            value={selectedId()}
            onChange={setSelectedId}
            options={props.installed.map(distro => ({
              value: distro.id,
              label: distro.displayName,
            }))}
          />
        </>
      ) : null}
    </AppModal>
  );
}
