import { notificationService } from "@hope-ui/solid";
import type { Locale, LocaleTextKey } from "@locale";

/**
 * Notification boundary for task execution. Consumers can provide a notifier
 * backed by another UI without coupling the runner to Hope UI.
 */
export interface TaskNotifier {
  taskCompleted(locale: Locale, taskName: LocaleTextKey): void;
  taskCancelled(locale: Locale, taskName: LocaleTextKey): void;
  taskFailed(
    locale: Locale,
    taskName?: LocaleTextKey,
    error?: unknown,
    taskKey?: string
  ): void;
  connectionError(locale: Locale, taskName?: LocaleTextKey): void;
}

export const hopeTaskNotifier: TaskNotifier = {
  taskCompleted(locale, taskName) {
    notificationService.show({
      status: "success",
      title: locale.get(taskName),
      description: locale.get("NOTIFICATION_TASK_COMPLETED"),
    });
  },
  taskCancelled(locale, taskName) {
    notificationService.show({
      status: "warning",
      title: locale.get(taskName),
      description: locale.get("NOTIFICATION_TASK_CANCELLED"),
    });
  },
  taskFailed(locale, taskName, error) {
    notificationService.show({
      status: "danger",
      title: taskName
        ? locale.get(taskName)
        : locale.get("NOTIFICATION_TASK_FAILED_TITLE"),
      description:
        error instanceof Error && error.message
          ? error.message
          : locale.get("NOTIFICATION_TASK_FAILED"),
    });
  },
  connectionError(locale, taskName) {
    notificationService.show({
      status: "danger",
      title: taskName
        ? locale.get(taskName)
        : locale.get("CHECK_GAME_UPDATE_FAILED"),
      description: locale.get("CHECK_GAME_UPDATE_FAILED_DESC"),
    });
  },
};

export function notifyTaskCompleted(locale: Locale, taskName: LocaleTextKey) {
  hopeTaskNotifier.taskCompleted(locale, taskName);
}

export function notifyTaskCancelled(locale: Locale, taskName: LocaleTextKey) {
  hopeTaskNotifier.taskCancelled(locale, taskName);
}

export function notifyTaskFailed(
  locale: Locale,
  taskName?: LocaleTextKey,
  error?: unknown
) {
  hopeTaskNotifier.taskFailed(locale, taskName, error);
}

export function notifyConnectionError(
  locale: Locale,
  taskName?: LocaleTextKey
) {
  hopeTaskNotifier.connectionError(locale, taskName);
}
