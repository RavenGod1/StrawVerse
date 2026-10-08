const { run, queryAll } = require("./db");

const cookieCache = global.proxyCookieCache || (global.proxyCookieCache = {});
const refererCache =
  global.proxyRefererCache || (global.proxyRefererCache = {});
const uaCache = global.proxyUaCache || (global.proxyUaCache = {});
const hintsCache = global.proxyHintsCache || (global.proxyHintsCache = {});

function normalizeDomain(domain) {
  if (!domain) return null;
  try {
    if (domain.startsWith("http://") || domain.startsWith("https://")) {
      return new URL(domain).hostname.replace(/^www\./, "");
    }
  } catch (e) {}
  return String(domain)
    .replace(/^www\./, "")
    .toLowerCase();
}

function normalizeReferer(referer) {
  if (!referer) return null;
  try {
    const refUrl = new URL(referer);
    if (refUrl.protocol !== "http:" && refUrl.protocol !== "https:") {
      return null;
    }
    return refUrl.origin + "/";
  } catch (e) {
    return null;
  }
}

function saveStreamReferer(domain, referer) {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedReferer = normalizeReferer(referer);
  if (!normalizedDomain || !normalizedReferer) return;

  const domainsToSave = [normalizedDomain];
  const parts = normalizedDomain.split(".");
  if (parts.length > 2) {
    const rootDomain = parts.slice(-2).join(".");
    domainsToSave.push(rootDomain);
  }

  for (const d of domainsToSave) {
    if (refererCache[d] !== normalizedReferer) {
      refererCache[d] = normalizedReferer;
      try {
        run(
          "INSERT INTO StreamReferer (domain, referer, updatedAt) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET referer = excluded.referer, updatedAt = excluded.updatedAt",
          [d, normalizedReferer, Date.now()],
        );
      } catch (e) {}
    }
  }

  try {
    run(
      `DELETE FROM StreamReferer
         WHERE domain NOT IN (
           SELECT domain FROM StreamReferer
           ORDER BY CASE WHEN domain = ? THEN 1 ELSE 0 END DESC, updatedAt DESC
           LIMIT ?
         )`,
      ["__fallback__", 1000],
    );
  } catch (e) {}
}

function getStoredStreamReferer(domain) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;

  const parts = normalizedDomain.split(".");
  const candidates = [];
  for (let i = 0; i < parts.length - 1; i++) {
    candidates.push(parts.slice(i).join("."));
  }

  for (const candidate of candidates) {
    if (refererCache[candidate]) return refererCache[candidate];
  }
  return null;
}

global.setDynamicReferer = (domain, referer) => {
  saveStreamReferer(domain, referer);
};

global.setFallbackReferer = (referer) => {
  delete refererCache["__fallback__"];
  saveStreamReferer("__fallback__", referer);
};

async function initCache() {
  try {
    // Load referers
    const referers = await queryAll(
      "SELECT domain, referer FROM StreamReferer",
    );
    for (const ref of referers) {
      if (ref.domain && ref.referer) {
        refererCache[ref.domain] = ref.referer;
      }
    }

    // Load cookies, UAs, hints
    const rows = await queryAll(
      "SELECT id, name, domain, value, expirationDate, local_saved_at FROM cookie",
    );
    for (const row of rows) {
      const id = row.id;
      const name = row.name;
      const value = row.value;
      const domain =
        row.domain ||
        (id.endsWith("-user_agent")
          ? id.substring(0, id.length - 11)
          : id.substring(0, id.length - 13));

      if (name === "user_agent") {
        uaCache[domain] = value;
      } else if (name === "client_hints") {
        try {
          hintsCache[domain] = JSON.parse(value);
        } catch (e) {}
      } else if (name && value) {
        let exp = Number(row.expirationDate);
        if (exp > 0 && exp < 1e11) {
          exp = exp * 1000;
        }
        let savedAt = Number(row.local_saved_at);
        if (savedAt > 0 && savedAt < 1e11) {
          savedAt = savedAt * 1000;
        }
        const now = Date.now();
        let isValid = false;
        let expiryTime = now + 24 * 60 * 60 * 1000;
        if (!isNaN(exp) && exp > now) {
          isValid = true;
          expiryTime = exp;
        } else if (
          !isNaN(savedAt) &&
          savedAt > 0 &&
          now - savedAt < 7 * 24 * 60 * 60 * 1000
        ) {
          isValid = true;
          expiryTime = savedAt + 24 * 60 * 60 * 1000;
        } else if (value) {
          isValid = true;
          expiryTime = now + 24 * 60 * 60 * 1000;
        }
        if (isValid) {
          const normDom = domain
            .replace(/^www\./, "")
            .replace(/^\./, "")
            .toLowerCase();
          cookieCache[normDom] = cookieCache[normDom] || {};
          cookieCache[normDom][name] = { value, expiry: expiryTime };
        }
      }
    }
  } catch (e) {
    console.error("[proxyHeaders] Failed to init memory cache:", e.message);
  }
}

function updateCache(domain, name, value, expirationDate, local_saved_at) {
  if (!domain) return;
  const cleanDom = domain
    .replace(/^www\./, "")
    .replace(/^\./, "")
    .toLowerCase();
  console.log(
    `[proxyHeaders] updateCache called: domain=${domain}, cleanDom=${cleanDom}, name=${name}, hasValue=${!!value}`,
  );

  if (name === "user_agent") {
    uaCache[cleanDom] = value;
  } else if (name === "client_hints") {
    try {
      hintsCache[cleanDom] =
        typeof value === "string" ? JSON.parse(value) : value;
    } catch (e) {}
  } else if (name) {
    if (!value) {
      if (cookieCache[cleanDom]) {
        delete cookieCache[cleanDom][name];
      }
      return;
    }
    let exp = Number(expirationDate);
    if (exp > 0 && exp < 1e11) {
      exp = exp * 1000;
    }
    let savedAt = Number(local_saved_at);
    if (savedAt > 0 && savedAt < 1e11) {
      savedAt = savedAt * 1000;
    }
    const now = Date.now();
    let expiryTime = now + 24 * 60 * 60 * 1000;
    if (!isNaN(exp) && exp > now) {
      expiryTime = exp;
    } else if (
      !isNaN(savedAt) &&
      savedAt > 0 &&
      now - savedAt < 7 * 24 * 60 * 60 * 1000
    ) {
      expiryTime = savedAt + 24 * 60 * 60 * 1000;
    }
    cookieCache[cleanDom] = cookieCache[cleanDom] || {};
    cookieCache[cleanDom][name] = { value, expiry: expiryTime };
  }
}

function getHeaders(url, method = "GET") {
  let cookieDomain = "";
  try {
    cookieDomain = new URL(url).hostname;
  } catch (e) {}

  let cleanDomain = "";
  if (cookieDomain) {
    cleanDomain = cookieDomain.replace("www.", "").toLowerCase();
    // NOTE: do NOT force animepahe hosts to a single TLD. Each mirror
    // (.ng/.ch/.pw/.com/.org) has its own Cloudflare clearance + cookies.
    // Keep per-host so .pw cookies are used for .pw requests, etc.
    if (
      cleanDomain.includes("kwik.cx") ||
      cleanDomain.includes("owocdn.top") ||
      cleanDomain.includes("uwucdn.top")
    ) {
      cleanDomain = "kwik.cx";
    }
  }

  const chromeVer = process.versions.chrome || "148.0.7778.218";
  let userAgent = global.deviceUserAgent;
  if (!userAgent) {
    if (process.platform === "linux") {
      userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    } else if (process.platform === "darwin") {
      userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    } else if (process.platform === "win32") {
      userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    } else {
      userAgent = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Mobile Safari/537.36`;
    }
  }

  // Load custom User-Agent if bypassed
  if (cookieDomain) {
    const normTarget = cleanDomain.replace(/^\./, "").toLowerCase();
    let matchedUA = null;
    for (const [dom, uaVal] of Object.entries(uaCache)) {
      const normDom = dom.replace(/^\./, "").toLowerCase();
      if (normTarget === normDom || normTarget.endsWith("." + normDom)) {
        matchedUA = uaVal;
        break;
      }
    }
    if (matchedUA) {
      userAgent = matchedUA;
    }
  }

  const urlLower = String(url || "").toLowerCase();
  const isImage =
    urlLower.includes(".webp") ||
    urlLower.includes(".jpg") ||
    urlLower.includes(".jpeg") ||
    urlLower.includes(".png") ||
    urlLower.includes(".gif") ||
    urlLower.includes(".avif") ||
    urlLower.includes("/snapshots/") ||
    urlLower.includes("/uploads/") ||
    urlLower.includes("/posters/") ||
    urlLower.includes("/covers/");

  const headers = {
    "User-Agent": userAgent,
    Accept: isImage
      ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      : "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // Load Client Hints if bypassed
  if (cookieDomain) {
    const normTarget = cleanDomain.replace(/^\./, "").toLowerCase();
    let matchedHints = null;
    for (const [dom, hintsVal] of Object.entries(hintsCache)) {
      const normDom = dom.replace(/^\./, "").toLowerCase();
      if (normTarget === normDom || normTarget.endsWith("." + normDom)) {
        matchedHints = hintsVal;
        break;
      }
    }
    if (matchedHints) {
      for (const [k, v] of Object.entries(matchedHints)) {
        headers[k] = v;
      }
    }
  }

  // 1. Prioritize dynamically learned referer headers from extensions/scrapers/player
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    const ref = getStoredStreamReferer(domain);
    if (ref) headers.Referer = ref;
  } catch (e) {}

  // 2. Known static defaults (fallback if not dynamically stored yet)
  if (!headers.Referer) {
    if (
      url.includes("owocdn") ||
      url.includes("uwucdn") ||
      url.includes("kwik") ||
      url.includes("kwiktv")
    ) {
      headers.Referer = "https://kwik.cx/";
    } else if (
      url.includes("youtube-anime.com") ||
      url.includes("allmanga") ||
      url.includes("allanime")
    ) {
      headers.Referer = "https://allmanga.to/";
    } else if (
      url.includes("asurascans") ||
      url.includes("asura-images") ||
      url.includes("asuracomic")
    ) {
      headers.Referer = "https://asurascans.com/";
    } else if (
      url.includes("temp.compsci88.com") ||
      url.includes("weebcentral") ||
      url.includes("lastation.us")
    ) {
      headers.Referer = "https://weebcentral.com/";
    } else if (url.includes("mangafire")) {
      headers.Referer = "https://mangafire.to/";
    } else if (url.includes("comix")) {
      delete headers.Referer;
    } else if (url.includes("animepahe")) {
      try {
        headers.Referer = new URL(url).origin + "/";
      } catch (_) {
        headers.Referer = "https://animepahe.ng/";
      }
    } else if (url.includes("anikoto") || url.includes("megaplay.buzz")) {
      headers.Referer = "https://anikoto.to/";
    } else if (url.includes("anineko")) {
      headers.Referer = "https://anineko.to/";
    }
  }

  if (!headers.Referer && !url.includes("comix")) {
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol === "http:" || urlObj.protocol === "https:") {
        headers.Referer = urlObj.origin + "/";
      }
    } catch (e) {}
  }

  if (!headers.Referer) {
    if (refererCache["__fallback__"]) {
      headers.Referer = refererCache["__fallback__"];
    }
  }

  const targetDomains = Array.from(
    new Set([cleanDomain, cookieDomain].filter(Boolean)),
  ).map((d) =>
    d
      .replace(/^www\./, "")
      .replace(/^\./, "")
      .toLowerCase(),
  );

  if (targetDomains.length > 0) {
    const now = Date.now();
    const cookiePairs = [];
    const seenNames = new Set();

    for (const [dom, domCookies] of Object.entries(cookieCache)) {
      const normDom = dom
        .replace(/^www\./, "")
        .replace(/^\./, "")
        .toLowerCase();
      const isMatch = targetDomains.some(
        (normTarget) =>
          normTarget === normDom ||
          normTarget.endsWith("." + normDom) ||
          normDom.endsWith("." + normTarget),
      );
      if (isMatch) {
        if (domCookies && typeof domCookies === "object") {
          for (const [cookieName, cookieObj] of Object.entries(domCookies)) {
            if (!seenNames.has(cookieName) && cookieObj?.value) {
              if (!cookieObj.expiry || cookieObj.expiry > now) {
                seenNames.add(cookieName);
                cookiePairs.push(`${cookieName}=${cookieObj.value}`);
              }
            }
          }
        }
      }
    }
    if (cookiePairs.length > 0) {
      headers.Cookie = cookiePairs.join("; ");
    }
  }

  const reqMethod = String(method).toUpperCase();
  if (headers.Referer && reqMethod !== "GET" && reqMethod !== "HEAD") {
    try {
      const refUrl = new URL(headers.Referer);
      if (refUrl.protocol === "http:" || refUrl.protocol === "https:") {
        headers.Origin = refUrl.origin;
      }
    } catch (e) {}
  }

  return headers;
}

global.clearCookieCache = (domain) => {
  if (!domain) return;
  const normalized = domain
    .replace(/^www\./, "")
    .replace(/^\./, "")
    .toLowerCase();
  for (const key of Object.keys(cookieCache)) {
    const normKey = key
      .replace(/^www\./, "")
      .replace(/^\./, "")
      .toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete cookieCache[key];
    }
  }
  for (const key of Object.keys(uaCache)) {
    const normKey = key.replace(/^www\./, "").toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete uaCache[key];
    }
  }
  for (const key of Object.keys(hintsCache)) {
    const normKey = key.replace(/^www\./, "").toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete hintsCache[key];
    }
  }
};

if (global.db) {
  initCache().catch(() => {});
}

module.exports = {
  getHeaders,
  initCache,
  updateCache,
};
