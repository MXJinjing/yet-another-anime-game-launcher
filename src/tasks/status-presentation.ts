export type ProgressTitleKey =
  | "CHECKING_GAME_INTEGRITY"
  | "CHECKING_EXISTING_FILES"
  | "PATCHING"
  | "REPAIRING_FILES"
  | "DOWNLOAD_PROGRESS"
  | "DOWNLOADING_ENVIRONMENT"
  | "REVERT_PATCHING";

export type TaskStatusPresentation = {
  titleKey: ProgressTitleKey;
  index?: number;
  count?: number;
  file?: string;
  speed?: string;
  downloaded?: string;
  total?: string;
  percentText?: string;
  elapsed?: string;
};

function count(value: string | undefined) {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Status sentences used to carry counts, speeds, and percents. Keep those
 * numbers out of titles and return them as separate fields. */
export function presentTaskStatus(
  key: string | undefined,
  args: readonly string[] | undefined
): TaskStatusPresentation | undefined {
  const values = args ?? [];
  switch (key) {
    case "SCANNING_FILES":
      return {
        titleKey: "CHECKING_GAME_INTEGRITY",
        index: count(values[0]),
        count: count(values[1]),
      };
    case "CHECKING_DOWNLOAD_FILES":
      return {
        titleKey: "CHECKING_EXISTING_FILES",
        index: count(values[0]),
        count: count(values[1]),
        file: text(values[2]),
        elapsed: text(values[4]),
      };
    case "PATCHING_FILE_PROGRESS":
      return {
        titleKey: "PATCHING",
        index: count(values[0]),
        count: count(values[1]),
        file: text(values[2]),
        elapsed: text(values[4]),
      };
    case "FIXING_FILES":
      return {
        titleKey: "REPAIRING_FILES",
        index: count(values[0]),
        count: count(values[1]),
      };
    case "DOWNLOADING_FILE_PROGRESS":
      return {
        titleKey: "DOWNLOAD_PROGRESS",
        file: text(values[0]),
        speed: text(values[1]),
        downloaded: text(values[2]),
        total: text(values[3]),
        percentText: text(values[4]),
        index: count(values[5]),
        count: count(values[6]),
      };
    case "DOWNLOADING_ENVIRONMENT_SPEED":
      return {
        titleKey: "DOWNLOADING_ENVIRONMENT",
        speed: text(values[0]),
        downloaded: text(values[1]),
        total: text(values[2]),
        percentText: text(values[3]),
        index: count(values[4]),
        count: count(values[5]),
      };
    case "REVERT_PATCHING":
      return {
        titleKey: "REVERT_PATCHING",
        index: count(values[0]),
        count: count(values[1]),
      };
    default:
      return undefined;
  }
}

export function fileProgressLabel(
  presentation: { index?: number; count?: number } | undefined
) {
  if (
    presentation?.index === undefined ||
    presentation.count === undefined ||
    presentation.count <= 0
  ) {
    return undefined;
  }
  return `${presentation.index} / ${presentation.count}`;
}
