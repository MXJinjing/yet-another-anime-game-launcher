import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  TabPanel,
  Text,
  VStack,
} from "@hope-ui/solid";
import { For, Show } from "solid-js";
import { Locale } from "../../locale";
import { exec2 } from "../../utils";
import { Wine } from "../../wine";

export function GameWineTab(props: {
  locale: Locale;
  wine: Wine;
  wineInstalled: () => boolean;
  winePrefix: string;
  wineTag?: () => string;
  wineOptions?: { tag: string; displayName: string }[];
  onWineTagChange?: (tag: string) => void;
  onResetWineEnv: () => Promise<void>;
  wineActionDisabled: () => boolean;
}) {
  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <VStack spacing={"$6"} w="100%" alignItems="stretch">
        <Show
          when={props.wineTag && props.wineOptions && props.onWineTagChange}
        >
          <label class="hoyoplay-setting-row">
            <span>{props.locale.get("SETTING_GAME_WINE")}</span>
            <select
              value={props.wineTag?.() ?? ""}
              onInput={event =>
                props.onWineTagChange?.(event.currentTarget.value)
              }
            >
              <For each={props.wineOptions ?? []}>
                {item => (
                  <option value={item.tag}>
                    {item.tag === "__shared__"
                      ? props.locale.get("SETTING_GAME_WINE_SHARED")
                      : item.displayName}
                  </option>
                )}
              </For>
            </select>
          </label>
          <p class="hoyoplay-settings-muted">
            {props.locale.get("SETTING_GAME_WINE_DESC")}
          </p>
        </Show>
        <Show when={props.wineTag && props.wineTag() !== "__shared__"}>
          <FormControl>
            <FormLabel>{props.locale.get("SETTING_WINE_VERSION")}</FormLabel>
            <Text userSelect={"none"}>
              {props.wineOptions?.find(item => item.tag === props.wineTag?.())
                ?.displayName ?? ""}
            </Text>
          </FormControl>
          <FormControl>
            <FormLabel>
              {props.locale.get("SETTING_WINE_PREFIX_PATH")}
            </FormLabel>
            <HStack spacing={"$2"} alignItems="center" w="100%">
              <Input disabled readOnly value={props.winePrefix} flex={1} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  exec2(["open", props.winePrefix], {}, false, "/dev/null")
                }
              >
                {props.locale.get("SETTING_OPEN")}
              </Button>
            </HStack>
            <HStack spacing={"$2"} mt="$2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!props.wineInstalled()}
                onClick={() =>
                  props.wine.openCmdWindow({
                    gameDir: props.winePrefix,
                  })
                }
              >
                {props.locale.get("SETTING_OPEN_WINE_CMD")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!props.wineInstalled()}
                onClick={() => props.wine.exec2("winecfg", [], {}, "/dev/null")}
              >
                {props.locale.get("SETTING_OPEN_WINECFG")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                colorScheme="danger"
                disabled={!props.wineInstalled() || props.wineActionDisabled()}
                onClick={() => props.onResetWineEnv()}
              >
                {props.locale.get("SETTING_RESET_WINE_ENV")}
              </Button>
            </HStack>
          </FormControl>
        </Show>
      </VStack>
    </TabPanel>
  );
}
