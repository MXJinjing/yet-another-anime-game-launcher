import { Locale } from "@locale";
import { getPrivilegedHostsHelperStatus } from "./privileged-hosts";

export async function checkHostsHelperInstalled(locale: Locale) {
  const status = await getPrivilegedHostsHelperStatus();
  if (status == "not-installed" || status == "error") {
    await locale.alert(
      "SETTING_HOSTS_HELPER",
      status == "not-installed"
        ? "SETTING_HOSTS_HELPER_STATUS_NOT_INSTALLED"
        : "SETTING_HOSTS_HELPER_STATUS_ERROR",
      [],
      "warning"
    );
  }
}
