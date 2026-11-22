export function getDownloadProgress(task = {}) {
  const total = Number(task.totalSegments) || 0;
  const current = Number(task.currentSegments) || 0;
  const segmentProgress =
    total > 0 ? Math.floor((current / total) * 100) : 0;

  const caption = String(task.caption || "");
  const percentages = [...caption.matchAll(/\((\d{1,3})%\)/g)];
  const captionProgress = percentages.length
    ? Number(percentages[percentages.length - 1][1])
    : 0;

  return Math.min(100, Math.max(segmentProgress, captionProgress));
}
