import { Box, Button, HStack, Input, Textarea } from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";
import { SettingSwitch } from "../../../../components/setting-switch";
import { checkHostsHelperInstalled } from "@config/hosts-helper";

declare module "@config/config-def" {
  interface Config {
    blockNet: boolean;
    blockNetDuration: number;
    blockNetHostsText: string;
  }
}

const TOGGLE_KEY = "config_block_net";
const DURATION_KEY = "config_block_net_duration";
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
  let storedDuration = 10;
  let storedHostsText = defaultHostsText;
  try {
    config.blockNet = (await getKey(TOGGLE_KEY)) == "true";
  } catch {
    config.blockNet = false;
  }
  try {
    storedDuration = Number(await getKey(DURATION_KEY));
    if (isNaN(storedDuration) || storedDuration < 5 || storedDuration > 60) {
      storedDuration = 10;
    }
  } catch {
    storedDuration = 10;
  }
  try {
    storedHostsText = await getKey(HOSTS_KEY);
  } catch {
    storedHostsText = defaultHostsText;
  }
  config.blockNetDuration = storedDuration;
  config.blockNetHostsText = storedHostsText;

  const [on, setOn] = createSignal(config.blockNet);
  const [duration, setDuration] = createSignal(storedDuration);
  const [hostsText, setHostsText] = createSignal(storedHostsText);

  async function onSave(apply: boolean) {
    assertValueDefined(config.blockNet);
    assertValueDefined(config.blockNetDuration);
    assertValueDefined(config.blockNetHostsText);
    if (!apply) {
      setOn(config.blockNet);
      setDuration(config.blockNetDuration);
      setHostsText(config.blockNetHostsText);
      return NOOP;
    }
    if (config.blockNet != on()) {
      config.blockNet = on();
      await setKey(TOGGLE_KEY, on() ? "true" : "false");
    }
    if (config.blockNetDuration != duration()) {
      config.blockNetDuration = duration();
      await setKey(DURATION_KEY, String(duration()));
    }
    if (config.blockNetHostsText != hostsText()) {
      config.blockNetHostsText = hostsText();
      await setKey(HOSTS_KEY, hostsText());
    }
    return NOOP;
  }

  createEffect(() => {
    on();
    duration();
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
          checked={on()}
          onChange={next => {
            setOn(next);
            if (next) void checkHostsHelperInstalled(locale);
          }}
          control={
            <Show when={on()}>
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
          <Show when={on()}>
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
            <Box mt={"$2"}>
              <Box mb={"$1"}>
                <span style="font-size:12px;color:#aaa">
                  {locale.get("SETTING_BLOCK_NET_DURATION")}
                </span>
              </Box>
              <Box display="flex" alignItems="center" gap={"$2"}>
                <Input
                  type="number"
                  value={String(duration())}
                  min={5}
                  max={60}
                  width="60px"
                  size="sm"
                  onChange={e => {
                    const v = Number(e.currentTarget.value);
                    if (!isNaN(v)) setDuration(Math.max(5, Math.min(60, v)));
                  }}
                />
                <span style="font-size:12px;color:#aaa">s</span>
              </Box>
            </Box>
          </Show>
        </SettingSwitch>
      );
    },
  ] as const;
}
