import { Show } from "solid-js";
import { CURRENT_YAAGL_VERSION } from "../constants";
import { UPDATE_UI_IMAGE } from "../clients";
import { Locale } from "../locale";
import { open } from "../platform/neutralino";
import "./about-modal.css";

const GITHUB_REPO_URL =
  "https://github.com/MXJinjing/yet-another-anime-game-launcher";

/** Body content of the About page, hosted by the shared global modal shell. */
export function AboutModalContent(props: {
  locale: Locale;
  channelCode: string;
  onCheckUpdate?: () => void;
}) {
  return (
    <div class="about-content">
      <img class="about-icon" src={UPDATE_UI_IMAGE} alt="" />
      <div class="about-name">Yaaglm {props.channelCode}</div>
      <div class="about-version-row">
        <div class="about-detail">Version {CURRENT_YAAGL_VERSION}</div>
        <Show when={props.onCheckUpdate}>
          <button
            type="button"
            class="about-check-update"
            onClick={() => props.onCheckUpdate?.()}
          >
            {props.locale.get("SETTING_CHECK_UPDATE")}
          </button>
        </Show>
      </div>
      <div class="about-detail">Author: MXJinjing & 3Shain</div>
      <button
        class="about-github"
        aria-label="GitHub"
        title="GitHub"
        onClick={() => void open(GITHUB_REPO_URL)}
      >
        <span class="about-github-icon" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Footer link used to jump from the About page to the Release-log page. */
export function AboutReleaseLogLink(props: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      class="about-license-link about-footer-link-left"
      type="button"
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

/** Footer link used to jump from the About page to the License page. */
export function AboutLicenseLink(props: { onClick: () => void }) {
  return (
    <button class="about-license-link" type="button" onClick={props.onClick}>
      LICENSE
    </button>
  );
}
