/**
 * StrawVerse Extension Registry
 * Completely generic registry. Contains ZERO hardcoded website names or domains.
 * All header rules, subrequest headers, bypass domains, domain aliases,
 * and challenge handlers are provided by extensions loaded from extensions/.
 */

const { URL } = require("url");

// Registered extensions by name (populated dynamically when scrapers are loaded)
const registeredExtensions = new Map();

// Dynamic subrequest / stream headers registered at runtime (e.g. when an extension resolves a stream server)
// key: string (domain, hostname, or pattern e.g. "imgnex.top")
// value: { headers: object, expiresAt: number }
const dynamicSubrequestHeaders = new Map();

/**
 * Register an extension (scraper module) with the registry.
 * Reads declarative configurations exported by the extension.
 *
 * @param {object} ext - Extension module
 */
function registerExtension(ext) {
  if (!ext || !ext.name) return;
  registeredExtensions.set(ext.name, ext);
}

/**
 * Unregister an extension by name.
 * @param {string} name
 */
function unregisterExtension(name) {
  registeredExtensions.delete(name);
}

/**
 * Clear all registered extensions (called before reloading scrapers).
 */
function clearRegisteredExtensions() {
  registeredExtensions.clear();
  dynamicSubrequestHeaders.clear();
}

/**
 * Dynamically register subrequest headers for a domain or pattern at runtime.
 * Useful when an extension discovers a streaming server or CDN URL dynamically.
 *
 * @param {string} domainOrPattern - Domain or URL pattern (e.g. "imgnex.top")
 * @param {object} headers - Headers to attach (e.g. { Referer: "https://megaplay.buzz/" })
 * @param {number} [ttlMs=3600000] - Time to live in ms (default 1 hour)
 */
function registerSubrequestHeaders(domainOrPattern, headers, ttlMs = 3600000) {
  if (!domainOrPattern || !headers || typeof headers !== "object") return;
  const key = String(domainOrPattern)
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!key) return;

  dynamicSubrequestHeaders.set(key, {
    headers: { ...headers },
    expiresAt: Date.now() + ttlMs,
  });

  // Also persist to StreamReferer if Referer is present
  const ref = headers.Referer || headers.referer;
  if (ref && typeof global.setDynamicReferer === "function") {
    try {
      global.setDynamicReferer(key, ref);
    } catch (_) {}
  }
}

function ruleMatches(rule, lowerUrl, domain) {
  if (!rule) return false;
  const match = rule.match || rule.domains || rule.domain;
  if (!match) return false;
  const patterns = Array.isArray(match) ? match : [match];
  return patterns.some((p) => {
    if (p instanceof RegExp) return p.test(lowerUrl);
    const lp = String(p).toLowerCase();
    return (
      lowerUrl.includes(lp) ||
      (domain && (domain === lp || domain.endsWith("." + lp)))
    );
  });
}

/**
 * Get headers and strip rules for a target URL from registered extensions.
 * Checks dynamic subrequest headers and registered extension declarative rules.
 *
 * @param {string} url - Target request URL
 * @returns {{ headers: object, strip: string[] }}
 */
function getExtensionHeaderRules(url) {
  if (!url) return { headers: {}, strip: [] };
  const lowerUrl = String(url).toLowerCase();
  let domain = "";
  try {
    domain = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_) {}

  const resultHeaders = {};
  const stripHeaders = [];

  // 1. Check dynamic runtime subrequest headers first
  const now = Date.now();
  for (const [pattern, entry] of dynamicSubrequestHeaders.entries()) {
    if (entry.expiresAt && now > entry.expiresAt) {
      dynamicSubrequestHeaders.delete(pattern);
      continue;
    }
    if (
      lowerUrl.includes(pattern) ||
      (domain && (domain === pattern || domain.endsWith("." + pattern)))
    ) {
      Object.assign(resultHeaders, entry.headers);
    }
  }

  // 2. Check each registered extension
  for (const ext of registeredExtensions.values()) {
    // A. Subrequest headers
    if (Array.isArray(ext.subrequestHeaders)) {
      for (const rule of ext.subrequestHeaders) {
        if (ruleMatches(rule, lowerUrl, domain)) {
          if (rule.headers) Object.assign(resultHeaders, rule.headers);
          if (Array.isArray(rule.strip)) stripHeaders.push(...rule.strip);
        }
      }
    } else if (
      ext.subrequestHeaders &&
      typeof ext.subrequestHeaders === "object"
    ) {
      for (const [pattern, hdrs] of Object.entries(ext.subrequestHeaders)) {
        const lp = pattern.toLowerCase();
        if (
          lowerUrl.includes(lp) ||
          (domain && (domain === lp || domain.endsWith("." + lp)))
        ) {
          Object.assign(resultHeaders, hdrs);
        }
      }
    }

    // B. General request header rules
    if (Array.isArray(ext.headerRules)) {
      for (const rule of ext.headerRules) {
        if (ruleMatches(rule, lowerUrl, domain)) {
          if (rule.headers) Object.assign(resultHeaders, rule.headers);
          if (Array.isArray(rule.strip)) stripHeaders.push(...rule.strip);
        }
      }
    }

    // C. Dynamic getHeaders hook on the extension
    if (typeof ext.getHeaders === "function") {
      try {
        const custom = ext.getHeaders(url);
        if (custom && typeof custom === "object") {
          Object.assign(resultHeaders, custom);
        }
      } catch (_) {}
    }
  }

  return { headers: resultHeaders, strip: stripHeaders };
}

/**
 * Get cookie domain aliases / shared domains for a domain from registered extensions.
 */
function getCookieDomains(cleanDomain) {
  if (!cleanDomain) return [];
  const targetDomains = [];
  for (const ext of registeredExtensions.values()) {
    if (Array.isArray(ext.cookieDomains)) {
      const match = ext.cookieDomains.some((d) =>
        cleanDomain.includes(d.toLowerCase()),
      );
      if (match) {
        targetDomains.push(...ext.cookieDomains);
      }
    }
    if (ext.domainAliases && typeof ext.domainAliases === "object") {
      for (const [alias, canonical] of Object.entries(ext.domainAliases)) {
        if (cleanDomain.includes(alias.toLowerCase())) {
          targetDomains.push(canonical);
        }
      }
    }
  }
  return targetDomains;
}

/**
 * Get canonical domain alias (e.g. owocdn.top -> kwik.cx) from registered extensions.
 */
function getCanonicalDomain(cleanDomain) {
  if (!cleanDomain) return cleanDomain;
  for (const ext of registeredExtensions.values()) {
    if (ext.domainAliases && typeof ext.domainAliases === "object") {
      for (const [alias, canonical] of Object.entries(ext.domainAliases)) {
        if (cleanDomain.includes(alias.toLowerCase())) {
          return canonical;
        }
      }
    }
  }
  return cleanDomain;
}

/**
 * Check if a URL or referer is bypassable according to registered extensions.
 */
function isBypassableUrl(urlStr, refererStr) {
  const url = String(urlStr || "").toLowerCase();
  const ref = String(refererStr || "").toLowerCase();

  for (const ext of registeredExtensions.values()) {
    const list = ext.bypassDomains || [];
    for (const d of list) {
      const ld = String(d).toLowerCase();
      if (url.includes(ld) || ref.includes(ld)) return true;
    }
  }
  return false;
}

/**
 * Check if a destination page is loaded after bypass using extension hooks.
 */
function isExtensionPageLoaded(domain, title, html) {
  if (!html) return false;
  const lowerDomain = String(domain || "").toLowerCase();
  for (const ext of registeredExtensions.values()) {
    if (typeof ext.isPageLoaded === "function") {
      const matches =
        (ext.name && lowerDomain.includes(ext.name.toLowerCase())) ||
        (ext.bypassDomains &&
          ext.bypassDomains.some((d) =>
            lowerDomain.includes(String(d).toLowerCase()),
          )) ||
        (ext.baseUrl &&
          lowerDomain.includes(new URL(ext.baseUrl).hostname.toLowerCase()));
      if (matches) {
        try {
          if (ext.isPageLoaded(title, html)) return true;
        } catch (_) {}
      }
    }
  }
  return false;
}

// Expose globals for extensions to use
global.registerExtension = registerExtension;
global.registerSubrequestHeaders = registerSubrequestHeaders;
global.registerStreamHeaders = registerSubrequestHeaders;

module.exports = {
  registerExtension,
  unregisterExtension,
  clearRegisteredExtensions,
  registerSubrequestHeaders,
  getExtensionHeaderRules,
  getCookieDomains,
  getCanonicalDomain,
  isBypassableUrl,
  isExtensionPageLoaded,
};
