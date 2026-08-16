import { Show, createEffect, createSignal } from "solid-js";
import { getGameIconFallbackColor } from "./game-icon";
import "./game-banner.css";

export function GameBanner(props: {
  src: string;
  label: string;
  alt?: string;
}) {
  const [failed, setFailed] = createSignal(false);

  createEffect(() => {
    if (props.src.trim()) setFailed(false);
  });

  const label = () => props.label.trim() || "?";
  const hasImage = () => props.src.trim().length > 0 && !failed();

  return (
    <Show
      when={hasImage()}
      fallback={
        <span
          class="hyp-game-banner-fallback"
          style={{
            "background-color": getGameIconFallbackColor(label()),
          }}
        >
          {label()}
        </span>
      }
    >
      <img
        src={props.src}
        alt={props.alt ?? ""}
        onError={() => setFailed(true)}
      />
    </Show>
  );
}
