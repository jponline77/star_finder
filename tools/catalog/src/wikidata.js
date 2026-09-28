// Wikidata Query Service access (CC0 data): the show selection (query A), class flags (C),
// statements (B), labels/aliases/descriptions (D) and facts for extra items (E). Every response
// is validated (the service can answer HTTP 200 with a truncated body after a server-side
// timeout) and cached on disk.
import fs from 'node:fs';
import { postForm, createThrottle } from './http.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const QUERIES = new URL('./queries/', import.meta.url);
const readQuery = (name) => fs.readFileSync(new URL(name, QUERIES), 'utf8');
const ENTITY = 'http://www.wikidata.org/entity/';
const CHUNK = 500;

export const qidNum = (q) => Number(String(q).slice(1));
export const byQid = (a, b) => qidNum(a) - qidNum(b);

export function createWikidata({ cache, log = () => {} }) {
  const throttle = createThrottle(1500); // a handful of queries, one at a time
  const stats = { requests: 0 };

  async function sparql(query, label) {
    const cached = cache.get('sparql', query);
    if (cached) return cached;
    if (cache.offline) throw new Error(`offline: SPARQL "${label}" is not cached`);
    const t0 = Date.now();
    let rows;
    await postForm(ENDPOINT, { query }, {
      throttle, log: (m) => log(`  [wikidata ${label}] ${m}`), accept: 'application/sparql-results+json',
      validate: (text) => {
        let j;
        try { j = JSON.parse(text); } catch {
          const e = new Error('truncated/invalid JSON from the query service (server-side timeout?)'); e.retryAfterMs = 30000; throw e;
        }
        if (!j?.results?.bindings) throw new Error('unexpected SPARQL response shape');
        rows = j.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.type === 'uri' && v.value.startsWith(ENTITY) ? v.value.slice(ENTITY.length) : v.value])));
      },
    });
    stats.requests++;
    log(`  [wikidata ${label}] ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    cache.set('sparql', query, rows);
    return rows;
  }

  const values = (qids) => [...qids].sort(byQid).map((q) => `wd:${q}`).join(' ');
  async function chunked(template, qids, label) {
    const sorted = [...new Set(qids)].sort(byQid);
    const out = [];
    for (let i = 0; i < sorted.length; i += CHUNK) {
      const q = readQuery(template).replace('%QIDS%', values(sorted.slice(i, i + CHUNK)));
      out.push(...await sparql(q, `${label} ${i / CHUNK + 1}/${Math.ceil(sorted.length / CHUNK)}`));
    }
    return out;
  }

  return {
    stats,
    /** Query A: candidate stage musicals/operettas/revues with an enwiki article. */
    select: () => sparql(readQuery('select.rq'), 'select'),
    /** Query C: film/TV/stage flags for P31 classes. */
    classFlags: async (classes) => {
      const list = [...new Set(classes)].filter((c) => /^Q\d+$/.test(c)).sort(byQid);
      if (!list.length) return {};
      const rows = await sparql(readQuery('class-flags.rq').replace('%CLASSES%', values(list)), 'class flags');
      return Object.fromEntries(rows.map((r) => [r.c, { isFilm: r.isFilm === 'true', isTV: r.isTV === 'true', isStage: r.isStage === 'true' }]));
    },
    /** Query B: one row per statement value (credits, dates, genres, forms, characters, P31). */
    statements: (qids) => chunked('statements.rq', qids, 'statements'),
    /** Query D: English/mul labels, aliases and descriptions. */
    labels: (qids) => chunked('labels.rq', qids, 'labels'),
    /** Query E: P31/forms/description/enwiki title for extra items. */
    itemInfo: (qids) => chunked('item-info.rq', qids, 'item info'),
  };
}
