import { Box, Button, HStack, Text, VStack } from "@hope-ui/solid";
import { createSignal, onMount } from "solid-js";
import { Locale } from "@locale";
import {
  getPrivilegedHostsHelperStatus,
  installPrivilegedHostsHelper,
  PrivilegedHostsHelperStatus,
  uninstallPrivilegedHostsHelper,
} from "../privileged-hosts";

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
    <VStack spacing={"$2"} alignItems="start" mt={"$2"} w="100%">
      <Box>
        <Text size="xs" color="$neutral11" userSelect="none">
          {props.locale.get("SETTING_HOSTS_HELPER")}
        </Text>
        <Text size="xs" color="$neutral11" userSelect="none">
          {props.locale.get(statusKey(status()))}
        </Text>
      </Box>
      <HStack spacing={"$2"}>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy() || status() == "running"}
          onClick={() => run(installPrivilegedHostsHelper)}
        >
          {props.locale.get("SETTING_HOSTS_HELPER_INSTALL")}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          colorScheme="danger"
          disabled={busy() || status() == "not-installed"}
          onClick={() => run(uninstallPrivilegedHostsHelper)}
        >
          {props.locale.get("SETTING_HOSTS_HELPER_UNINSTALL")}
        </Button>
        <Button size="xs" variant="ghost" disabled={busy()} onClick={refresh}>
          {props.locale.get("SETTING_HOSTS_HELPER_REFRESH")}
        </Button>
      </HStack>
      <Text
        size="xs"
        color="$danger10"
        userSelect="text"
        style={{ display: error() ? "block" : "none" }}
      >
        {error()}
      </Text>
    </VStack>
  );
}
