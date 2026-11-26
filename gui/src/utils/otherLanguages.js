/**
 * "lang:Hindi" selects one of the provider's other languages (a track the
 * app's own SUB/DUB versions do not cover). It travels through the existing
 * subdub channel so every player (web, MPV, Android) understands it.
 *
 * The GUI cannot import the backend helper (gui/src never imports backend
 * code), so this parser is kept in sync with backend/utils/mediaSource.js.
 */
export const LANG_PREFIX = "lang:";

export function parseLangRequest(value) {
  const raw = String(value ?? "").trim();
  if (raw.toLowerCase().startsWith(LANG_PREFIX)) {
    const lang = raw.slice(LANG_PREFIX.length).trim();
    return lang ? { lang, base: null } : { lang: null, base: null };
  }
  return { lang: null, base: raw || null };
}

export function langRequest(label) {
  return `${LANG_PREFIX}${String(label ?? "").trim()}`;
}
