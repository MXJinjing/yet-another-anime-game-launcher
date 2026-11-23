import type { ParentProps } from "solid-js";

export function MiyousheLaunchTools(
  props: ParentProps<{
    label: string;
    disabled: boolean;
    pullsLabel: string;
    pullsStatus: string;
    openPulls: () => void;
  }>
) {
  const pullsTitle = () => props.pullsLabel + " · " + props.pullsStatus;
  return (
    <div class="hyp-launch-tools" role="group" aria-label={props.label}>
      <button
        type="button"
        class="hyp-launch-tool"
        aria-haspopup="dialog"
        aria-label={pullsTitle()}
        title={pullsTitle()}
        disabled={props.disabled}
        onClick={props.openPulls}
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
          <path d="M4 4v16h16M8 16v-3m5 3V9m5 7V6" />
        </svg>
        <span class="hyp-launch-tool-label">{props.pullsLabel}</span>
      </button>
      {props.children}
    </div>
  );
}
