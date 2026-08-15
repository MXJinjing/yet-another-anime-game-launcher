import { Show } from "solid-js";
import type { JSXElement } from "solid-js";
import { AppModal } from "../components/app-modal";
import { LicenseModal } from "./license-modal";
import { Locale } from "../locale";
import { AboutLicenseLink, AboutModalContent } from "./about-modal";

export type GlobalModalRoute = "settings" | "about" | "license";

/**
 * Shared modal shell for the launcher-wide Settings / About / License pages.
 * All three are hosted by a single persistent `AppModal`, so the overlay
 * (backdrop) stays mounted when navigating from one page to another (e.g.
 * Settings -> License); only the body content swaps.
 */
export function GlobalModals(props: {
  route: () => GlobalModalRoute | null;
  onRouteChange: (route: GlobalModalRoute | null) => void;
  settingsUI: (props: {
    opened: boolean;
    onClose: (action: "check-integrity" | "close") => void;
    onOpenLogs: () => void;
    actionDisabled: () => boolean;
    onOpenAbout?: () => void;
    onOpenLicense?: () => void;
    onOpenGlobalSettings?: () => void;
    contentOnly?: boolean;
  }) => JSXElement;
  onOpenLogs: () => void;
  actionDisabled: () => boolean;
  locale: Locale;
  channelCode: string;
  onCheckUpdate: () => void;
}) {
  const route = () => props.route();
  const title = () => {
    const r = route();
    if (r === "settings") return props.locale.get("SETTING_GLOBAL");
    if (r === "about") {
      return props.locale.currentLanguage.startsWith("zh")
        ? "关于 Yaaglm"
        : "About Yaaglm";
    }
    return props.locale.get("SETTING_LICENSES");
  };
  const width = () => (route() === "about" ? 600 : 800);
  // Keep both route heights numeric so the shared modal can interpolate them
  // when switching between About and the larger Settings/License pages.
  const height = () => (route() === "about" ? 500 : 600);
  const bodyClass = () =>
    route() === "about" ? "app-modal-body-about" : "app-modal-body-settings";

  return (
    <AppModal
      opened={route() != null}
      onClose={() => props.onRouteChange(null)}
      title={title()}
      maxWidth={width()}
      height={height()}
      bodyClass={bodyClass()}
      contentClass="global-modal-content"
      footer={
        route() === "about" ? (
          <AboutLicenseLink onClick={() => props.onRouteChange("license")} />
        ) : undefined
      }
    >
      <Show when={route() === "settings"}>
        {(() => {
          const SettingsUI = props.settingsUI;
          return (
            <SettingsUI
              contentOnly
              opened
              onClose={() => undefined}
              onOpenLogs={props.onOpenLogs}
              actionDisabled={props.actionDisabled}
              onOpenAbout={() => props.onRouteChange("about")}
              onOpenLicense={() => props.onRouteChange("license")}
            />
          );
        })()}
      </Show>
      <Show when={route() === "about"}>
        <AboutModalContent
          locale={props.locale}
          channelCode={props.channelCode}
          onCheckUpdate={props.onCheckUpdate}
        />
      </Show>
      <Show when={route() === "license"}>
        <LicenseModal locale={props.locale} />
      </Show>
    </AppModal>
  );
}
