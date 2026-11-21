import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Locale } from "../locale";
import {
  dismissStartupNotice,
  getStartupNotices,
  subscribeStartupNotices,
} from "../runtime/startup-notices";
import { startupNoticeMessage } from "./startup-notice-messages";
import "./startup-notice-banner.css";

/**
 * Dismissible banner for non-fatal boot degradations. It sits above the main
 * launcher UI so the reduced feature set is explained without blocking use.
 */
export function StartupNoticeBanner(props: { locale: Locale }) {
  const [notices, setNotices] = createSignal(getStartupNotices());

  onMount(() => {
    const unsubscribe = subscribeStartupNotices(() =>
      setNotices(getStartupNotices())
    );
    // Pick up notices pushed between module init and this component mounting.
    setNotices(getStartupNotices());
    onCleanup(unsubscribe);
  });

  const isChinese = () => props.locale.currentLanguage.startsWith("zh");

  return (
    <Show when={notices().length > 0}>
      <div class="startup-notice-stack" role="status" aria-live="polite">
        <For each={notices()}>
          {notice => (
            <div class="startup-notice">
              <span class="startup-notice-mark" aria-hidden="true">
                !
              </span>
              <div class="startup-notice-body">
                <div class="startup-notice-message">
                  {startupNoticeMessage(
                    notice.id,
                    props.locale.currentLanguage
                  )}
                </div>
                <Show when={notice.detail}>
                  <div class="startup-notice-detail">{notice.detail}</div>
                </Show>
              </div>
              <button
                class="startup-notice-dismiss"
                type="button"
                aria-label={isChinese() ? "关闭提示" : "Dismiss notice"}
                onClick={() => dismissStartupNotice(notice.id)}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
