export type ProgressPanelVisibilityInput = {
  isDownloadStatus: boolean;
  file?: string;
  speed?: string;
  downloaded?: string;
  total?: string;
  fileIndex?: string;
  fileCount?: string;
};

function hasValue(value: string | undefined) {
  return value !== undefined && value !== "";
}

/** Derives display-only progress rows without depending on Solid or services. */
export function getProgressPanelVisibility({
  isDownloadStatus,
  file,
  speed,
  downloaded,
  total,
  fileIndex,
  fileCount,
}: ProgressPanelVisibilityInput) {
  return {
    showFileRow: !isDownloadStatus && hasValue(file),
    showFileIndex: fileIndex !== undefined && fileCount !== undefined,
    showDownloadedRow: hasValue(downloaded) && hasValue(total),
    showSpeedRow: hasValue(speed),
  };
}
