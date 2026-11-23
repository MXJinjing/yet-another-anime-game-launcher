import { Index, Show } from "solid-js";

export function MiyousheLaunchTools(props: {
  label: string;
  disabled: boolean;
  actions: readonly {
    kind: "pulls" | "account";
    label: string;
    status: string;
    open: () => void;
  }[];
}) {
  return (
    <div class="hyp-launch-tools" role="group" aria-label={props.label}>
      <Index each={props.actions}>
        {action => (
          <button
            type="button"
            class="hyp-launch-tool"
            aria-haspopup="dialog"
            aria-label={action().label + " · " + action().status}
            title={action().label + " · " + action().status}
            disabled={props.disabled}
            onClick={() => action().open()}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <Show
                when={action().kind === "pulls"}
                fallback={
                  <>
                    <rect x="4" y="5" width="16" height="16" rx="2" />
                    <path d="M8 3v4m8-4v4M4 10h16m-11 5 2 2 4-4" />
                  </>
                }
              >
                <path d="M4 4v16h16M8 16v-3m5 3V9m5 7V6" />
              </Show>
            </svg>
            <span class="hyp-launch-tool-label">{action().label}</span>
          </button>
        )}
      </Index>
    </div>
  );
}
