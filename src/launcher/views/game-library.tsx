import { For } from "solid-js";
import { GameBanner } from "../components/game-banner";
import { GameIcon } from "../components/game-icon";
import "./game-library.css";

export type GameLibraryItem = {
  id: string;
  title: string;
  iconUrl: string;
  bannerUrl: string;
  serverLabel: string;
  channel: string;
  channelName: string;
  installed: boolean;
};

export function GameLibraryView(props: {
  games: GameLibraryItem[];
  onSelect: (index: number) => void;
  onClose: () => void;
  closing?: boolean;
  title?: string;
  themeColor?: string;
}) {
  return (
    <div
      classList={{
        "hyp-game-library": true,
        closing: props.closing ?? false,
      }}
      role="region"
      aria-label={props.title ?? "游戏库"}
      style={{ "--hyp-accent": props.themeColor ?? "#ffd834" }}
    >
      <button
        type="button"
        class="hyp-library-dismiss"
        aria-label="关闭游戏库"
        onClick={props.onClose}
      />
      <div class="hyp-library-panel">
        <div class="hyp-library-glass" aria-hidden="true" />
        <h2 class="hyp-library-title">{props.title ?? "游戏库"}</h2>
        <div class="hyp-library-scroll">
          <div class="hyp-library-grid">
            <For each={props.games}>
              {(game, index) => (
                <button
                  type="button"
                  class="hyp-library-card"
                  aria-label={`${game.title} · ${game.serverLabel}`}
                  onClick={() => props.onSelect(index())}
                >
                  <span class="hyp-library-banner">
                    <GameBanner src={game.bannerUrl} label={game.channelName} />
                  </span>
                  <span class="hyp-library-card-icon">
                    <GameIcon
                      src={game.iconUrl}
                      title={game.title}
                      channel={game.channel}
                    />
                  </span>
                  <span
                    class={
                      "hyp-library-status" +
                      (game.installed ? "" : " is-missing")
                    }
                  />
                  <span class="hyp-library-card-info">
                    <strong>{game.title}</strong>
                    <small>{game.serverLabel}</small>
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
