// English Wikipedia (MediaWiki Action API) access: batched wikitext + page metadata (≤ 50 titles
// per request, redirects resolved, maxlag=5, ≤ 4 requests/second) and category listings. Page
// results are cached per title on disk, so adding a show only fetches that show.
import { postForm, createThrottle } from './http.js';

const API = 'https://en.wikipedia.org/w/api.php';
const BATCH = 50;

export function createWikipedia({ cache, log = () => {} }) {
  const throttle = createThrottle(260);
  const stats = { requests: 0 };

  async function api(params) {
    const form = { format: 'json', formatversion: '2', maxlag: '5', errorformat: 'plaintext', ...params };
    const key = new URLSearchParams(Object.entries(form).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString();
    const cached = cache.get('mw', key);
    if (cached) return cached;
    if (cache.offline) throw new Error(`offline: MediaWiki request not cached: ${key.slice(0, 200)}`);
    let json;
    await postForm(API, form, {
      throttle, log: (m) => log(`  [wikipedia] ${m}`),
      validate: (text, res) => {
        let j;
        try { j = JSON.parse(text); } catch { throw new Error('invalid JSON from the MediaWiki API'); }
        const code = j.error?.code ?? j.errors?.[0]?.code;
        if (code === 'maxlag' || code === 'ratelimited' || code === 'internal_api_error_DBQueryTimeoutError') {
          const e = new Error(`API ${code}`); e.retryAfterMs = Math.max(Number(res.headers.get('retry-after') || 5), 1) * 1000; throw e;
        }
        if (code) { const e = new Error(`MediaWiki API error ${code}: ${JSON.stringify(j.error ?? j.errors).slice(0, 300)}`); e.fatal = true; throw e; }
        json = j;
      },
    });
    stats.requests++;
    cache.set('mw', key, json);
    return json;
  }

  /** Follow `continue` and return every response. */
  async function apiAll(params) {
    const out = []; let cont = {};
    for (let guard = 0; guard < 500; guard++) {
      const j = await api({ ...params, ...cont });
      out.push(j);
      if (!j.continue) break;
      cont = j.continue;
    }
    return out;
  }

  /** Map requested → resolved title (normalisation, then redirects). */
  function resolver(responses) {
    const norm = new Map(); const redir = new Map();
    for (const j of responses) {
      for (const n of j.query?.normalized ?? []) norm.set(n.from, n.to);
      for (const r of j.query?.redirects ?? []) redir.set(r.from, { to: r.to, fragment: r.tofragment ?? null });
    }
    return (t) => {
      const n = norm.get(t) ?? t;
      const r = redir.get(n);
      return { title: r ? r.to : n, redirected: Boolean(r), fragment: r?.fragment ?? null };
    };
  }

  /**
   * Generic per-title cached batch fetch. build(pageObjects merged by title, resolve) → per-title record.
   */
  async function perTitle(ns, titles, params, merge) {
    const out = new Map(); const todo = [];
    for (const t of [...new Set(titles)]) {
      const c = cache.get(ns, t);
      if (c) out.set(t, c); else todo.push(t);
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      if (i === 0 || (i / BATCH) % 10 === 0) log(`  [wikipedia ${ns}] ${i}/${todo.length} titles to fetch`);
      const responses = await apiAll({ action: 'query', titles: batch.join('|'), redirects: '1', ...params });
      const resolve = resolver(responses);
      const pages = new Map();
      for (const j of responses) {
        for (const p of j.query?.pages ?? []) {
          const prev = pages.get(p.title);
          pages.set(p.title, prev ? merge(prev, p) : p);
        }
      }
      for (const t of batch) {
        const r = resolve(t);
        const p = pages.get(r.title);
        const rec = { requested: t, title: r.title, redirected: r.redirected, fragment: r.fragment, missing: !p || Boolean(p.missing) || Boolean(p.invalid), page: p ?? null };
        cache.set(ns, t, rec);
        out.set(t, rec);
      }
    }
    return out;
  }

  const mergeArrays = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (Array.isArray(v) && Array.isArray(o[k])) o[k] = [...o[k], ...v];
      else if (v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object') o[k] = { ...o[k], ...v };
      else if (o[k] === undefined) o[k] = v;
    }
    return o;
  };

  return {
    stats,
    api,
    apiAll,
    /**
     * Wikitext of many pages → Map(requested title → { title, redirected, fragment, missing,
     * pageid, revid, timestamp, content }).
     */
    async fetchPages(titles) {
      const res = await perTitle('page', titles, { prop: 'revisions', rvprop: 'content|ids|timestamp', rvslots: 'main' }, mergeArrays);
      const out = new Map();
      for (const [t, r] of res) {
        const rev = r.page?.revisions?.[0];
        out.set(t, {
          requested: t, title: r.title, redirected: r.redirected, fragment: r.fragment,
          missing: r.missing || !rev, pageid: r.page?.pageid ?? null, revid: rev?.revid ?? null,
          timestamp: rev?.timestamp ?? null, content: rev?.slots?.main?.content ?? null,
        });
      }
      return out;
    },
    /**
     * Metadata of many pages → Map(requested title → { title, redirected, missing, pageid, qid,
     * disambiguation, categories[], redirects[] (titles of redirects to the page, without fragment) }).
     */
    async fetchMeta(titles) {
      const res = await perTitle('meta', titles, {
        prop: 'categories|pageprops|redirects', cllimit: 'max', clshow: '!hidden', ppprop: 'wikibase_item|disambiguation',
        rdlimit: 'max', rdprop: 'title|fragment', rdnamespace: '0',
      }, mergeArrays);
      const out = new Map();
      for (const [t, r] of res) {
        const p = r.page ?? {};
        out.set(t, {
          requested: t, title: r.title, redirected: r.redirected, fragment: r.fragment, missing: r.missing,
          pageid: p.pageid ?? null, qid: p.pageprops?.wikibase_item ?? null,
          disambiguation: p.pageprops?.disambiguation !== undefined,
          categories: [...new Set((p.categories ?? []).map((c) => c.title.replace(/^Category:/, '')))].sort(),
          redirects: [...new Set((p.redirects ?? []).filter((x) => !x.fragment).map((x) => x.title))].sort(),
        });
      }
      return out;
    },
    /** Articles (ns 0) in a category → [{ title, qid }]. */
    async categoryArticles(cat) {
      const res = await apiAll({ action: 'query', generator: 'categorymembers', gcmtitle: cat, gcmnamespace: '0', gcmlimit: 'max', prop: 'pageprops', ppprop: 'wikibase_item' });
      const out = new Map();
      for (const j of res) for (const p of j.query?.pages ?? []) out.set(p.title, { title: p.title, qid: p.pageprops?.wikibase_item ?? null });
      return [...out.values()].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    },
    /** Sub-categories of a category → titles. */
    async subcategories(cat) {
      const res = await apiAll({ action: 'query', list: 'categorymembers', cmtitle: cat, cmtype: 'subcat', cmlimit: 'max' });
      return res.flatMap((j) => j.query?.categorymembers ?? []).map((c) => c.title).sort();
    },
  };
}
