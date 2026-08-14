import { Box, Button, HStack, Textarea } from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";
import { checkHostsHelperInstalled } from "@config/hosts-helper";

declare module "@config/config-def" {
  interface Config {
    blockNet: boolean;
    blockNetHostsText: string;
  }
}

const CONFIG_KEY = "config_block_net";
const HOSTS_KEY = "config_block_net_hosts";

export default async function ({
  locale,
  config,
  defaultHostsText,
}: {
  config: Partial<Config>;
  locale: Locale;
  defaultHostsText: string;
}) {
  let storedHostsText = defaultHostsText;
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
  config.blockNetHostsText = storedHostsText;

  const [value, setValue] = createSignal(config.blockNet);
  const [hostsText, setHostsText] = createSignal(storedHostsText);

  async function onSave(apply: boolean) {
    assertValueDefined(config.blockNet);
    assertValueDefined(config.blockNetHostsText);
    if (!apply) {
      setValue(config.blockNet);
      setHostsText(config.blockNetHostsText);
      return NOOP;
    }
    if (config.blockNet != value()) {
      config.blockNet = value();
      await setKey(CONFIG_KEY, config.blockNet ? "true" : "false");
    }
    if (config.blockNetHostsText != hostsText()) {
      config.blockNetHostsText = hostsText();
      await setKey(HOSTS_KEY, hostsText());
    }
    return NOOP;
  }

  createEffect(() => {
    value();
    hostsText();
    onSave(true);
  });

  return [
    function UI() {
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
            if (next) void checkHostsHelperInstalled(locale);
          }}
          control={
            <Show when={value()}>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setHostsText(defaultHostsText)}
              >
                {locale.get("SETTING_PREFERRED_MAX_FPS_RESET")}
              </Button>
            </Show>
          }
        >
          <Show when={value()}>
            <Box mt="$2">
              <Textarea
                value={hostsText()}
                rows={4}
                size="sm"
                style={{ "font-family": "monospace", resize: "vertical" }}
                placeholder="example.com 0.0.0.0"
                onChange={e => setHostsText(e.currentTarget.value)}
              />
            </Box>
          </Show>
        </SettingSwitch>
      );
    },
  ] as const;
}
