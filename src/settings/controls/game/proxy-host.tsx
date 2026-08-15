import { Box, Input, InputGroup, Text } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { Config, NOOP } from "../../../config/config-def";
import { assertValueDefined } from "../../../runtime/assertions";
import { configEntries, type ConfigStore } from "@config";

declare module "../../../config/config-def" {
  interface Config {
    proxyHost: string;
  }
}

export async function createProxyHostConfig({
  config,
  locale,
  store,
}: {
  config: Partial<Config>;
  locale: Locale;
  store: ConfigStore;
}) {
  try {
    config.proxyHost =
      (await store.read(configEntries.proxyHost)) ?? "127.0.0.1:8080";
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
    await store.write(configEntries.proxyHost, config.proxyHost);
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
            <Input
              value={value()}
              placeholder="127.0.0.1:8080"
              onChange={e => setValue(e.target.value)}
            />
          </InputGroup>
          <Text userSelect={"none"} size="xs" mt={"$1"}>
            {locale.get("SETTING_PROXY_DESC")}
          </Text>
        </Box>
      );
    },
  ] as const;
}
