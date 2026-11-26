function normalizeSourceRequest(episodeId, category = null) {
  const raw = String(episodeId ?? "");
  const suffix = raw.match(/-(sub|dub|hsub|both)$/);
  if (!suffix) return { episodeId: raw, category };

  return {
    episodeId: raw.slice(0, -suffix[0].length),
    category: category || (suffix[1] === "both" ? null : suffix[1]),
  };
}

// The provider episode id without its "-sub"/"-dub" category suffix.
function stripCategorySuffix(episodeId) {
  return String(episodeId ?? "").replace(/-(sub|dub|hsub|both)$/i, "");
}

// "lang:Hindi" selects one of the provider's other languages (a track the
// app's own SUB/DUB versions do not cover). It travels through the existing
// subdub channel so every player (web, MPV, Android) understands it.
const LANG_PREFIX = "lang:";

// The app's own language versions - those are not "other languages".
const STANDARD_LANG_KEYS = new Set([
  "sub",
  "subs",
  "subtitle",
  "softsub",
  "soft sub",
  "dub",
  "dubs",
  "softdub",
  "soft dub",
  "hsub",
  "hardsub",
  "hard sub",
  "both",
  "multi",
  "multi audio",
  "multiaudio",
  "raw",
  "unknown",
  "und",
]);

// The app's own DUB is English and its default subtitles are English, so
// English is never an "other" language.
const APP_OWN_LANG_KEYS = new Set(["english", "eng", "en"]);

// Words that name a track's version, not its language.
const VERSION_WORDS = new Set([
  "sub",
  "subs",
  "subtitle",
  "subtitles",
  "soft",
  "hard",
  "softsub",
  "hardsub",
  "hsub",
  "dub",
  "dubs",
  "softdub",
  "both",
  "multi",
  "raw",
]);

// Language names a provider may write in a source name instead of a "lang"
// field ("AniXoHindi Hindi Dub"). Keyed by the normalized name.
const LANGUAGE_LABELS = new Map([
  ["hindi", "Hindi"],
  ["french", "French"],
  ["portuguese", "Portuguese"],
  ["spanish", "Spanish"],
  ["russian", "Russian"],
  ["german", "German"],
  ["italian", "Italian"],
  ["japanese", "Japanese"],
  ["korean", "Korean"],
  ["chinese", "Chinese"],
  ["arabic", "Arabic"],
  ["turkish", "Turkish"],
  ["polish", "Polish"],
  ["dutch", "Dutch"],
  ["tamil", "Tamil"],
  ["telugu", "Telugu"],
  ["malayalam", "Malayalam"],
  ["bengali", "Bengali"],
  ["thai", "Thai"],
  ["vietnamese", "Vietnamese"],
  ["indonesian", "Indonesian"],
  ["tagalog", "Tagalog"],
  ["swahili", "Swahili"],
  ["romanian", "Romanian"],
  ["greek", "Greek"],
  ["hebrew", "Hebrew"],
  ["czech", "Czech"],
  ["hungarian", "Hungarian"],
  ["ukrainian", "Ukrainian"],
  ["persian", "Persian"],
  ["urdu", "Urdu"],
  ["marathi", "Marathi"],
  ["malay", "Malay"],
  ["nepali", "Nepali"],
]);

// Words a provider uses for a track that carries no language at all.
const NON_LANG_KEYS = new Set([
  "default",
  "auto",
  "server",
  "servers",
  "hls",
  "dash",
  "mpd",
  "mp4",
  "mkv",
  "webm",
  "direct",
  "stream",
  "video",
  "live",
  "original",
]);

function normalizeLangKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "SUB + DUB" is a version combo, not a language.
function isVersionComboLabel(label) {
  const words = normalizeLangKey(label).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return words.every((word) => VERSION_WORDS.has(word));
}

// "lang:Hindi" -> { lang: "Hindi", base: null }, "dub" -> { lang: null, base: "dub" }
function parseLangRequest(value) {
  const raw = String(value ?? "").trim();
  if (raw.toLowerCase().startsWith(LANG_PREFIX)) {
    const lang = raw.slice(LANG_PREFIX.length).trim();
    return lang ? { lang, base: null } : { lang: null, base: null };
  }
  return { lang: null, base: raw || null };
}

// The provider language label of one source ("Hindi", "Spanish", ...)
function sourceLangLabel(source) {
  if (!source || typeof source !== "object") return "";
  const candidates = [source.lang, source.language, source.type];
  for (const candidate of candidates) {
    const label = String(candidate ?? "").trim();
    if (!label) continue;
    const key = normalizeLangKey(label);
    if (!key || STANDARD_LANG_KEYS.has(key) || NON_LANG_KEYS.has(key)) continue;
    if (isVersionComboLabel(label)) continue;
    return label;
  }
  // Names sometimes carry the language: "Anime Salt Abyss (Hindi)"
  const name = String(source.name ?? "").trim();
  const parenthesized = name.match(/\(([^()]+)\)\s*$/);
  if (parenthesized) {
    const label = parenthesized[1].trim();
    const key = normalizeLangKey(label);
    if (
      key &&
      !STANDARD_LANG_KEYS.has(key) &&
      !NON_LANG_KEYS.has(key) &&
      !isVersionComboLabel(label)
    ) {
      return label;
    }
  }
  // Some providers only write the language in the source name
  // ("AniXoHindi Hindi Dub").
  for (const token of normalizeLangKey(name).split(/\s+/)) {
    const label = LANGUAGE_LABELS.get(token);
    if (label) return label;
  }
  return "";
}

function langKeysMatch(label, lang) {
  const target = normalizeLangKey(lang);
  const value = normalizeLangKey(label);
  if (!target || !value) return false;
  return value === target || value.includes(target) || target.includes(value);
}

function sourceMatchesLang(source, lang) {
  return langKeysMatch(sourceLangLabel(source), lang);
}

function subtitleMatchesLang(subtitle, lang) {
  const label =
    subtitle?.lang || subtitle?.label || subtitle?.language || subtitle?.name;
  return langKeysMatch(label, lang);
}

function filterSourcesByLang(sources, lang) {
  const list = Array.isArray(sources) ? sources : [];
  if (!lang) return list;
  return list.filter((source) => sourceMatchesLang(source, lang));
}

// Every other language a provider offers for one episode (audio + subtitle tracks)
function collectOtherLanguages(sourcesArray) {
  const groups =
    sourcesArray && typeof sourcesArray === "object" ? sourcesArray : {};
  const sources = [
    ...(Array.isArray(groups.sources) ? groups.sources : []),
    ...(Array.isArray(groups.sub?.sources) ? groups.sub.sources : []),
    ...(Array.isArray(groups.dub?.sources) ? groups.dub.sources : []),
    ...(Array.isArray(groups.hsub?.sources) ? groups.hsub.sources : []),
  ];
  const subtitles = [
    ...(Array.isArray(groups.subtitles) ? groups.subtitles : []),
    ...(Array.isArray(groups.sub?.subtitles) ? groups.sub.subtitles : []),
    ...(Array.isArray(groups.dub?.subtitles) ? groups.dub.subtitles : []),
  ];

  const found = new Map();
  const add = (label, kind) => {
    const clean = String(label ?? "").trim();
    if (!clean) return;
    const key = normalizeLangKey(clean);
    if (!key || STANDARD_LANG_KEYS.has(key) || NON_LANG_KEYS.has(key)) return;
    if (APP_OWN_LANG_KEYS.has(key)) return;
    const entry = found.get(key) || {
      key,
      label: clean,
      sources: 0,
      subtitles: 0,
    };
    entry[kind] += 1;
    found.set(key, entry);
  };

  sources.forEach((source) => add(sourceLangLabel(source), "sources"));
  subtitles.forEach((sub) =>
    add(sub?.lang || sub?.label || sub?.language, "subtitles"),
  );

  return [...found.values()];
}

// The app's own version of a source: sub / dub / hsub.
function sourceVersion(source) {
  const quality = String(source?.quality || "").toLowerCase();
  if (
    source?.isHsub ||
    source?.type === "hsub" ||
    quality.includes("hsub")
  ) {
    return "hsub";
  }
  if (source?.isDub || source?.type === "dub" || quality.includes("dub")) {
    return "dub";
  }
  return "sub";
}

// What the Play button offers: the languages (the app's own versions plus the
// provider's other languages) with the servers and resolutions each one has.
function collectPlaybackOptions(sourcesArray) {
  const groups =
    sourcesArray && typeof sourcesArray === "object" ? sourcesArray : {};
  const sources = [
    ...(Array.isArray(groups.sources) ? groups.sources : []),
    ...(Array.isArray(groups.sub?.sources) ? groups.sub.sources : []),
    ...(Array.isArray(groups.dub?.sources) ? groups.dub.sources : []),
    ...(Array.isArray(groups.hsub?.sources) ? groups.hsub.sources : []),
  ];

  const byKey = new Map();
  for (const source of sources) {
    const server = String(
      source?.server || source?.provider || source?.name || "Auto",
    ).trim();
    const quality = String(source?.quality || "").trim();
    const lang = sourceLangLabel(source);
    // A source that names its language belongs to that language only, a source
    // without one belongs to the app's own version (SUB / DUB / HSUB).
    const key = lang ? `lang:${lang}` : sourceVersion(source);
    const label = lang || key.toUpperCase();

    const entry = byKey.get(key) || { key, label, servers: new Map() };
    const serverEntry = entry.servers.get(server) || {
      name: server,
      resolutions: [],
    };
    if (!serverEntry.resolutions.includes(quality)) {
      serverEntry.resolutions.push(quality);
    }
    entry.servers.set(server, serverEntry);
    byKey.set(key, entry);
  }

  return {
    languages: [...byKey.values()].map((entry) => ({
      key: entry.key,
      label: entry.label,
      servers: [...entry.servers.values()].map((server) => ({
        name: server.name,
        resolutions: server.resolutions,
      })),
    })),
  };
}

// Does the extension declare languages beyond SUB/DUB? The statuses are the
// ones the provider publishes ("Multi Audio", "Hindi Dub", "Sub & Dub", ...).
function providerDeclaresOtherLanguages(statuses) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  for (const status of list) {
    const key = normalizeLangKey(status);
    if (!key) continue;
    // "Multi Audio" / "Multi Language"
    if (/\bmulti\b/.test(key)) return true;
    // "Hindi Dub", "French", ... - a named language is not the app's own dub.
    for (const token of key.split(/\s+/)) {
      if (LANGUAGE_LABELS.has(token)) return true;
    }
  }
  return false;
}

function resolvePlaylistUri(uri, playlistUrl) {
  try {
    return new URL(uri, playlistUrl).href;
  } catch (_) {
    return uri;
  }
}

function isDirectVideoUrl(url) {
  const raw = String(url ?? "");
  try {
    // Protocol-relative URLs ("//host/video.mp4") need a scheme to parse.
    const parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (/\.(mp4|mkv|webm|mov|avi)$/i.test(parsed.pathname)) return true;
    return (
      /\.sssrr\.org$/i.test(parsed.hostname) &&
      /^\/sora\/\d+\//.test(parsed.pathname)
    );
  } catch (_) {
    // Unparseable URL: keep the plain extension check so a direct video is
    // never mistaken for an HLS playlist.
    return /\.(mp4|mkv|webm|mov|avi)$/i.test(
      raw.split("?")[0].split("#")[0],
    );
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
  stripCategorySuffix,
  resolvePlaylistUri,
  hasMediaSources,
  isDirectVideoUrl,
  LANG_PREFIX,
  parseLangRequest,
  normalizeLangKey,
  sourceLangLabel,
  sourceMatchesLang,
  subtitleMatchesLang,
  filterSourcesByLang,
  collectOtherLanguages,
  collectPlaybackOptions,
  providerDeclaresOtherLanguages,
};
