import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { AppModal, AppModalButton } from "../components/app-modal";
import type { Locale } from "../locale";

export function D3DMetalLicenseModal(props: {
  locale: Locale;
  loadLicense: () => Promise<string>;
  onDecision: (accepted: boolean) => void;
}) {
  const [license, setLicense] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [loadFailed, setLoadFailed] = createSignal(false);
  const [acknowledged, setAcknowledged] = createSignal(false);
  let disposed = false;

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    setAcknowledged(false);
    try {
      const text = await props.loadLicense();
      if (!text.trim()) throw new Error("Empty license");
      if (!disposed) setLicense(text);
    } catch {
      if (!disposed) setLoadFailed(true);
    } finally {
      if (!disposed) setLoading(false);
    }
  }
  onMount(() => void load());
  onCleanup(() => {
    disposed = true;
  });

  const canAccept = () =>
    Boolean(license()) && !loading() && !loadFailed() && acknowledged();
  return (
    <AppModal
      opened={true}
      maxWidth={760}
      onClose={() => props.onDecision(false)}
      title={props.locale.get("D3DMETAL_LICENSE_TITLE")}
      footer={
        <>
          <AppModalButton onClick={() => props.onDecision(false)}>
            {props.locale.get("SETTING_CANCEL")}
          </AppModalButton>
          <AppModalButton
            variant="primary"
            disabled={!canAccept()}
            onClick={() => {
              if (canAccept()) props.onDecision(true);
            }}
          >
            {props.locale.get("D3DMETAL_LICENSE_ACCEPT")}
          </AppModalButton>
        </>
      }
    >
      <p>{props.locale.get("D3DMETAL_LICENSE_REQUIREMENTS")}</p>
      <Show when={loading()}>
        <p role="status">{props.locale.get("D3DMETAL_LICENSE_LOADING")}</p>
      </Show>
      <Show when={loadFailed()}>
        <p role="alert">{props.locale.get("D3DMETAL_LICENSE_ERROR")}</p>
        <AppModalButton onClick={() => void load()}>
          {props.locale.get("D3DMETAL_LICENSE_RETRY")}
        </AppModalButton>
      </Show>
      <Show when={license() && !loadFailed() && !loading()}>
        <pre
          tabindex={0}
          style={{
            "max-height": "45vh",
            "overflow-y": "auto",
            "white-space": "pre-wrap",
            "overflow-wrap": "anywhere",
            border: "1px solid currentColor",
            padding: "1em",
            "font-family": "inherit",
          }}
        >
          {license()}
        </pre>
        <label>
          <input
            type="checkbox"
            checked={acknowledged()}
            onChange={event => setAcknowledged(event.currentTarget.checked)}
          />{" "}
          {props.locale.get("D3DMETAL_LICENSE_ACKNOWLEDGE")}
        </label>
      </Show>
    </AppModal>
  );
}
