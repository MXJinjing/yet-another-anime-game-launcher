import { notificationService } from "@hope-ui/solid";

export function notifyMiyoushe(
  status: "info" | "success" | "warning" | "danger",
  title: string,
  description?: string
) {
  notificationService.show({ status, title, description });
}

let progressId = 0;

export function miyousheProgress(title: string) {
  const id = `miyoushe-progress-${++progressId}`;
  let shown = false;
  return {
    update(description: string) {
      if (shown) notificationService.update({ id, description });
      else {
        shown = true;
        notificationService.show({
          id,
          title,
          description,
          loading: true,
          persistent: true,
        });
      }
    },
    close() {
      if (shown) {
        shown = false;
        notificationService.hide(id);
      }
    },
  };
}
