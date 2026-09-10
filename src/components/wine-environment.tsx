import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Text,
} from "@hope-ui/solid";
import { createSignal } from "solid-js";
import { Locale } from "../locale";
import { AppModal, AppModalButton } from "./app-modal";
import { exec2 } from "../runtime/command-runner";
import { Wine } from "../wine";

/** Prefix path and initialization status, shared by global and game settings. */
export function WineEnvironmentInfo(props: {
  locale: Locale;
  winePrefix: string;
  wineInstalled: () => boolean;
}) {
  return (
    <FormControl>
      <FormLabel>{props.locale.get("SETTING_WINE_PREFIX_PATH")}</FormLabel>
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
      <Text
        mt="$2"
        color="rgba(255, 255, 255, 0.52)"
        fontSize="$sm"
        userSelect="none"
      >
        {props.locale.get("SETTING_WINE_STATUS")}:{" "}
        {props.wineInstalled()
          ? props.locale.get("SETTING_WINE_ENV_INITIALIZED")
          : props.locale.get("SETTING_WINE_ENV_NOT_INITIALIZED")}
      </Text>
    </FormControl>
  );
}

/** Open-cmd / winecfg / reset actions, shared by global and game settings. */
export function WineEnvironmentActions(props: {
  locale: Locale;
  wine?: Wine;
  onOpenCmd?: () => void | Promise<void>;
  onOpenWinecfg?: () => void | Promise<void>;
  winePrefix: string;
  wineInstalled: () => boolean;
  wineActionDisabled: () => boolean;
  onResetWineEnv: () => Promise<void>;
  resetMessage?: string;
}) {
  const [resetConfirmationOpen, setResetConfirmationOpen] = createSignal(false);

  async function resetWineEnvironment() {
    setResetConfirmationOpen(false);
    await props.onResetWineEnv();
  }

  return (
    <>
      <HStack spacing={"$2"}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!props.wineInstalled() || props.wineActionDisabled()}
          onClick={() =>
            void (props.onOpenCmd
              ? props.onOpenCmd()
              : props.wine?.openCmdWindow({ gameDir: props.winePrefix }))
          }
        >
          {props.locale.get("SETTING_OPEN_WINE_CMD")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!props.wineInstalled() || props.wineActionDisabled()}
          onClick={() =>
            void (props.onOpenWinecfg
              ? props.onOpenWinecfg()
              : props.wine?.exec2("winecfg", [], {}, "/dev/null"))
          }
        >
          {props.locale.get("SETTING_OPEN_WINECFG")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          colorScheme="danger"
          disabled={!props.wineInstalled() || props.wineActionDisabled()}
          onClick={() => setResetConfirmationOpen(true)}
        >
          {props.locale.get("SETTING_RESET_WINE_ENV")}
        </Button>
      </HStack>
      <AppModal
        opened={resetConfirmationOpen()}
        onClose={() => setResetConfirmationOpen(false)}
        title={
          props.locale.currentLanguage.startsWith("zh")
            ? "重置 Wine 环境？"
            : "Reset Wine Environment?"
        }
        contentClass="app-modal-content--nested"
        overlayClass="app-modal-overlay--nested"
        footer={
          <>
            <AppModalButton
              variant="secondary"
              onClick={() => setResetConfirmationOpen(false)}
            >
              {props.locale.currentLanguage.startsWith("zh")
                ? "取消"
                : "Cancel"}
            </AppModalButton>
            <AppModalButton
              variant="danger"
              disabled={props.wineActionDisabled()}
              onClick={() => void resetWineEnvironment()}
            >
              {props.locale.get("SETTING_RESET_WINE_ENV")}
            </AppModalButton>
          </>
        }
      >
        <div class="app-modal-message">
          {props.resetMessage ??
            (props.locale.currentLanguage.startsWith("zh")
              ? "此操作将删除当前 Wine Prefix 中的所有数据。"
              : "This will delete all data in the current Wine Prefix.")}
        </div>
        <div class="app-modal-warning">
          {props.locale.currentLanguage.startsWith("zh")
            ? "此操作不可恢复。"
            : "This action cannot be undone."}
        </div>
      </AppModal>
    </>
  );
}
