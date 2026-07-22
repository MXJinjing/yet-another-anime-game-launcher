import { FormControl, FormLabel, Box, Checkbox, Input } from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey } from "@utils";
import { Config, NOOP } from "@config/config-def";

declare module "@config/config-def" {
  interface Config {
    blockNet: boolean;
    blockNetDuration: number;
  }
}

const TOGGLE_KEY = "config_block_net";
const DURATION_KEY = "config_block_net_duration";

export default async function ({
  locale,
  config,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  let storedDuration = 10;
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
  config.blockNetDuration = storedDuration;

  const [on, setOn] = createSignal(config.blockNet);
  const [duration, setDuration] = createSignal(storedDuration);

  async function onSave(apply: boolean) {
    assertValueDefined(config.blockNet);
    assertValueDefined(config.blockNetDuration);
    if (!apply) {
      setOn(config.blockNet);
      setDuration(config.blockNetDuration);
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
    return NOOP;
  }

  createEffect(() => {
    on();
    duration();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl id="blockNet">
          <FormLabel>{locale.get("SETTING_BLOCK_NET")}</FormLabel>
          <Box mt={"$1"}>
            <Checkbox checked={on()} onChange={() => setOn(x => !x)} size="md">
              {locale.get("SETTING_ENABLED")}
            </Checkbox>
          </Box>
          <Show when={on()}>
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
        </FormControl>
      );
    },
  ] as const;
}
