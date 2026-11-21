import { AppModal, AppModalButton } from "../components/app-modal";
import type { Locale } from "../locale";

/**
 * Ask whether a running game should be force-stopped before launching again.
 * The destructive button is deliberately the only primary action.
 */
export function GameAlreadyRunningModal(props: {
  opened: boolean;
  locale: Locale;
  gameTitle?: string;
  executablePath: string;
  onCancel: () => void;
  onForceStop: () => void;
}) {
  const chinese = () => props.locale.currentLanguage.startsWith("zh");
  const title = () => (chinese() ? "游戏已在运行" : "Game is already running");
  const message = () =>
    chinese()
      ? `“${
          props.gameTitle ?? "该游戏"
        }”已在运行，本次启动已取消。请先关闭游戏，或强制结束后再启动。`
      : `${
          props.gameTitle ?? "This game"
        } is already running, so this launch was cancelled. Close it first, or force stop it and launch again.`;
  const forceLabel = () =>
    chinese() ? "强制结束后启动" : "Force stop and launch";
  const cancelLabel = () => (chinese() ? "取消启动" : "Cancel launch");

  return (
    <AppModal
      opened={props.opened}
      onClose={props.onCancel}
      title={title()}
      footer={
        <>
          <AppModalButton variant="secondary" onClick={props.onCancel}>
            {cancelLabel()}
          </AppModalButton>
          <AppModalButton variant="danger" onClick={props.onForceStop}>
            {forceLabel()}
          </AppModalButton>
        </>
      }
    >
      <div class="app-modal-message">{message()}</div>
      <pre class="app-modal-error-details">{props.executablePath}</pre>
    </AppModal>
  );
}

/**
 * The replacement configuration is unusable but can be skipped. Launching a
 * state the user did not ask for silently is not acceptable, so ask first.
 */
export function RuntimeReplacementPromptModal(props: {
  opened: boolean;
  locale: Locale;
  gameTitle?: string;
  details: string;
  onCancel: () => void;
  onSkip: () => void;
}) {
  const chinese = () => props.locale.currentLanguage.startsWith("zh");
  const title = () =>
    chinese() ? "运行时替换未生效" : "Runtime replacement unavailable";
  const message = () =>
    chinese()
      ? `“${
          props.gameTitle ?? "该游戏"
        }”的运行时文件替换无法应用。你可以跳过替换并启动游戏，或取消本次启动。`
      : `The runtime file replacement for ${
          props.gameTitle ?? "this game"
        } could not be applied. Skip the replacement and launch, or cancel this launch.`;
  const skipLabel = () =>
    chinese() ? "跳过替换并启动" : "Skip replacement and launch";
  const cancelLabel = () => (chinese() ? "取消启动" : "Cancel launch");

  return (
    <AppModal
      opened={props.opened}
      onClose={props.onCancel}
      title={title()}
      footer={
        <>
          <AppModalButton variant="secondary" onClick={props.onCancel}>
            {cancelLabel()}
          </AppModalButton>
          <AppModalButton variant="primary" onClick={props.onSkip}>
            {skipLabel()}
          </AppModalButton>
        </>
      }
    >
      <div class="app-modal-message">{message()}</div>
      {props.details ? (
        <pre class="app-modal-error-details">{props.details}</pre>
      ) : null}
    </AppModal>
  );
}
