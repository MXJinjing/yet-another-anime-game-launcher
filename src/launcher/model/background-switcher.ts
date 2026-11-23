/** Pure helpers for persisted multi-background selection. */
export type BackgroundPersistedState = {
  ids: string[];
  index: number;
};

/** Artwork fields needed to decide what the background layer renders. */
export type BackgroundArtwork = {
  background?: string;
  background_video?: string;
  background_theme?: string;
};

/**
 * Pick the clip to play for the selected artwork.
 *
 * hyp-connect reports artworks without a clip as an empty `video.url` instead
 * of omitting the field, so an empty string has to mean "no clip" instead of
 * shadowing the game-level fallback. A present artwork entry stays
 * authoritative: falling through to the game-level clip there would paint the
 * first background's video over every still artwork.
 */
export function resolveBackgroundVideo(
  artwork: BackgroundArtwork | undefined,
  fallback: string | undefined,
  disabled = false
): string | undefined {
  if (disabled) return undefined;
  if (artwork) return artwork.background_video || undefined;
  return fallback || undefined;
}

/** Same empty-string normalisation for the still artwork. */
export function resolveBackgroundImage(
  artwork: BackgroundArtwork | undefined,
  fallback: string | undefined
): string | undefined {
  return artwork?.background || fallback || undefined;
}

/**
 * Pick the title/branding overlay for the selected artwork.
 *
 * The game-level theme is the marketing title of the primary background, so it
 * must not survive a switch to another artwork: an artwork that ships without
 * one is a deliberate blank, not a reason to paint the first background's title
 * over it. Same rule as the clip above.
 */
export function resolveBackgroundTheme(
  artwork: BackgroundArtwork | undefined,
  fallback: string | undefined
): string | undefined {
  if (artwork) return artwork.background_theme || undefined;
  return fallback || undefined;
}

export function parseBackgroundPersistedState(
  raw: string | null | undefined
): BackgroundPersistedState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as BackgroundPersistedState).ids) &&
      (parsed as BackgroundPersistedState).ids.every(
        id => typeof id === "string"
      ) &&
      typeof (parsed as BackgroundPersistedState).index === "number"
    ) {
      return {
        ids: (parsed as BackgroundPersistedState).ids,
        index: (parsed as BackgroundPersistedState).index,
      };
    }
  } catch {
    // Invalid persisted values safely fall back to the first background.
  }
  return null;
}

export function resolveInitialIndex(
  stored: BackgroundPersistedState | null,
  currentIds: string[],
  fallback = 0
): number {
  if (!stored || currentIds.length === 0) return fallback;
  if (stored.index < 0 || stored.index >= currentIds.length) return fallback;
  if (
    stored.ids.length !== currentIds.length ||
    stored.ids.some((id, index) => id !== currentIds[index])
  ) {
    return fallback;
  }
  return stored.index;
}
