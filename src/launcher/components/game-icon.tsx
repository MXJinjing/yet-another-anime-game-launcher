import { Show, createEffect, createSignal } from "solid-js";
import "./game-icon.css";

const FALLBACK_COLORS = [
  "#3f6dd6",
  "#2e9e77",
  "#c64f6d",
  "#8a5fd4",
  "#c8862f",
  "#2b9ca5",
  "#5a8f38",
  "#b5489b",
] as const;

export function getGameIconFallbackColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function GameIcon(props: {
  src: string;
  title: string;
  channel: string;
  alt?: string;
  loading?: "eager" | "lazy";
}) {
  const [failed, setFailed] = createSignal(false);

  createEffect(() => {
    if (props.src.trim()) setFailed(false);
  });

  const label = () => props.title.trim() || props.channel.trim() || "?";
  const letter = () => label().charAt(0).toUpperCase();
  const hasImage = () => props.src.trim().length > 0 && !failed();

  return (
    <Show
      when={hasImage()}
      fallback={
        <span
          class="hyp-game-icon-fallback"
          aria-hidden="true"
          style={{
            "background-color": getGameIconFallbackColor(label()),
          }}
        >
          {letter()}
        </span>
      }
    >
      <img
        src={props.src}
        alt={props.alt ?? ""}
        loading={props.loading ?? "lazy"}
        decoding="async"
        onError={() => setFailed(true)}
      />
    </Show>
  );
}
