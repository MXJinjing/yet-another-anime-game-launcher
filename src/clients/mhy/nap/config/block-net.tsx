import { Box, Button, Text } from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined } from "@runtime/assertions";
import { globalStorage, type Storage } from "@runtime/storage";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";
import { getPrivilegedHostsHelperStatus } from "@system/privileged-hosts";
import type { PrivilegedHostsHelperStatus } from "@system/privileged-hosts";
import { BlockHostsTable } from "@settings/controls/launch/block-hosts-table";
import {
  parseBlockHostRulesText,
  serializeBlockHostRules,
  serializeEnabledBlockHostsText,
} from "@settings/controls/launch/block-hosts";
import type { BlockHostRule } from "@settings/controls/launch/block-hosts";

declare module "@config/config-def" {
  interface Config {
    blockNet: boolean;
    blockNetHostsText: string;
  }
}

const CONFIG_KEY = "config_block_net";
const HOSTS_KEY = "config_block_net_hosts";
const RULES_KEY = "config_block_net_rules";

export default async function ({
  locale,
  config,
  defaultHostsText,
  storage = globalStorage,
}: {
  config: Partial<Config>;
  locale: Locale;
  defaultHostsText: string;
  storage?: Storage;
}) {
  const { getKey, setKey } = storage;
  const defaultEntries = parseBlockHostRulesText(defaultHostsText);
  let storedHostsText = defaultHostsText;
  let storedRulesText = "";
  try {
    config.blockNet = (await getKey(CONFIG_KEY)) == "true";
  } catch {
    config.blockNet = false; // default value
  }
  try {
    storedHostsText = await getKey(HOSTS_KEY);
  } catch {
    storedHostsText = defaultHostsText;
  }
  try {
    storedRulesText = await getKey(RULES_KEY);
  } catch {
    storedRulesText = "";
  }
  let storedEntries: BlockHostRule[];
  try {
    storedEntries = parseBlockHostRulesText(storedRulesText || storedHostsText);
  } catch {
    storedEntries = defaultEntries.map(entry => ({ ...entry }));
  }
  storedRulesText = serializeBlockHostRules(storedEntries);
  storedHostsText = serializeEnabledBlockHostsText(storedEntries);

  config.blockNetHostsText = storedHostsText;

  const [value, setValue] = createSignal(config.blockNet);
  const [entries, setEntries] = createSignal(storedEntries);
  const [hostsHelperStatus, setHostsHelperStatus] =
    createSignal<PrivilegedHostsHelperStatus>();

  async function refreshHostsHelperStatus() {
    try {
      setHostsHelperStatus(await getPrivilegedHostsHelperStatus());
    } catch {
      setHostsHelperStatus("error");
    }
  }

  function restoreEntries(text: string): BlockHostRule[] {
    try {
      return parseBlockHostRulesText(text);
    } catch {
      return defaultEntries.map(entry => ({ ...entry }));
    }
  }

  async function onSave(apply: boolean) {
    assertValueDefined(config.blockNet);
    assertValueDefined(config.blockNetHostsText);
    if (!apply) {
      setValue(config.blockNet);
      setEntries(restoreEntries(storedRulesText));
      return NOOP;
    }
    if (config.blockNet != value()) {
      config.blockNet = value();
      await setKey(CONFIG_KEY, config.blockNet ? "true" : "false");
    }
    const nextRulesText = serializeBlockHostRules(entries());
    const nextHostsText = serializeEnabledBlockHostsText(entries());
    if (storedRulesText != nextRulesText) {
      storedRulesText = nextRulesText;
      await setKey(RULES_KEY, nextRulesText);
    }
    if (config.blockNetHostsText != nextHostsText) {
      config.blockNetHostsText = nextHostsText;
      await setKey(HOSTS_KEY, nextHostsText);
    }
    return NOOP;
  }

  createEffect(() => {
    value();
    entries();
    void onSave(true);
  });

  createEffect(() => {
    if (value()) {
      void refreshHostsHelperStatus();
    } else {
      setHostsHelperStatus(undefined);
    }
  });

  return [
    function UI(props?: { onOpenGlobalSettings?: () => void }) {
      const description = locale.currentLanguage.startsWith("zh")
        ? "临时写入 hosts 屏蔽指定域名，游戏结束后自动还原。"
        : "Temporarily block domains via hosts and restore after the game exits.";
      return (
        <SettingSwitch
          id="blockNet"
          label={locale.get("SETTING_BLOCK_NET")}
          description={description}
          checked={value()}
          onChange={next => {
            setValue(next);
          }}
        >
          <Show when={value() && hostsHelperStatus() === "not-installed"}>
            <Box
              mt="$2"
              display="flex"
              alignItems="center"
              flexWrap="wrap"
              gap="$1"
            >
              <Text size="xs" color="$warning10" userSelect="none">
                {locale.currentLanguage.startsWith("zh")
                  ? "hosts权限助手未安装，每次启动需要输入密码，"
                  : "The hosts permission helper is not installed; a password will be required on every launch."}
              </Text>
              <Show when={props?.onOpenGlobalSettings}>
                <Button
                  size="xs"
                  variant="ghost"
                  colorScheme="warning"
                  onClick={() => props?.onOpenGlobalSettings?.()}
                >
                  {locale.currentLanguage.startsWith("zh")
                    ? "点击前往全局设置"
                    : "Go to Global Settings"}
                </Button>
              </Show>
            </Box>
          </Show>
          <Show when={value()}>
            <Box mt="$2">
              <BlockHostsTable
                locale={locale}
                entries={entries}
                onEntriesChange={nextEntries => setEntries(nextEntries)}
                onReset={() =>
                  setEntries(defaultEntries.map(entry => ({ ...entry })))
                }
              />
            </Box>
          </Show>
        </SettingSwitch>
      );
    },
  ] as const;
}
