import { For } from "solid-js";
import "./game-library.css";

export type GameLibraryItem = {
  id: string;
  title: string;
  iconUrl: string;
  bannerUrl: string;
  serverLabel: string;
  installed: boolean;
};

export function GameLibraryView(props: {
  games: GameLibraryItem[];
  onSelect: (index: number) => void;
  onClose: () => void;
  title?: string;
  themeColor?: string;
}) {
  return (
    <div
      class="hoyoplay-game-library"
      role="region"
      aria-label={props.title ?? "游戏库"}
      style={{ "--hoyoplay-accent": props.themeColor ?? "#ffd834" }}
    >
      <button
        type="button"
        class="hoyoplay-library-dismiss"
        aria-label="关闭游戏库"
        onClick={props.onClose}
      />
      <div class="hoyoplay-library-panel">
        <div class="hoyoplay-library-glass" aria-hidden="true" />
        <h2 class="hoyoplay-library-title">{props.title ?? "游戏库"}</h2>
        <div class="hoyoplay-library-scroll">
          <div class="hoyoplay-library-grid">
            <For each={props.games}>
              {(game, index) => (
                <button
                  type="button"
                  class="hoyoplay-library-card"
                  aria-label={`${game.title} · ${game.serverLabel}`}
                  style={{
                    "background-image": `url("${game.bannerUrl}")`,
                  }}
                  onClick={() => props.onSelect(index())}
                >
                  <span class="hoyoplay-library-card-icon">
                    <img src={game.iconUrl} alt="" />
                  </span>
                  <span
                    class={
                      "hoyoplay-library-status" +
                      (game.installed ? "" : " is-missing")
                    }
                  />
                  <span class="hoyoplay-library-card-info">
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
