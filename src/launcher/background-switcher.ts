/**
 * Pure helpers for the multi-background switcher.
 * Kept framework-free so they can be unit-tested in a Node environment.
 */

export type BackgroundPersistedState = {
  ids: string[];
  index: number;
};

/**
 * Parse the persisted JSON value written by the launcher.
 * Returns null for missing/invalid values so callers fall back safely.
 */
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
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the initial background index for a game.
 * Falls back to `fallback` when there is no stored state, the stored ids no
 * longer match the freshly fetched ones (backgrounds were updated), or the
 * stored index is out of range.
 */
export function resolveInitialIndex(
  stored: BackgroundPersistedState | null,
  currentIds: string[],
  fallback = 0
): number {
  if (!stored || currentIds.length === 0) return fallback;
  if (stored.index < 0 || stored.index >= currentIds.length) return fallback;
  if (
    stored.ids.length !== currentIds.length ||
    stored.ids.some((id, i) => id !== currentIds[i])
  ) {
    return fallback;
  }
  return stored.index;
}
