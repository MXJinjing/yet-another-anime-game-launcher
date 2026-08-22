import { Show } from "solid-js";
import type { JSXElement } from "solid-js";
import { AppModal } from "../components/app-modal";
import { LicenseModal } from "./license-modal";
import { Locale } from "../locale";
import {
  AboutLicenseLink,
  AboutModalContent,
  AboutReleaseLogLink,
} from "./about-modal";
import { ShowReleaseLogModal } from "./show-release-log-modal";

export type GlobalModalRoute = "settings" | "about" | "license" | "release-log";

/**
 * Shared modal shell for the launcher-wide Settings / About / License /
 * Release-log pages. All of them are hosted by a single persistent `AppModal`,
 * so the overlay (backdrop) stays mounted when navigating from one page to
 * another (e.g. Settings -> License); only the body content swaps.
 *
 * Sub-pages (About / License / Release log) get a back button in the left
 * side of the title bar. About always returns to Global Settings; License and
 * Release log return to the page they were opened from.
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
  // Remember which page each sub-page was opened from, so the back button
  // returns to the real parent. About is handled as a fixed return to Settings
  // below; License and Release log can be entered from Settings or About.
  let previousRoute: GlobalModalRoute | null = null;
  const navigate = (next: GlobalModalRoute | null) => {
    if (next != null) {
      const current = route();
      if (current != null && current !== next) {
        previousRoute = current;
      }
    }
    props.onRouteChange(next);
  };
  const backTarget = (): GlobalModalRoute | null => {
    const r = route();
    if (r === "settings") return null;
    if (r === "about") return "settings";
    return previousRoute ?? "about";
  };
  const routeTitle = () => {
    const r = route();
    if (r === "settings") return props.locale.get("SETTING_GLOBAL");
    if (r === "about") {
      return props.locale.currentLanguage.startsWith("zh")
        ? "关于 Yaaglm"
        : "About Yaaglm";
    }
    if (r === "release-log") {
      return props.locale.currentLanguage.startsWith("zh")
        ? "更新日志"
        : "Update Log";
    }
    return props.locale.get("SETTING_LICENSES");
  };
  // The back button lives in the title bar (left of the title), so all
  // sub-pages share the same navigation chrome regardless of their body.
  const title = () => {
    const target = backTarget();
    if (!target) return routeTitle();
    return (
      <div class="global-modal-title-row">
        <button
          type="button"
          class="global-modal-back"
          aria-label={
            props.locale.currentLanguage.startsWith("zh") ? "返回" : "Back"
          }
          onClick={() => navigate(target)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span>{routeTitle()}</span>
      </div>
    );
  };
  // The release-log page shares About's size.
  const width = () =>
    route() === "about" || route() === "release-log" ? 600 : 800;
  // Keep route heights numeric so the shared modal can interpolate them when
  // switching between About and the larger Settings/License pages.
  const height = () =>
    route() === "about" || route() === "release-log" ? 500 : 600;
  const bodyClass = () =>
    route() === "about"
      ? "app-modal-body-about"
      : route() === "release-log"
      ? "app-modal-body-release-log"
      : "app-modal-body-settings";

  return (
    <AppModal
      opened={route() != null}
      onClose={() => navigate(null)}
      title={title()}
      maxWidth={width()}
      height={height()}
      bodyClass={bodyClass()}
      contentClass="global-modal-content"
      footer={
        route() === "about" ? (
          <>
            <AboutReleaseLogLink
              label={
                props.locale.currentLanguage.startsWith("zh")
                  ? "查看更新日志"
                  : "View Update Log"
              }
              onClick={() => navigate("release-log")}
            />
            <AboutLicenseLink onClick={() => navigate("license")} />
          </>
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
              onOpenAbout={() => navigate("about")}
              onOpenLicense={() => navigate("license")}
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
      <Show when={route() === "release-log"}>
        <ShowReleaseLogModal locale={props.locale} />
      </Show>
      <Show when={route() === "license"}>
        <LicenseModal locale={props.locale} />
      </Show>
    </AppModal>
  );
}
