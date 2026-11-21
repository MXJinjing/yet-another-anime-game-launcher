import { notificationService } from "@hope-ui/solid";
import { log } from "@logging/logger";
import type { Locale, LocaleTextKey } from "@locale";

/**
 * Report an unexpected launcher-action failure without terminating the
 * process. Recoverable actions stay in the launcher; the user just gets a
 * notification and can retry.
 */
export async function reportActionFailure(
  locale: Locale,
  titleKey: LocaleTextKey,
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);
  await log(`Launcher action failed (${titleKey}): ${message}`);
  notificationService.show({
    status: "danger",
    title: locale.get(titleKey),
    description: message || locale.get("NOTIFICATION_TASK_FAILED"),
  });
}
