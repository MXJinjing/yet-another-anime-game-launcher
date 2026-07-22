import { Box, Input, InputGroup, Text } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "../locale";
import { Config, NOOP } from "./config-def";
import { assertValueDefined, getKey, setKey } from "@utils";

declare module "./config-def" {
  interface Config {
    proxyHost: string;
  }
}

export async function createProxyHostConfig({
  config,
  locale,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  try {
    config.proxyHost = await getKey("config_proxyHost");
  } catch {
    config.proxyHost = "127.0.0.1:8080"; // default value
  }

  const [value, setValue] = createSignal(config.proxyHost);

  async function onSave(apply: boolean) {
    assertValueDefined(config.proxyHost);
    if (!apply) {
      setValue(config.proxyHost);
      return NOOP;
    }
    if (config.proxyHost == value()) return NOOP;
    config.proxyHost = value();
    await setKey("config_proxyHost", config.proxyHost);
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <Box mt={"$2"} w="100%">
          <InputGroup>
            <Input value={value()} onChange={e => setValue(e.target.value)} />
          </InputGroup>
          <Text userSelect={"none"} size="xs" mt={"$1"}>
            {locale.get("SETTING_PROXY_DESC")}
          </Text>
        </Box>
      );
    },
  ] as const;
}
