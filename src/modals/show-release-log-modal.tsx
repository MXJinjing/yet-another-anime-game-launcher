import { createSignal, onMount, Show } from "solid-js";
import { CURRENT_YAAGL_VERSION } from "../constants";
import {
  createGithubEndpoint,
  type GithubReleaseInfo,
} from "../integrations/github";
import { log } from "../logging/logger";
import type { Locale } from "../locale";
import { DEV_RELEASE_LOG } from "../update/dev-mock";
import { renderMarkdownHtml } from "./markdown";
import "./show-release-log-modal.css";
import "./modal-markdown.css";

const GITHUB_OWNER = "MXJinjing";
const GITHUB_REPO = "yet-another-anime-game-launcher";

/**
 * Shows the release notes of the currently installed version (not the latest
 * one). Hosted as a route of the global modal shell, next to About / License.
 * The release body is fetched from the GitHub release tagged with the current
 * version and rendered as markdown. The back button lives in the modal title
 * bar (see global-modal-host), not in this body.
 */
export function ShowReleaseLogModal(props: { locale: Locale }) {
  const [releaseBody, setReleaseBody] = createSignal("");
  const [loadError, setLoadError] = createSignal("");

  onMount(() => {
    void (async () => {
      if (CURRENT_YAAGL_VERSION === "development") {
        // Development builds: show fixed content for UI testing, no network.
        setReleaseBody(DEV_RELEASE_LOG);
        return;
      }
      try {
        const github = await createGithubEndpoint();
        const release = (await github.api(
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${CURRENT_YAAGL_VERSION}`
        )) as GithubReleaseInfo;
        setReleaseBody(release.body ?? "");
      } catch (error) {
        await log(`Failed to load release log: ${String(error)}`);
        setLoadError(
          props.locale.currentLanguage.startsWith("zh")
            ? "无法获取更新日志"
            : "Unable to load release notes"
        );
      }
    })();
  });

  return (
    <div class="release-log">
      <div class="release-log-meta">
        {props.locale.currentLanguage.startsWith("zh") ? "更新日志" : "Release notes"} · v
        {CURRENT_YAAGL_VERSION}
        {CURRENT_YAAGL_VERSION === "development" ? "（开发版 · 展示最新版本）" : ""}
      </div>
      <Show
        when={!loadError()}
        fallback={<p class="release-log-status release-log-error">{loadError()}</p>}
      >
        <Show
          when={releaseBody()}
          fallback={<p class="release-log-status">{props.locale.get("PROCESSING")}</p>}
        >
          <div
            class="release-log-changelog modal-markdown"
            innerHTML={renderMarkdownHtml(releaseBody())}
          />
        </Show>
      </Show>
    </div>
  );
}
