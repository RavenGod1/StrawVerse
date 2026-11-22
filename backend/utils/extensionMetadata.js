const MAX_STATUSES = 6;
const MAX_STATUS_LENGTH = 32;

function normalizeExtensionStatuses(statuses) {
  if (!Array.isArray(statuses)) return [];

  const seen = new Set();
  const normalized = [];

  for (const value of statuses) {
    if (typeof value !== "string") continue;

    const label = value
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_STATUS_LENGTH);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;

    seen.add(key);
    normalized.push(label);
    if (normalized.length === MAX_STATUSES) break;
  }

  return normalized;
}

function normalizeGitHubRawUrl(url) {
  // GitHub's refs/heads raw path can remain on a stale CDN object after a push.
  return String(url || "").replace(
    /^(https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+)\/refs\/heads\//i,
    "$1/",
  );
}

module.exports = { normalizeExtensionStatuses, normalizeGitHubRawUrl };
