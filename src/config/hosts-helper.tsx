import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  Text,
  VStack,
} from "@hope-ui/solid";
import { createSignal, onMount, Show } from "solid-js";
import { Locale } from "@locale";
import {
  getPrivilegedHostsHelperStatus,
  installPrivilegedHostsHelper,
  PrivilegedHostsHelperStatus,
  uninstallPrivilegedHostsHelper,
} from "../privileged-hosts";

export async function checkHostsHelperInstalled(locale: Locale) {
  const status = await getPrivilegedHostsHelperStatus();
  if (status == "not-installed" || status == "error") {
    locale.alert(
      "SETTING_HOSTS_HELPER",
      status == "not-installed"
        ? "SETTING_HOSTS_HELPER_STATUS_NOT_INSTALLED"
        : "SETTING_HOSTS_HELPER_STATUS_ERROR",
      [],
      "warning"
    );
  }
}

function statusKey(status: PrivilegedHostsHelperStatus) {
  switch (status) {
    case "running":
      return "SETTING_HOSTS_HELPER_STATUS_RUNNING";
    case "installed-stopped":
      return "SETTING_HOSTS_HELPER_STATUS_STOPPED";
    case "not-installed":
      return "SETTING_HOSTS_HELPER_STATUS_NOT_INSTALLED";
    default:
      return "SETTING_HOSTS_HELPER_STATUS_ERROR";
  }
}

export function HostsHelperControl(props: { locale: Locale }) {
  const [status, setStatus] =
    createSignal<PrivilegedHostsHelperStatus>("not-installed");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  async function refresh() {
    setError("");
    setStatus(await getPrivilegedHostsHelperStatus());
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  onMount(() => {
    refresh();
  });

  return (
    <FormControl class="hosts-helper-control" w="100%">
      <HStack w="100%" justifyContent="space-between" alignItems="center">
        <VStack spacing={"$1"} alignItems="start">
          <FormLabel mb={0}>
            {props.locale.get("SETTING_HOSTS_HELPER")}
          </FormLabel>
          <Text size="xs" color="$neutral11" userSelect="none">
            {props.locale.get(statusKey(status()))}
          </Text>
        </VStack>
        <HStack spacing={"$2"}>
          <Show when={status() != "running" && status() != "installed-stopped"}>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy()}
              onClick={() => run(installPrivilegedHostsHelper)}
            >
              {props.locale.get("SETTING_HOSTS_HELPER_INSTALL")}
            </Button>
          </Show>
          <Show when={status() != "not-installed"}>
            <Button
              size="xs"
              variant="ghost"
              colorScheme="danger"
              disabled={busy()}
              onClick={() => run(uninstallPrivilegedHostsHelper)}
            >
              {props.locale.get("SETTING_HOSTS_HELPER_UNINSTALL")}
            </Button>
          </Show>
          <Button size="xs" variant="ghost" disabled={busy()} onClick={refresh}>
            {props.locale.get("SETTING_HOSTS_HELPER_REFRESH")}
          </Button>
        </HStack>
      </HStack>
      <Text
        size="xs"
        color="$danger10"
        userSelect="text"
        style={{ display: error() ? "block" : "none" }}
      >
        {error()}
      </Text>
    </FormControl>
  );
}
