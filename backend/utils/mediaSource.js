function normalizeSourceRequest(episodeId, category = null) {
  const raw = String(episodeId ?? "");
  const suffix = raw.match(/-(sub|dub|hsub|both)$/);
  if (!suffix) return { episodeId: raw, category };

  return {
    episodeId: raw.slice(0, -suffix[0].length),
    category: category || (suffix[1] === "both" ? null : suffix[1]),
  };
}

function resolvePlaylistUri(uri, playlistUrl) {
  try {
    return new URL(uri, playlistUrl).href;
  } catch (_) {
    return uri;
  }
}

function isDirectVideoUrl(url) {
  try {
    const parsed = new URL(url);
    if (/\.(mp4|mkv|webm|mov|avi)$/i.test(parsed.pathname)) return true;
    return (
      /\.sssrr\.org$/i.test(parsed.hostname) &&
      /^\/sora\/\d+\//.test(parsed.pathname)
    );
  } catch (_) {
    return false;
  }
}

function hasMediaSources(result) {
  if (!result) return false;
  if (Array.isArray(result)) return result.length > 0;
  const groups = [
    result.sources,
    result.sub?.sources,
    result.dub?.sources,
    result.hsub?.sources,
  ];
  if (groups.some((items) => Array.isArray(items) && items.length > 0)) {
    return true;
  }
  return [result.sub, result.dub, result.hsub].some(
    (items) => Array.isArray(items) && items.length > 0,
  );
}

module.exports = {
  normalizeSourceRequest,
  resolvePlaylistUri,
  hasMediaSources,
  isDirectVideoUrl,
};
