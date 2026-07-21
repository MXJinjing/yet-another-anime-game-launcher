import { Box, Button, FormControl, FormLabel, Input } from "@hope-ui/solid";
import { createEffect, createSignal } from "solid-js";
import { Locale } from "@locale";
import { assertValueDefined, getKey, setKey, log } from "@utils";
import { Config, NOOP } from "@config/config-def";
import { revertMhypBaseReplacement } from "../../../mhy/patch";

declare module "@config/config-def" {
  interface Config {
    mhypBaseReplacementPath: string;
  }
}

const CONFIG_KEY = "config_mhypbase_replacement_path";

export default async function ({
  locale,
  config,
  gameInstallDir,
}: {
  locale: Locale;
  config: Partial<Config>;
  gameInstallDir?: () => string;
}) {
  let stored = "";
  try {
    stored = await getKey(CONFIG_KEY);
  } catch {
    stored = "";
  }
  config.mhypBaseReplacementPath = stored;

  const [value, setValue] = createSignal(stored);

  async function onSave(apply: boolean) {
    assertValueDefined(config.mhypBaseReplacementPath);
    const v = value().trim();
    if (!apply) {
      setValue(config.mhypBaseReplacementPath);
      return NOOP;
    }
    if (config.mhypBaseReplacementPath == v) return NOOP;
    config.mhypBaseReplacementPath = v;
    await setKey(CONFIG_KEY, v);
    return NOOP;
  }

  createEffect(() => {
    value();
    onSave(true);
  });

  return [
    function UI() {
      return (
        <FormControl id="workaround4">
          <FormLabel>{locale.get("SETTING_WORKAROUND4")}</FormLabel>
          <Box mb={"$2"}>
            <small style={{ color: "#aaa" }}>
              {locale.get("SETTING_WORKAROUND4_DESC")}
            </small>
          </Box>
          <Input
            value={value()}
            placeholder="/Users/you/Downloads/old_mhypbase.dll"
            onChange={e => setValue(e.currentTarget.value)}
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
                  setValue(picked[0]);
                }
              }}
            >
              {locale.get("SETTING_WORKAROUND4_PICK")}
            </Button>
          </Box>
          <Box mt={"$3"}>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await setKey(CONFIG_KEY, "");
                setValue("");
                config.mhypBaseReplacementPath = "";
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
