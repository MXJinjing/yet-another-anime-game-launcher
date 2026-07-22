import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  Input,
  Text,
} from "@hope-ui/solid";
import { createEffect, createSignal, Show } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey, log } from "@utils";
import { Config, NOOP } from "@config/config-def";
import { revertMhypBaseReplacement } from "../../../mhy/patch";

declare module "@config/config-def" {
  interface Config {
    mhypBaseReplacementPath: string;
    workaround4: boolean;
  }
}

const PATH_KEY = "config_mhypbase_replacement_path";
const TOGGLE_KEY = "config_workaround4";

export default async function ({
  locale,
  config,
  gameInstallDir,
}: {
  locale: Locale;
  config: Partial<Config>;
  gameInstallDir?: () => string;
}) {
  let storedPath = "";
  let storedToggle = false;
  try {
    storedPath = await getKey(PATH_KEY);
  } catch {
    storedPath = "";
  }
  try {
    storedToggle = (await getKey(TOGGLE_KEY)) == "true";
  } catch {
    storedToggle = false;
  }
  config.mhypBaseReplacementPath = storedPath;
  config.workaround4 = storedToggle;

  const [pathValue, setPathValue] = createSignal(storedPath);
  const [enabled, setEnabled] = createSignal(storedToggle);

  async function onSave(apply: boolean) {
    assertValueDefined(config.mhypBaseReplacementPath);
    assertValueDefined(config.workaround4);
    const v = pathValue().trim();
    const e = enabled();
    if (!apply) {
      setPathValue(config.mhypBaseReplacementPath);
      setEnabled(config.workaround4);
      return NOOP;
    }
    if (config.mhypBaseReplacementPath !== v) {
      config.mhypBaseReplacementPath = v;
      await setKey(PATH_KEY, v);
    }
    if (config.workaround4 !== e) {
      config.workaround4 = e;
      await setKey(TOGGLE_KEY, e ? "true" : "false");
    }
    return NOOP;
  }

  createEffect(() => {
    pathValue();
    enabled();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl id="workaround4">
          <FormLabel>{locale.get("SETTING_WORKAROUND4")}</FormLabel>
          <Text userSelect={"none"} size="xs" mb={"$2"}>
            {locale.get("SETTING_WORKAROUND4_DESC")}
          </Text>
          <Box mb={"$2"}>
            <Checkbox
              checked={enabled()}
              onChange={() => setEnabled(x => !x)}
              size="md"
            >
              {locale.get("SETTING_ENABLED")}
            </Checkbox>
          </Box>
          <Show when={enabled()}>
            <Input
              value={pathValue()}
              placeholder="/Users/you/Downloads/old_mhypbase.dll"
              onChange={e => setPathValue(e.currentTarget.value)}
              size="sm"
            />
            <Box mt={"$2"}>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const picked = await Neutralino.os.showOpenDialog(
                    locale.get("SETTING_WORKAROUND4_PICK"),
                    {
                      filter: [
                        { name: "DLL", extensions: ["dll"] },
                        { name: "All files", extensions: ["*"] },
                      ],
                    }
                  );
                  if (Array.isArray(picked) && picked.length > 0) {
                    setPathValue(picked[0]);
                  }
                }}
              >
                {locale.get("SETTING_WORKAROUND4_PICK")}
              </Button>
            </Box>
          </Show>
          <Box mt={"$3"}>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                setEnabled(false);
                await setKey(PATH_KEY, "");
                await setKey(TOGGLE_KEY, "false");
                setPathValue("");
                config.mhypBaseReplacementPath = "";
                config.workaround4 = false;
                if (gameInstallDir) {
                  try {
                    await revertMhypBaseReplacement(gameInstallDir());
                    await log(
                      "WORKAROUND4: revert button — restored original mhypbase.dll from backup"
                    );
                  } catch (e) {
                    await log(`WORKAROUND4: revert failed — ${String(e)}`);
                  }
                }
              }}
            >
              {locale.get("SETTING_WORKAROUND4_REVERT_BTN")}
            </Button>
          </Box>
        </FormControl>
      );
    },
  ] as const;
}
