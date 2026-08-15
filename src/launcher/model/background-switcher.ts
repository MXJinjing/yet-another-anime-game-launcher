/** Pure helpers for persisted multi-background selection. */
export type BackgroundPersistedState = {
  ids: string[];
  index: number;
};

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
