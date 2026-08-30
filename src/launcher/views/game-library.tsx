import { For, Show, createSignal } from "solid-js";
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
  const [libraryPage, setLibraryPage] = createSignal(0);
  const pageSize = 4;
  const pageCount = () => Math.ceil(props.games.length / pageSize);
  const visibleGames = () => {
    const start = libraryPage() * pageSize;
    return Array.from(
      { length: pageSize },
      (_, slot) => props.games[start + slot]
    );
  };

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
            <For each={visibleGames()}>
              {(game, slot) => (
                <Show
                  when={game}
                  fallback={<span class="hyp-library-card is-empty" />}
                >
                  {currentGame => (
                    <button
                      type="button"
                      class="hyp-library-card"
                      aria-label={`${currentGame().title} · ${
                        currentGame().serverLabel
                      }`}
                      onClick={() =>
                        props.onSelect(libraryPage() * pageSize + slot())
                      }
                    >
                      <span class="hyp-library-banner">
                        <GameBanner
                          src={currentGame().bannerUrl}
                          label={currentGame().channelName}
                        />
                      </span>
                      <span class="hyp-library-card-icon">
                        <GameIcon
                          src={currentGame().iconUrl}
                          title={currentGame().title}
                          channel={currentGame().channel}
                        />
                      </span>
                      <span
                        class={
                          "hyp-library-status" +
                          (currentGame().installed ? "" : " is-missing")
                        }
                      />
                      <span class="hyp-library-card-info">
                        <strong>{currentGame().title}</strong>
                        <small>{currentGame().serverLabel}</small>
                      </span>
                    </button>
                  )}
                </Show>
              )}
            </For>
          </div>
        </div>
        <Show when={pageCount() > 1}>
          <div class="hyp-mhy-banner-arrows hyp-library-arrows">
            <button
              type="button"
              aria-label="上一页游戏"
              title="上一页"
              disabled={libraryPage() === 0}
              onClick={() => setLibraryPage(page => Math.max(0, page - 1))}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="下一页游戏"
              title="下一页"
              disabled={libraryPage() >= pageCount() - 1}
              onClick={() =>
                setLibraryPage(page => Math.min(pageCount() - 1, page + 1))
              }
            >
              ›
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
