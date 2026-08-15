export function formatString(str: string, intrp: string[]) {
  return `${str}`.replace(/{(\d+)}/g, (match, number) =>
    typeof intrp[number] != "undefined" ? intrp[number] : match
  );
}

export function humanFileSize(bytes: number, si = false, dp = 1) {
  const thresh = si ? 1000 : 1024;
  if (Math.abs(bytes) < thresh) return bytes + " B";

  const units = si
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;
  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );
  return bytes.toFixed(dp) + " " + units[u];
}

export function downloadPercent(
  completed: number | bigint,
  total: number | bigint
) {
  const completedNumber = Number(completed);
  const totalNumber = Number(total);
  if (!Number.isFinite(completedNumber) || !Number.isFinite(totalNumber)) {
    return "0.00%";
  }
  if (totalNumber <= 0) return "0.00%";
  return `${Math.min(
    100,
    Math.max(0, (completedNumber / totalNumber) * 100)
  ).toFixed(2)}%`;
}

export function formatDownloadSpeed(bytesPerSecond: number) {
  const safeSpeed =
    Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? bytesPerSecond : 0;
  return `${humanFileSize(safeSpeed)}/s`;
}
