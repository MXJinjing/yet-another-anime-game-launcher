export function PullAnalysisButton(props: {
  disabled: boolean;
  label: string;
  status: string;
  onClick: () => void;
}) {
  const title = () => props.label + " · " + props.status;
  return (
    <button
      class="hyp-launch-tool"
      type="button"
      aria-haspopup="dialog"
      aria-label={title()}
      title={title()}
      disabled={props.disabled}
      onClick={props.onClick}
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
      <span class="hyp-launch-tool-label">{props.label}</span>
    </button>
  );
}
