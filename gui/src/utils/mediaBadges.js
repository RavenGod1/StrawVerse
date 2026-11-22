/**
 * Shared badge helpers for the info page, the Seasons/Recommendations cards
 * and the Discover catalog:
 *  - normalizeStatus(): airing/publishing status -> { kind, label }
 *  - formatAudioLangs(): ["sub","dub"] -> "SUB" | "SUB & DUB" | "DUB"
 *  - unionEpisodeLangs(): merges the langs of a page of episode items
 */

const RULES = [
  {
    kind: "airing",
    test: /^(releasing|currently_airing|currently_publishing|airing|ongoing|publishing)$/,
    anime: "Currently Airing",
    manga: "Publishing",
  },
  {
    kind: "complete",
    test: /^(finished|finished_airing|complete|completed|finished_publishing)$/,
    anime: "Complete",
    manga: "Complete",
  },
  {
    kind: "upcoming",
    test: /^(not_yet_released|not_yet_aired|not_yet_published|upcoming|tba)$/,
    anime: "Not Yet Aired",
    manga: "Not Yet Published",
  },
  {
    kind: "hiatus",
    test: /^(hiatus|on_hiatus)$/,
    anime: "On Hiatus",
    manga: "On Hiatus",
  },
  {
    kind: "cancelled",
    test: /^(cancelled|discontinued)$/,
    anime: "Cancelled",
    manga: "Cancelled",
  },
];

/**
 * @param {string|null} raw AniList status, MAL status or provider status
 * @param {"Anime"|"Manga"} type
 * @returns {{kind: string, label: string}|null}
 */
export function normalizeStatus(raw, type = "Anime") {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value || /^unknown$/i.test(value)) return null;
  const key = value.toLowerCase().replace(/[\s-]+/g, "_");
  const rule = RULES.find((r) => r.test.test(key));
  if (!rule) return null;
  return { kind: rule.kind, label: type === "Manga" ? rule.manga : rule.anime };
}

/**
 * @param {string[]|null} langs episode languages (sub/dub/hsub/softsub/both)
 * @returns {string|null} "SUB" | "SUB & DUB" | "DUB" | null when unknown
 */
export function formatAudioLangs(langs) {
  if (!Array.isArray(langs) || langs.length === 0) return null;
  const set = new Set(langs.map((l) => String(l).toLowerCase()));
  const hasBoth = set.has("both");
  const hasSub =
    hasBoth || ["sub", "softsub", "hsub"].some((l) => set.has(l));
  const hasDub = hasBoth || ["dub", "softdub"].some((l) => set.has(l));
  if (hasSub && hasDub) return "SUB & DUB";
  if (hasDub) return "DUB";
  if (hasSub) return "SUB";
  return null;
}

/**
 * @param {Array<{langs?: string[], lang?: string}>|null} episodes
 * @returns {string[]} distinct languages found across the episode list
 */
export function unionEpisodeLangs(episodes) {
  const set = new Set();
  for (const ep of episodes || []) {
    if (Array.isArray(ep?.langs)) {
      ep.langs.forEach((l) => set.add(String(l).toLowerCase()));
    } else if (ep?.lang) {
      set.add(String(ep.lang).toLowerCase());
    }
  }
  return [...set];
}

export function hasLanguageChoice(langs = []) {
  return Array.isArray(langs) && langs.includes("sub") && langs.includes("dub");
}

/**
 * Resolve the playable language versions for one episode. Episode metadata is
 * authoritative; provider detail metadata fills the gap when an extension does
 * not label every episode (for example, dual-audio providers with plain rows).
 */
export function resolveItemLangs(item = {}, details = {}, selected = null) {
  const explicit = Array.isArray(item.langs)
    ? item.langs.flatMap((lang) => {
        const value = String(lang).toLowerCase();
        return value === "both" ? ["sub", "dub"] : [value];
      })
    : item.lang
      ? String(item.lang).toLowerCase() === "both"
        ? ["sub", "dub"]
        : [String(item.lang).toLowerCase()]
      : [];
  if (explicit.length > 0) return [...new Set(explicit)];

  const subOrDub = details?.subOrDub
    ? String(details.subOrDub).toLowerCase()
    : null;
  const hasLanguageMetadata =
    item.hasSub !== undefined ||
    item.hasDub !== undefined ||
    details?.hasSub !== undefined ||
    details?.hasDub !== undefined ||
    subOrDub;
  const hasSub =
    item.hasSub !== undefined
      ? item.hasSub
      : details?.hasSub !== undefined
        ? details.hasSub
        : subOrDub
          ? subOrDub !== "dub"
          : true;
  const hasDub =
    item.hasDub !== undefined
      ? item.hasDub
      : details?.hasDub !== undefined
        ? details.hasDub
        : subOrDub === "both" || subOrDub === "dub";

  const langs = [];
  if (hasSub) langs.push("sub");
  if (hasDub) langs.push("dub");
  if (item.hasHsub || details?.hasHsub) langs.push("hsub");
  if (item.hasSoftsub || item.hasSoftSub || details?.hasSoftsub)
    langs.push("softsub");
  if (item.hasSoftdub || item.hasSoftDub || details?.hasSoftdub)
    langs.push("softdub");

  if (langs.length === 0 && !hasLanguageMetadata) {
    langs.push("sub");
    if (selected === "dub") langs.push("dub");
  }
  return [...new Set(langs)];
}
