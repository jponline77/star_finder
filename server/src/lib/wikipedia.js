// Wikipedia REST page/summary lookup for show info (used when adding a new show).
const SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
export const WIKI_USER_AGENT = 'STARSongFinder/1.0 (school musical theatre song finder; https://taeacanada.ca/regional-star-fest/)';
const THEATRE_RE = /\b(musical|musicals|opera|operetta|play|theatre|theater|broadway|west end|stage show)\b/i;

/**
 * @typedef {{ found: boolean, title?: string, description?: string|null, extract?: string|null, imageUrl?: string|null, wikiUrl?: string|null }} WikiResult
 */

async function fetchSummary(title, fetchImpl) {
  const url = SUMMARY_URL + encodeURIComponent(title.replace(/ /g, '_')) + '?redirect=true';
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': WIKI_USER_AGENT, 'Api-User-Agent': WIKI_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipedia request failed (HTTP ${res.status})`);
  return res.json();
}

function isWikimediaImage(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname === 'upload.wikimedia.org';
  } catch {
    return false;
  }
}

/**
 * Look up a stage show on English Wikipedia. Tries "<name> (musical)" first, then "<name>".
 * Only accepts non-disambiguation pages whose description/extract mentions musical/opera/play/theatre.
 * @param {string} name
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<WikiResult>}
 */
export async function lookupWikipedia(name, fetchImpl = globalThis.fetch) {
  const clean = String(name ?? '').trim();
  if (!clean) return { found: false };
  const tries = /\(musical\)\s*$/i.test(clean) ? [clean] : [`${clean} (musical)`, clean];
  let lastError = null;
  for (const title of tries) {
    let data;
    try {
      data = await fetchSummary(title, fetchImpl);
    } catch (err) {
      lastError = err;
      continue;
    }
    if (!data || data.type === 'disambiguation') continue;
    const description = data.description ?? null;
    const extract = data.extract ?? null;
    if (!THEATRE_RE.test(`${description ?? ''} ${extract ?? ''}`)) continue;
    const img = data.originalimage?.source ?? data.thumbnail?.source ?? null;
    return {
      found: true,
      title: data.title ?? title,
      description,
      extract,
      imageUrl: img && isWikimediaImage(img) ? img : null,
      wikiUrl: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent((data.title ?? title).replace(/ /g, '_'))}`,
    };
  }
  if (lastError) throw lastError;
  return { found: false };
}
