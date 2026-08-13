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
  title?: string;
}) {
  return (
    <div class="hoyoplay-game-library">
      <h2 class="hoyoplay-library-title">{props.title ?? "游戏库"}</h2>
      <div class="hoyoplay-library-grid">
        <For each={props.games}>
          {(game, index) => (
            <button
              class="hoyoplay-library-card"
              style={{
                "background-image": `url("${game.bannerUrl}")`,
                "background-size": "cover",
                "background-position": "center",
              }}
              onClick={() => props.onSelect(index())}
            >
              <span class="hoyoplay-library-card-icon">
                <img src={game.iconUrl} alt="" />
              </span>
              <span class="hoyoplay-library-card-info">
                <strong>{game.title}</strong>
                <small>{game.serverLabel}</small>
              </span>
              {game.installed && <span class="hoyoplay-library-installed" />}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
