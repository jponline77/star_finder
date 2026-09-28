#!/usr/bin/env node
// Builds server/seed/catalog/catalog.json.gz (+ stats.json, README.md) from Wikidata and English
// Wikipedia. Usage: node src/build.js [--refresh] [--offline] [--only "Title|Title"] [--out DIR] [--accept-review]
//   --refresh  ignore the on-disk cache (tools/catalog/.cache) and re-download everything
//   --offline  use only the cache (fails if something is missing)
//   --only     build just these Wikipedia titles (debugging; never overwrites the real catalog
//              unless --out is given)
//   --accept-review  write the catalog even though the vandalism gate flagged changes (after checking them)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DiskCache } from './http.js';
import { createWikidata, byQid } from './wikidata.js';
import { createWikipedia } from './wikipedia.js';
import { decide, decideFallback, kindOf, rescueStageArticle } from './rules.js';
const split = (x) => String(x || '').split(' ').filter(Boolean);
import { parseArticle, parseSubpage, infoboxYears } from './parse-songs.js';
import { stageInfobox, stripComments } from './wikitext.js';
import {
  displayTitle, creditNames, joinNames, groupStatements, wdNames, wikidataYear, categoryYear, genresOf, altTitlesOf, leadCredits,
} from './shows.js';
import { validateCatalog } from './format.js';
import { fold, isGroupName } from './normalize.js';
import { contentHash, chooseVersion, readLedger, recordVersion } from './version.js';
import { compareCatalogs, renderDiff } from './review-gate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const DEFAULT_OUT = path.join(REPO, 'server', 'seed', 'catalog');
const LEDGER = path.join(ROOT, 'versions.json'); // committed
const LOCAL_LEDGER = path.join(ROOT, '.cache', 'versions-issued.json');

const EXTRA_CATEGORIES = [
  'Category:Broadway musicals', 'Category:West End musicals', 'Category:Off-Broadway musicals', 'Category:Jukebox musicals',
  'Category:Rock musicals', 'Category:Sung-through musicals', 'Category:Musicals based on films', 'Category:Musicals based on novels',
  'Category:British musicals', 'Category:American musicals', 'Category:Canadian musicals', 'Category:Australian musicals',
  'Category:Operettas', 'Category:Revues',
  // comic operas / operettas that Wikidata types only as "opera" (Iolanthe, The Sorcerer, Orpheus in the Underworld …)
  'Category:Operas by Gilbert and Sullivan', 'Category:Savoy operas', 'Category:Operas by Arthur Sullivan',
  'Category:English comic operas', 'Category:Opéras bouffes', 'Category:Operas by Jacques Offenbach',
  'Category:Operettas by Johann Strauss II', 'Category:Operettas by Franz Lehár', 'Category:Operettas by Victor Herbert',
  'Category:Operettas by Sigmund Romberg', 'Category:Operas by Edward German',
];

// the 30 spot-check shows from the research (by enwiki title) — reported in stats.json
export const SPOT_CHECK = ['Hamilton (musical)', 'Wicked (musical)', 'Les Misérables (musical)', 'Six (musical)', 'Heathers: The Musical',
  'Be More Chill (musical)', 'Hadestown', 'Newsies (musical)', 'Matilda the Musical', 'Mean Girls (musical)', 'Beetlejuice (musical)',
  'Dear Evan Hansen', 'Waitress (musical)', 'Come from Away', 'Anastasia (musical)', 'Frozen (musical)', 'Into the Woods', 'Guys and Dolls',
  'Oklahoma!', 'Rent (musical)', 'Spring Awakening (musical)', 'In the Heights', 'Legally Blonde (musical)', 'The Prom (musical)',
  'Bring It On: The Musical', 'Kinky Boots (musical)', 'Next to Normal', 'Something Rotten!', 'Shrek the Musical', 'Operation Mincemeat (musical)'];

function parseArgs(argv) {
  const a = { refresh: false, offline: false, only: null, out: null, acceptReview: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--refresh') a.refresh = true;
    else if (x === '--offline') a.offline = true;
    else if (x === '--only') a.only = argv[++i].split('|').map((s) => s.trim()).filter(Boolean);
    else if (x.startsWith('--only=')) a.only = x.slice(7).split('|').map((s) => s.trim()).filter(Boolean);
    else if (x === '--accept-review') a.acceptReview = true;
    else if (x === '--out') a.out = argv[++i];
    else if (x.startsWith('--out=')) a.out = x.slice(6);
    else if (x === '--help' || x === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n')); process.exit(0); }
    else throw new Error(`unknown argument ${x}`);
  }
  return a;
}

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${m}`);
const count = (arr, f) => arr.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
const tally = (arr) => Object.fromEntries(Object.entries(arr.reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m; }, {})).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)));
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.out ?? (args.only ? path.join(ROOT, '.cache', 'out-only') : DEFAULT_OUT));
  const cache = new DiskCache(path.join(ROOT, '.cache'), { refresh: args.refresh, offline: args.offline });
  const wd = createWikidata({ cache, log });
  const wp = createWikipedia({ cache, log });
  const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, 'overrides.json'), 'utf8'));
  const forceInclude = new Set(Object.keys(overrides.forceInclude || {}));
  const forceExclude = new Set(Object.keys(overrides.forceExclude || {}));
  const preferList = overrides.preferList || {};
  const review = { excluded: [], rescued: [], dropped: [], gateRejected: [], fallbackAdded: [], subpages: [], unknownTemplates: {}, lyricTitlesDropped: [], listOverrides: [] };

  // 1. Wikidata selection (query A)
  log('Wikidata: selecting stage musicals, operettas and revues …');
  const aRows = await wd.select();
  const aByQid = new Map(aRows.map((r) => [r.item, r]));

  // 2. Wikipedia musical categories (fallback for items Wikidata misses)
  log('Wikipedia: reading the musical categories …');
  const yearCats = (await wp.subcategories('Category:Musicals by year')).filter((c) => /^Category:\d{4} musicals$/.test(c));
  const catPages = new Map();
  for (const cat of [...yearCats, ...EXTRA_CATEGORIES]) {
    for (const p of await wp.categoryArticles(cat)) {
      const o = catPages.get(p.title) ?? { title: p.title, qid: p.qid, cats: [] };
      o.cats.push(cat.replace(/^Category:/, ''));
      catPages.set(p.title, o);
    }
  }
  log(`  ${yearCats.length} year categories + ${EXTRA_CATEGORIES.length} others → ${catPages.size} articles`);

  // 3. facts for fallback candidates and forced items (query E), class flags (query C)
  const candidates = [...catPages.values()].filter((p) => !p.qid || !aByQid.has(p.qid));
  const eQids = [...new Set([...candidates.map((p) => p.qid).filter(Boolean), ...[...forceInclude].filter((q) => !aByQid.has(q))])];
  const eRows = await wd.itemInfo(eQids);
  const eByQid = new Map();
  for (const r of eRows) if (!eByQid.has(r.item) || (r.enwiki && !eByQid.get(r.item).enwiki)) eByQid.set(r.item, r);
  const classes = new Set([...aRows, ...eRows].flatMap((r) => String(r.p31 || '').split(' ').filter(Boolean)));
  const flags = await wd.classFlags(classes);

  // 4. include / exclude
  const selected = new Map(); // qid-or-title → { qid, enwiki, kind, source, reason, forced }
  const excludedByRules = new Set();
  for (const r of [...aRows].sort((x, y) => byQid(x.item, y.item))) {
    const d = decide(r, flags);
    if (forceExclude.has(r.item)) { review.excluded.push({ qid: r.item, title: r.enwiki, reason: `override: ${overrides.forceExclude[r.item]}` }); continue; }
    if (!d.include && !forceInclude.has(r.item)) { excludedByRules.add(r.item); review.excluded.push({ qid: r.item, title: r.enwiki, reason: d.reason }); continue; }
    selected.set(r.item, { qid: r.item, enwiki: r.enwiki, kind: d.kind, source: 'wikidata', reason: forceInclude.has(r.item) && !d.include ? 'override' : d.reason, forced: forceInclude.has(r.item), desc: r.desc ?? null });
  }
  for (const q of forceInclude) {
    if (selected.has(q) || forceExclude.has(q)) continue;
    const e = eByQid.get(q) ?? aByQid.get(q);
    if (e?.enwiki) selected.set(q, { qid: q, enwiki: e.enwiki, kind: 'musical', source: 'override', reason: 'override', forced: true, desc: e.desc ?? null });
    else review.dropped.push({ qid: q, reason: 'override item has no English Wikipedia article' });
  }
  for (const p of candidates.sort((a, b) => cmpStr(a.title, b.title))) {
    if (p.qid && forceExclude.has(p.qid)) { if (!review.excluded.some((x) => x.qid === p.qid)) review.excluded.push({ qid: p.qid, title: p.title, reason: `override: ${overrides.forceExclude[p.qid]}` }); continue; }
    if (p.qid && selected.has(p.qid)) continue;
    const info = p.qid ? eByQid.get(p.qid) : null;
    const d = decideFallback(p.title, info, flags, { excludedByRules: Boolean(p.qid && excludedByRules.has(p.qid)), cats: p.cats });
    if (!d.include) { review.excluded.push({ qid: p.qid, title: p.title, reason: `fallback:${d.reason}`, cats: p.cats }); continue; }
    const id = p.qid ?? `wp:${p.title}`;
    if (selected.has(id)) continue;
    selected.set(id, { qid: p.qid, enwiki: p.title, kind: d.kind, source: 'category', reason: d.reason, forced: false, desc: info?.desc ?? null, cats: p.cats });
    review.fallbackAdded.push({ qid: p.qid, title: p.title, p31: info?.p31 ?? null, desc: info?.desc ?? null, cats: p.cats });
  }
  // 4b. a stage musical that Wikidata classes as a film, a TV show or an album (Get Up, Stand Up!, Mr. Cinders — the
  // article also covers the film or the cast album): kept when its article's first infobox is {{Infobox musical}} with
  // a premiere or productions
  const rescue = review.excluded.filter((x) => x.title && /^(?:fallback:)?(?:film\/tv|blocked-class)$/.test(x.reason) && !(x.qid && forceExclude.has(x.qid)) &&
    !selected.has(x.qid ?? `wp:${x.title}`));
  if (rescue.length) {
    log(`Wikipedia: checking ${rescue.length} excluded articles for an {{Infobox musical}} …`);
    const rp = await wp.fetchPages(rescue.map((x) => x.title));
    for (const x of rescue) {
      const pg = rp.get(x.title);
      if (!pg || pg.missing || !pg.content) continue;
      const why = rescueStageArticle(x.title, pg.content, x.cats ?? []);
      if (!why) continue;
      const id = x.qid ?? `wp:${x.title}`;
      const info = x.qid ? (aByQid.get(x.qid) ?? eByQid.get(x.qid)) : null;
      selected.set(id, { qid: x.qid ?? null, enwiki: x.title, kind: kindOf(split(info?.forms), split(info?.p31), info?.desc ?? ''), source: 'rescue', reason: `rescued (was ${x.reason})`, forced: true, desc: info?.desc ?? null, cats: x.cats });
      review.rescued.push({ qid: x.qid, title: x.title, was: x.reason, why });
    }
    const rescued = new Set(review.rescued.map((x) => x.title));
    review.excluded = review.excluded.filter((x) => !rescued.has(x.title));
  }
  for (const x of review.excluded) delete x.cats;
  log(`  selected ${selected.size} (Wikidata ${count([...selected.values()], (s) => s.source === 'wikidata')}, categories ${count([...selected.values()], (s) => s.source === 'category')}, overrides ${count([...selected.values()], (s) => s.source === 'override')}, rescued ${review.rescued.length}); excluded ${review.excluded.length}`);

  // 5. MediaWiki check: redirects, disambiguation, missing pages; metadata (categories, redirects)
  let sel = [...selected.values()];
  if (args.only) sel = sel.filter((s) => args.only.includes(s.enwiki));
  log(`Wikipedia: page metadata for ${sel.length} titles …`);
  const meta = await wp.fetchMeta(sel.map((s) => s.enwiki));
  const selTitles = new Set(sel.map((s) => s.enwiki));
  const byResolved = new Map();
  const kept = [];
  for (const s of sel) {
    const m = meta.get(s.enwiki);
    if (!m || m.missing) { review.dropped.push({ qid: s.qid, title: s.enwiki, reason: 'missing page' }); continue; }
    if (m.redirected) { review.dropped.push({ qid: s.qid, title: s.enwiki, reason: selTitles.has(m.title) ? `duplicate of ${m.title}` : `redirect to ${m.title}${m.fragment ? '#' + m.fragment : ''}` }); continue; }
    if (m.disambiguation) { review.dropped.push({ qid: s.qid, title: s.enwiki, reason: 'disambiguation page' }); continue; }
    if (!s.qid && m.qid) { if (selected.has(m.qid)) { review.dropped.push({ title: s.enwiki, reason: `duplicate of ${m.qid}` }); continue; } s.qid = m.qid; }
    if (byResolved.has(m.title)) { review.dropped.push({ qid: s.qid, title: s.enwiki, reason: `duplicate of ${byResolved.get(m.title).qid}` }); continue; }
    s.title = m.title; s.meta = m;
    byResolved.set(m.title, s);
    kept.push(s);
  }

  // 6. Wikidata statements + labels
  const qids = kept.map((s) => s.qid).filter(Boolean);
  log(`Wikidata: statements and labels for ${qids.length} items …`);
  const bRows = await wd.statements(qids);
  const dRows = await wd.labels(qids);
  const stmts = new Map();
  for (const r of bRows) (stmts.get(r.item) ?? stmts.set(r.item, []).get(r.item)).push(r);
  const labels = new Map();
  for (const r of [...dRows].sort((x, y) => cmpStr(x.lang, y.lang) || cmpStr(x.text, y.text))) { // "en" before "mul"
    const o = labels.get(r.item) ?? labels.set(r.item, { label: [], alias: [], description: [] }).get(r.item);
    if (r.kind === 'description' && r.lang !== 'en') continue;
    if (!o[r.kind].includes(r.text)) o[r.kind].push(r.text);
  }

  // 7. wikitext
  log(`Wikipedia: wikitext for ${kept.length} articles …`);
  const pages = await wp.fetchPages(kept.map((s) => s.title));

  // 8. parse
  log('Parsing song lists and characters …');
  const shows = []; const parsedBy = new Map();
  const unknownTemplates = {};
  for (const s of kept) {
    const pg = pages.get(s.title);
    if (!pg || pg.missing || !pg.content) { review.dropped.push({ qid: s.qid, title: s.title, reason: 'no wikitext' }); continue; }
    const st = groupStatements(stmts.get(s.qid) ?? []);
    // (Wikidata character lists sometimes hold a chorus line: "SATB Chorus, Cupids of the Comedie Française, Soldiers, …")
    const wdChars = wdNames(st.character).map((n) => n.replace(/\s*\([^()]*\)\s*$/, '').trim())
      .filter((n) => n && n.length <= 60 && !/,|\bchorus\b|\bensemble\b|\bSATB\b/i.test(n) && !isGroupName(n)).map((name) => ({ name, voiceType: null }));
    // year of first performance: the infobox premiere, else Wikidata's first performance (P1191), else the
    // "YYYY musicals" category, else Wikidata's publication/inception year
    // year of first performance (tryouts and premieres anywhere count): the earliest of the infobox premiere /
    // productions, Wikidata's first performance (P1191) and the "YYYY musicals" category; else Wikidata's
    // publication / inception year
    // year of first performance (tryouts and premieres anywhere count): the earliest of the infobox premiere /
    // productions, Wikidata's first performance (P1191) and the "YYYY musicals" category — but not a year the infobox
    // gives only for a concept album or a private preview (Jesus Christ Superstar's 1970 album, Phantom's 1985
    // Sydmonton preview); else Wikidata's publication / inception year. The short descriptions' years are only compared
    // (review.json › yearConflicts): they sometimes give the year a show was written ("1965 musical").
    const shortDesc = pg.content.match(/\{\{\s*short description\s*\|\s*([^}|]*)/i)?.[1] ?? '';
    const descYear = (d) => { const m = String(d ?? '').match(/^(?:an?\s+)?((?:1[6-9]|20)\d\d)\s+(?:[\p{L}-]+\s+){0,3}(?:musical|operetta|revue|rock opera|comic opera|opera|pantomime|burlesque|extravaganza|play with music|song cycle|stage)/iu); return m ? Number(m[1]) : null; };
    const iy = infoboxYears(stageInfobox(stripComments(pg.content)));
    const yc = { infobox: iy.year, p1191: wikidataYear(st, ['firstPerf']), category: categoryYear(s.meta.categories), shortDescription: descYear(shortDesc) };
    const firstYears = [yc.infobox, yc.p1191, yc.category].filter((y) => y != null && !iy.notFirst.has(y));
    s.year = firstYears.length ? Math.min(...firstYears) : wikidataYear(st);
    s.yearCandidates = { ...yc, wikidataDescription: descYear((labels.get(s.qid)?.description ?? [])[0] ?? s.desc) };
    const pref = s.qid && preferList[s.qid];
    if (pref) review.listOverrides.push({ qid: s.qid, title: s.title, label: pref.label, why: pref.why });
    const res = parseArticle(pg.content, { title: s.title, force: s.forced, lenient: s.source !== 'category', extraCharacters: wdChars, year: s.year, preferList: pref?.label ?? null,
      kind: s.kind === 'revue' || (s.meta.categories ?? []).some((c) => /^(?:\d{4} )?revues$|^Musical revues$/i.test(c)) ? 'revue' : s.kind });
    if (!res.isStageWork && !s.forced) { review.gateRejected.push({ qid: s.qid, title: s.title, reason: res.rejectedReason, source: s.source }); continue; }
    for (const w of res.warnings) if (w.startsWith('template:')) unknownTemplates[w.slice(9)] = (unknownTemplates[w.slice(9)] || 0) + 1;
    // numbers named only by a lyric excerpt in a work under copyright are left out (never quoted) — listed for review
    if (res.warnings.includes('dropped:lyric-title')) review.lyricTitlesDropped.push({ qid: s.qid, title: s.title, year: s.year });
    s.page = pg; s.st = st; s.parsed = res;
    parsedBy.set(s.title, s);
  }

  // 9. linked subpages for shows without an in-article list
  const needSub = [...parsedBy.values()].filter((s) => !s.parsed.songs.length && s.parsed.subpages.length);
  if (needSub.length) {
    log(`Wikipedia: ${needSub.length} shows link a song-list/cast-album page; fetching …`);
    const subPages = await wp.fetchPages([...new Set(needSub.flatMap((s) => s.parsed.subpages.map((x) => x.title)))]);
    for (const s of needSub) {
      for (const sp of s.parsed.subpages) {
        const pg = subPages.get(sp.title);
        if (!pg || pg.missing || !pg.content || pg.title === s.title || parsedBy.has(pg.title) || pg.fragment) continue;
        const r = parseSubpage(pg.content, s.parsed, { title: pg.title, mode: sp.mode });
        review.subpages.push({ show: s.title, subpage: pg.title, mode: sp.mode, songs: r.songs.length });
        if (r.songs.length >= 3) {
          Object.assign(s.parsed, { songs: r.songs, section: `${pg.title} › ${r.section}`, singersSource: r.singersSource });
          s.subpage = { title: pg.title, revid: pg.revid, mode: sp.mode };
          break;
        }
      }
    }
  }

  // 10. assemble
  for (const s of parsedBy.values()) {
    const { st, parsed: res } = s;
    const lab = labels.get(s.qid) ?? {};
    const ib = res.infobox ?? {};
    const title = displayTitle(s.title, (lab.label ?? [])[0]);
    // {{Infobox opera}} (operettas, comic operas): composer / librettist
    // (Wikidata sometimes lists every creator as a composer — Dracula's "Karel Svoboda, Zdeněk Borovec, Richard Hes", with
    // no lyricist: the ones it also lists as librettists are left out of the composers)
    const wdLibrettists = new Set(wdNames(st.librettist).map(fold));
    const lumped = wdNames(st.composer).length >= 3 && !wdNames(st.lyricist).length && wdNames(st.composer).some((n) => !wdLibrettists.has(fold(n))) &&
      wdNames(st.composer).some((n) => wdLibrettists.has(fold(n)));
    const wdComposers = lumped ? wdNames(st.composer).filter((n) => !wdLibrettists.has(fold(n))) : wdNames(st.composer);
    // credits the opening sentences state, where the infobox and Wikidata have none (Beguiled Again, Oh, What A Girl!)
    const lc = leadCredits(s.page.content);
    const fromLead = (names, lead) => (names.length ? names : lead);
    const composer = joinNames(fromLead(creditNames(ib.music ?? ib.composer).length ? creditNames(ib.music ?? ib.composer) : wdComposers, lc.composer));
    const bookWriter = joinNames(fromLead(creditNames(ib.book ?? ib.librettist).length ? creditNames(ib.book ?? ib.librettist) : wdNames(st.librettist), lc.book));
    // an English comic opera's librettist wrote its lyrics too (Gilbert for the Savoy operas)
    const englishComicOpera = (s.meta.categories ?? []).some((c) => /^(?:Savoy operas|Operas by Gilbert and Sullivan|English comic operas|English-language operas|Operas by Arthur Sullivan)$/.test(c)) ||
      /\bgilbert\b|\benglish comic opera\b/i.test((lab.description ?? [])[0] ?? s.desc ?? '');
    const lyricist = joinNames(creditNames(ib.lyrics, { preferEnglish: true })) ?? joinNames(wdNames(st.lyricist)) ??
      (englishComicOpera && !ib.lyrics ? joinNames(creditNames(ib.librettist)) ?? joinNames(wdNames(st.librettist)) : null) ?? joinNames(lc.lyricist);
    const description = (lab.description ?? [])[0] ?? s.desc ?? null;
    const characters = res.characters.map((c) => ({ name: c.name, voiceType: c.voiceType ?? null }));
    const songs = res.songs.map((g) => ({
      title: g.title, act: g.act, position: g.position, singers: g.singers, singersRaw: g.singersRaw,
      ensemble: g.ensemble, reprise: g.reprise, instrumental: g.instrumental,
    }));
    const show = {
      key: s.qid ?? `wp:${s.title}`,
      title,
      altTitles: altTitlesOf({
        title, wikiTitle: s.title, wdLabels: lab.label ?? [], wdAliases: lab.alias ?? [], redirects: s.meta.redirects,
        songTitles: songs.map((g) => g.title), characterNames: characters.map((c) => c.name),
      }),
      wikiTitle: s.title,
      wikidataId: s.qid ?? null,
      composer, lyricist, bookWriter,
      year: s.year,
      genres: genresOf({ st, kind: s.kind, categories: s.meta.categories }),
      description: description ? description.trim() || null : null,
      characters,
      songs,
    };
    shows.push({ show, s });
  }
  shows.sort((a, b) => cmpStr(fold(a.show.title), fold(b.show.title)) || (a.show.year ?? 9999) - (b.show.year ?? 9999) || cmpStr(a.show.key, b.show.key));

  // 11. write
  fs.mkdirSync(outDir, { recursive: true });
  const catalogFile = path.join(outDir, 'catalog.json.gz');
  const today = new Date().toISOString().slice(0, 10);
  let prev = null;
  try { prev = JSON.parse(zlib.gunzipSync(fs.readFileSync(catalogFile)).toString('utf8')); } catch { /* first build */ }
  const body = {
    sources: {
      wikidata: 'Wikidata (https://www.wikidata.org), CC0 1.0 — show selection, credits fallback, years, genres, descriptions, alternative titles',
      wikipedia: 'English Wikipedia (https://en.wikipedia.org), CC BY-SA 4.0 — song lists, singers, characters and voice types, credits; see README.md for attribution',
    },
    shows: shows.map((x) => x.show),
  };
  // the version never repeats for different content (src/version.js): the committed ledger, the local one and the
  // file being replaced all count
  const hash = contentHash(body);
  const prevInfo = prev ? { version: prev.version, hash: contentHash(prev), generatedAt: prev.generatedAt } : null;
  const realOut = outDir === path.resolve(DEFAULT_OUT);
  const issued = [...readLedger(LEDGER), ...readLedger(LOCAL_LEDGER)];
  const pick = chooseVersion({ today, hash, prev: prevInfo, issued });
  const unchanged = Boolean(prevInfo && prevInfo.hash === hash);
  const version = pick.version;
  const doc = { version, generatedAt: unchanged ? prev.generatedAt : pick.generatedAt ?? new Date().toISOString(), ...body };
  const errors = validateCatalog(doc);
  if (errors.length) { console.error('Catalog validation failed:\n  ' + errors.slice(0, 40).join('\n  ')); process.exit(1); }
  // Vandalism gate (src/review-gate.js): a readable diff against the file being replaced, and a stop when changed
  // text looks like vandalism or a song list was mostly blanked — before anything is overwritten.
  if (prev && !unchanged) {
    const cmp = compareCatalogs(prev, doc);
    const diffFile = path.join(ROOT, '.cache', `diff-${version}.txt`);
    fs.mkdirSync(path.dirname(diffFile), { recursive: true });
    fs.writeFileSync(diffFile, renderDiff(cmp));
    const s = cmp.summary;
    log(`Changes since ${prev.version}: shows +${s.showsAdded} -${s.showsRemoved} ~${s.showsChanged}, songs +${s.songsAdded} -${s.songsRemoved}, `
      + `${s.songsChanged} with different singers → ${path.relative(REPO, diffFile)}`);
    if (cmp.flags.length) {
      console.error(`\n${cmp.flags.length} change(s) look like possible vandalism:`);
      const revOf = new Map(shows.map((x) => [x.show.key, x.s.page?.revid]));
      for (const f of cmp.flags.slice(0, 50)) {
        const rev = f.key ? revOf.get(f.key) : null;
        console.error(`  ! ${f.show}${f.wikiTitle && f.wikiTitle !== f.show ? ` [${f.wikiTitle}]` : ''} — ${f.what}: “${f.text}” (${f.reasons.join(', ')})`
          + (rev ? `\n      https://en.wikipedia.org/w/index.php?oldid=${rev}` : ''));
      }
      if (!args.acceptReview) {
        console.error('\nNothing was written. Check each one in the revision the build read (links above) and the article\'s history.'
          + ' If it is vandalism, wait until the article is reverted and build again with --refresh (or correct it in overrides.json);'
          + ' if the text is genuine, run the build again with --accept-review.');
        process.exit(2);
      }
      log('--accept-review: writing the catalog anyway');
    }
  }
  const json = JSON.stringify(doc);
  const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
  if (!unchanged) fs.writeFileSync(catalogFile, gz);
  const entry = { version, sha256: hash, generatedAt: doc.generatedAt, shows: doc.shows.length, songs: doc.shows.reduce((n, x) => n + x.songs.length, 0), out: realOut ? 'seed' : 'trial' };
  recordVersion(LOCAL_LEDGER, entry);
  if (realOut && !args.only) recordVersion(LEDGER, entry);
  const gzBytes = unchanged ? fs.statSync(catalogFile).size : gz.length;

  // stats + review
  const all = doc.shows; const songsAll = all.flatMap((s) => s.songs);
  const sung = songsAll.filter((g) => !g.instrumental);
  const st = {
    version, generatedAt: doc.generatedAt, unchanged: Boolean(unchanged), sha256: hash,
    shows: all.length,
    showsWithSongs: count(all, (s) => s.songs.length > 0),
    showsWithSingers: count(all, (s) => s.songs.some((g) => g.singers.length > 0)),
    songs: songsAll.length,
    songsWithSingers: count(songsAll, (g) => g.singers.length > 0),
    songsWithSingersOrEnsemble: count(songsAll, (g) => g.singers.length > 0 || g.ensemble),
    songsSung: sung.length,
    songsInstrumental: count(songsAll, (g) => g.instrumental),
    songsReprise: count(songsAll, (g) => g.reprise),
    songsEnsemble: count(songsAll, (g) => g.ensemble),
    soloGuesses: count(sung, (g) => g.singers.length === 1 && !g.ensemble),
    duetGuesses: count(sung, (g) => g.singers.length === 2 && !g.ensemble),
    characters: all.reduce((n, s) => n + s.characters.length, 0),
    showsWithCharacters: count(all, (s) => s.characters.length > 0),
    charactersWithVoiceType: all.reduce((n, s) => n + count(s.characters, (c) => c.voiceType), 0),
    coverage: {
      composer: count(all, (s) => s.composer), lyricist: count(all, (s) => s.lyricist), bookWriter: count(all, (s) => s.bookWriter),
      year: count(all, (s) => s.year), description: count(all, (s) => s.description), genres: count(all, (s) => s.genres.length),
      altTitles: count(all, (s) => s.altTitles.length),
    },
    bySource: tally(shows.map((x) => x.s.source)),
    byKind: tally(shows.map((x) => x.s.kind)),
    songSections: tally(shows.filter((x) => x.show.songs.length).map((x) => (x.s.subpage ? `subpage:${x.s.subpage.mode}` : x.s.parsed.section.toLowerCase()))),
    singersSource: tally(shows.filter((x) => x.show.songs.length).map((x) => x.s.parsed.singersSource)),
    subpagesFollowed: count(shows, (x) => x.s.subpage),
    // numbers the chosen list lacks, from the article's later production lists or its list notes (round 3)
    songsFromLaterProductionLists: shows.reduce((n, x) => n + (x.s.parsed.addedFromOtherLists ?? []).filter((a) => a.list !== 'notes').length, 0),
    songsFromListNotes: shows.reduce((n, x) => n + (x.s.parsed.addedFromOtherLists ?? []).filter((a) => a.list === 'notes').length, 0),
    excluded: tally(review.excluded.map((x) => x.reason)),
    dropped: tally(review.dropped.map((x) => x.reason.replace(/ of .*| to .*/, ''))),
    gateRejected: review.gateRejected.length,
    gzipBytes: gzBytes,
    jsonBytes: Buffer.byteLength(json),
    spotCheck: SPOT_CHECK.map((t) => {
      const x = shows.find((y) => y.show.wikiTitle === t);
      return x ? { wikiTitle: t, key: x.show.key, songs: x.show.songs.length, withSingers: count(x.show.songs, (g) => g.singers.length > 0), characters: x.show.characters.length }
        : { wikiTitle: t, missing: true };
    }),
    unknownTemplates: Object.fromEntries(Object.entries(unknownTemplates).sort((a, b) => b[1] - a[1]).slice(0, 40)),
  };
  fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(st, null, 1) + '\n');
  fs.writeFileSync(path.join(outDir, 'README.md'), renderReadme(st, doc));
  const reviewFile = path.join(ROOT, '.cache', args.only ? 'review-only.json' : 'review.json');
  fs.mkdirSync(path.dirname(reviewFile), { recursive: true });
  fs.writeFileSync(reviewFile, JSON.stringify({
    ...review, unknownTemplates,
    requests: { wikidata: wd.stats.requests, wikipedia: wp.stats.requests, cacheHits: cache.hits },
    buildSeconds: Math.round((Date.now() - t0) / 1000),
    revisions: shows.map((x) => ({ key: x.show.key, title: x.s.title, revid: x.s.page.revid, subpage: x.s.subpage ?? null })),
    // numbers added to a show's list from its later production lists / its list notes: { title: [{ title, list }] }
    addedFromOtherLists: Object.fromEntries(shows.filter((x) => x.s.parsed.addedFromOtherLists?.length).map((x) => [x.s.title, x.s.parsed.addedFromOtherLists])),
    // years that disagree by more than two years (the earliest is used)
    // sources that disagree by more than two years, or a description that dates the show earlier than the year used
    // (Hadestown: "2006 musical by Anaïs Mitchell" — the 2006 Vermont staging is only in the article's prose)
    yearConflicts: shows.filter((x) => {
      const yc = x.s.yearCandidates ?? {}; const v = Object.values(yc).filter((y) => y != null);
      return (v.length > 1 && Math.max(...v) - Math.min(...v) > 2) || (x.show.year != null && v.some((y) => y < x.show.year));
    }).map((x) => ({ title: x.s.title, year: x.show.year, ...x.s.yearCandidates })),
  }, null, 1));
  log(`${unchanged ? 'Catalog unchanged' : 'Wrote'} ${path.relative(REPO, catalogFile)} v${version}: ${st.shows} shows, ${st.showsWithSongs} with songs, ${st.songs} songs (${st.songsWithSingers} with singers), ${(gzBytes / 1024 / 1024).toFixed(2)} MB gz`);
  log(`Requests: Wikidata ${wd.stats.requests}, Wikipedia ${wp.stats.requests} (cache hits ${cache.hits})`);
  log(`Review lists (excluded/dropped/gate-rejected/fallback) → ${path.relative(REPO, reviewFile)}`);
}

export function renderReadme(st, doc) {
  const n = (x) => x.toLocaleString('en-US');
  return `# Show & song catalog

\`catalog.json.gz\` is the catalog the site uses for "Find your song" and the add-a-song
suggestions (SPEC §7c). It is **generated** — do not edit it by hand; fix the sources or the
builder (\`tools/catalog/\`) and rebuild.

| | |
|---|---|
| Version | \`${doc.version}\` |
| Built | ${doc.generatedAt} |
| Shows | ${n(st.shows)} (${n(st.showsWithSongs)} with a song list, ${n(st.showsWithSingers)} with singers) |
| Songs | ${n(st.songs)} (${n(st.songsWithSingers)} with named singers, ${n(st.songsInstrumental)} instrumental, ${n(st.songsReprise)} reprises) |
| Characters | ${n(st.characters)} in ${n(st.showsWithCharacters)} shows (${n(st.charactersWithVoiceType)} with a voice type) |
| File size | ${(st.gzipBytes / 1024 / 1024).toFixed(2)} MB gzipped |

Detailed counts: [\`stats.json\`](stats.json).

## Sources and licences

- **Wikidata** (<https://www.wikidata.org>) — which works are stage musicals (including operettas
  and revues), composer / lyricist / librettist (fallback), year of first performance (with the
  article's infobox and categories: the earliest wins),
  genres, short descriptions and alternative titles. Wikidata is **CC0 1.0** (public domain).
- **English Wikipedia** (<https://en.wikipedia.org>) — song lists ("Musical numbers" / "Songs" /
  "Song list" sections and linked "Songs from …" / cast-recording pages), who sings each song,
  characters and voice types, infobox credits (or, where the infobox and Wikidata have none, the
  credits stated in the article's opening sentences) and premiere dates, and the "YYYY musicals" /
  operetta / comic opera categories. A show's song list is one production list of its article
  (the licensed / current one where the article says so); numbers that only a later production
  list or the list's notes name (Grease's "Hopelessly Devoted to You", The Sound of Music's
  "Something Good") are added in their place (${n(st.songsFromLaterProductionLists + st.songsFromListNotes)} songs). Numbers the articles name only by a line of lyrics of a work
  still in copyright are left out. This content is
  licensed **CC BY-SA 4.0** (<https://creativecommons.org/licenses/by-sa/4.0/>): the catalog data
  derived from it is shared under the same licence. **Attribution:** "Song lists and characters
  from English Wikipedia contributors, CC BY-SA 4.0". Each show's article is
  \`https://en.wikipedia.org/wiki/<wikiTitle>\` (its full list of contributors is on the article's
  history page); the site shows this credit wherever catalog data appears.
- No lyrics are included — only song titles, character names and credits.
- The builder's code (\`tools/catalog/\`) is MIT like the rest of the project; the data keeps the
  licences above.

## Format

gzip of one JSON document: \`{ version, generatedAt, sources, shows: [{ key, title, altTitles,
wikiTitle, wikidataId, composer, lyricist, bookWriter, year, genres, description, characters:
[{ name, voiceType }], songs: [{ title, act, position, singers, singersRaw, ensemble, reprise,
instrumental }] }] }\` — see SPEC §7c. \`key\` is the Wikidata QID (or \`wp:<enwiki title>\` for the
few articles without a Wikidata item). Shows are sorted by title; songs are in show order.

## Rebuilding

\`\`\`sh
npm run catalog:build            # from the repo root (installs tools/catalog, then builds)
# or, inside tools/catalog:
npm run build -- --refresh       # re-download everything instead of using the cache
npm run build -- --offline       # rebuild only from tools/catalog/.cache (no network)
npm test                         # parser tests
npm run verify                   # sample-check titles against live Wikipedia pages
\`\`\`

The builder sends a descriptive User-Agent, batches Wikipedia requests (50 pages per request,
≤ 4 requests/second, \`maxlag=5\`) and caches every raw response in \`tools/catalog/.cache/\`
(gitignored), so a rebuild from a warm cache makes no requests and gives the same output. A
first build takes a few minutes. The \`version\` (\`YYYY-MM-DD.N\`) changes whenever the content
changes (the server reloads the catalog when it sees a new version); a rebuild that produces
identical content keeps the previous version, and a version string is never issued twice for
different content (every version is recorded with its content's SHA-256 in
\`tools/catalog/versions.json\`; this file's hash is \`${st.sha256.slice(0, 16)}…\` in \`stats.json\`). Manual include/exclude corrections live in
\`tools/catalog/overrides.json\`.
`;
}

main().catch((err) => { console.error(err); process.exit(1); });
