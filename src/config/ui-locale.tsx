import { Box, FormControl, FormLabel, HStack, Text } from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale, locales } from "@locale";
import { setKey } from "@utils";
import { AppSelect } from "../components/app-select";
import { Config } from "./config-def";

export default async function ({
  locale,
}: {
  config: Partial<Config>;
  locale: Locale;
}) {
  const [value, setValue] = createSignal(locale.currentLanguage);

  async function onSave(apply: boolean) {
    await setKey("config_uiLocale", value());
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      return [
        <Box>
          <FormControl id="uiLOCALE">
            <HStack w="100%" justifyContent="space-between" alignItems="center">
              <FormLabel mb={0}>{locale.get("SETTING_UI_LOCALE")}</FormLabel>
              <AppSelect
                value={value()}
                onChange={setValue}
                width={180}
                options={locale.supportedLanguages.map(item => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            </HStack>
          </FormControl>
          <Show when={locale.currentLanguage != value()}>
            <Text fontSize={11} color="$danger9" mt="$1" userSelect="none">
              {locale.get("SETTING_RESTART_TO_TAKE_EFFECT")}
            </Text>
            <Text fontSize={11} color="$danger9" mt="$1" userSelect="none">
              {
                (locales[value() as keyof typeof locales] ?? locales.en)[
                  "SETTING_RESTART_TO_TAKE_EFFECT"
                ]
              }
            </Text>
          </Show>
        </Box>,
      ];
    },
  ] as const;
}
