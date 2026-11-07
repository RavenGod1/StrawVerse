// ---------------------------------------------------------------------------
// AniList extras for the info page: Anime "Seasons" (sequel/prequel chain)
// and Recommendations. Source: AniList GraphQL (no auth, no API key).
// Responses are cached in memory so a title is only queried once in a while.
// ---------------------------------------------------------------------------

const { logger } = require("./AppLogger");

const ANILIST_GRAPHQL = "https://graphql.anilist.co";
const EXTRAS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const EXTRAS_CACHE_MAX = 300;
const EXTRAS_MAX_HOPS = 8; // max sequel/prequel hops per title
const EXTRAS_MAX_PER_HOP = 8; // max related titles queried per hop
const extrasCache = new Map();

// Only these formats count as a "season" of a show (movies/OVAs excluded).
const SEASON_FORMATS = new Set(["TV", "TV_SHORT", "ONA", "TV_SPECIAL"]);

const ANILIST_MEDIA_FIELDS = `
  id
  idMal
  type
  format
  title { romaji english }
  startDate { year month day }
  episodes
  averageScore
  coverImage { large medium }
`;

const ANILIST_SEED_QUERY = `
  query ($idMal: Int, $search: String, $type: MediaType) {
    Media(idMal: $idMal, search: $search, type: $type) {
      ${ANILIST_MEDIA_FIELDS}
      relations {
        edges {
          relationType
          node { ${ANILIST_MEDIA_FIELDS} }
        }
      }
      recommendations {
        edges {
          node {
            mediaRecommendation { ${ANILIST_MEDIA_FIELDS} }
          }
        }
      }
    }
  }
`;

async function anilistPost(query, variables = {}) {
  const axiosClient = global.axios || require("axios");
  const resp = await axiosClient.post(
    ANILIST_GRAPHQL,
    { query, variables },
    {
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );
  const body = resp.data || {};
  if (Array.isArray(body.errors) && body.errors.length) {
    throw new Error(body.errors[0]?.message || "AniList query failed");
  }
  return body.data || {};
}

function extrasCacheGet(key) {
  const hit = extrasCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    extrasCache.delete(key);
    return null;
  }
  return hit.value;
}

function extrasCacheSet(key, value) {
  if (extrasCache.size >= EXTRAS_CACHE_MAX) {
    const oldest = extrasCache.keys().next().value;
    if (oldest !== undefined) extrasCache.delete(oldest);
  }
  extrasCache.set(key, { expires: Date.now() + EXTRAS_CACHE_TTL, value });
}

function shapeAnilistMedia(node, currentId) {
  if (!node || !node.id) return null;
  const start = node.startDate || {};
  return {
    id: node.id,
    idMal: node.idMal || null,
    type: node.type || null,
    title:
      node.title?.romaji || node.title?.english || node.title?.native || "",
    year: start.year || null,
    sortKey:
      (start.year || 9999) * 10000 + (start.month || 6) * 100 + (start.day || 15),
    format: node.format || null,
    episodes: node.episodes || null,
    score: node.averageScore ?? null,
    image: node.coverImage?.large || node.coverImage?.medium || null,
    current: currentId != null && String(node.id) === String(currentId),
  };
}

function isSeasonRelation(edge) {
  return edge?.relationType === "SEQUEL" || edge?.relationType === "PREQUEL";
}

// One request for a whole level of the chain: `m0: Media(id: 1) { ... } m1: ...`
async function anilistRelationsBatch(ids) {
  if (!ids.length) return [];
  const fields = ANILIST_MEDIA_FIELDS;
  const parts = ids.map(
    (mediaId, i) =>
      `m${i}: Media(id: ${Number(mediaId)}) { ${fields} relations { edges { relationType node { ${fields} } } } }`,
  );
  const data = await anilistPost(`query { ${parts.join("\n")} }`, {});
  return ids.map((_, i) => data[`m${i}`] || null);
}

async function buildSeasons(seed, seedRelations) {
  const seasonMap = new Map();
  const visited = new Set([String(seed.id)]);
  const seedSeason = shapeAnilistMedia(seed, seed.id);
  if (seedSeason && SEASON_FORMATS.has(seedSeason.format)) {
    seasonMap.set(String(seed.id), seedSeason);
  }

  let frontier = (seedRelations || [])
    .filter(isSeasonRelation)
    .map((edge) => edge.node)
    .filter((node) => node && !visited.has(String(node.id)));

  let hops = 0;
  while (frontier.length && hops < EXTRAS_MAX_HOPS) {
    hops += 1;
    const toFetch = [];
    for (const node of frontier) {
      if (visited.has(String(node.id))) continue;
      visited.add(String(node.id));
      const shaped = shapeAnilistMedia(node, seed.id);
      if (
        shaped &&
        shaped.type === "ANIME" &&
        SEASON_FORMATS.has(shaped.format)
      ) {
        seasonMap.set(String(node.id), shaped);
        toFetch.push(node.id);
      }
    }
    if (!toFetch.length) break;

    const linked = await anilistRelationsBatch(
      toFetch.slice(0, EXTRAS_MAX_PER_HOP),
    );
    const next = [];
    for (const parent of linked) {
      if (!parent) continue;
      for (const edge of parent.relations?.edges || []) {
        if (!isSeasonRelation(edge)) continue;
        const node = edge.node;
        if (!node || visited.has(String(node.id))) continue;
        next.push(node);
      }
    }
    frontier = next;
  }

  return Array.from(seasonMap.values()).sort((a, b) => a.sortKey - b.sortKey);
}

async function buildExtras({ malid, title, type }) {
  const normalizedType = type === "Manga" ? "Manga" : "Anime";
  const cacheKey = `${normalizedType}:${
    Number.isInteger(Number(malid)) && Number(malid) > 0
      ? `mal:${Number(malid)}`
      : `t:${String(title || "").trim().toLowerCase()}`
  }`;
  const cached = extrasCacheGet(cacheKey);
  if (cached) return cached;

  const variables = { type: normalizedType === "Manga" ? "MANGA" : "ANIME" };
  const numericMalid = Number(malid);
  if (Number.isInteger(numericMalid) && numericMalid > 0) {
    variables.idMal = numericMalid;
  } else if (title) {
    variables.search = String(title).trim();
  }

  let data = await anilistPost(ANILIST_SEED_QUERY, variables);
  let seed = data?.Media || null;
  // MAL id with no AniList entry: fall back to a title search
  if (!seed && variables.idMal && title) {
    const retry = { type: variables.type, search: String(title).trim() };
    data = await anilistPost(ANILIST_SEED_QUERY, retry);
    seed = data?.Media || null;
  }
  if (!seed) {
    const empty = { seasons: [], recommendations: [] };
    extrasCacheSet(cacheKey, empty);
    return empty;
  }

  const wantedType = normalizedType === "Manga" ? "MANGA" : "ANIME";
  const recommendations = (seed.recommendations?.edges || [])
    .map((edge) => shapeAnilistMedia(edge?.node?.mediaRecommendation, seed.id))
    .filter((item) => item && item.type === wantedType)
    .slice(0, 12);

  const seasons = await buildSeasons(seed, seed.relations?.edges);
  const payload = { seasons, recommendations };
  extrasCacheSet(cacheKey, payload);
  logger.info(
    `[anilistExtras] ${cacheKey}: ${seasons.length} season(s), ${recommendations.length} recommendation(s)`,
  );
  return payload;
}

module.exports = { buildExtras };
