#!/usr/bin/env node
// Quality check of the built catalog against the live source pages (SPEC §7c quality bar):
//  - song titles: every title (each part of a medley) must appear verbatim in the rendered article
//    (or the linked subpage) — sampled shows, fetched with action=parse (cached);
//  - singers: every parsed singer must be supported by the list's own singer text (a word of the
//    character name, or its initial, appears in singersRaw) — all shows, offline;
//  - instrumentals: no instrumental song whose singer text names a character; no song whose only
//    singer text is an orchestra/band marked as sung;
//  - duplicates: no two songs of a show with the same folded title + reprise flag.
//  - item structure (all shows, offline): a title that is only a kind of number ("Quartet", "Song", "Duet")
//    twice in one show, leftover footnote markers / quotes / year or reprise notes in titles, acts going
//    backwards (two production lists merged), singer names that match no character and aren't group words
//    (composers, source songs or performers read as singers), form labels / act labels used as singers, runs of
//    songs "listed again" as reprises (two production lists read as one), plural-looking names kept as singers that
//    are neither characters nor group words (a group word the lexicon lacks: "Tribe", "Suspects"), leftover legend
//    markers ("Gleb +") in the singer text.
//    A title can appear verbatim on its page and still be the wrong span of the item — these checks catch that.
// The title sample is stratified: two thirds any show with songs, one third operettas and revues (the old
// list formats).
// usage: node src/verify.js [--sample 120] [--seed 1] [--offline] [--catalog path/to/catalog.json.gz]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DiskCache } from './http.js';
import { createWikipedia } from './wikipedia.js';
import { norm, songKey, INSTR_TOKEN, isGroupName, GENERIC_TITLE } from './normalize.js';
import { createCharacterMatcher } from './parse-characters.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const CATALOG = path.resolve(opt('catalog', path.resolve(ROOT, '..', '..', 'server', 'seed', 'catalog', 'catalog.json.gz')));
const SAMPLE = Number(opt('sample', 120)); const SEED = Number(opt('seed', 1));

function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

const decode = (s) => s.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/g, ' ')
  .replace(/<\/?(?:li|ul|ol|dl|dt|dd|p|div|td|th|tr|table|tbody|thead|br|h\d|section|blockquote|center|caption)\b[^>]*>/gi, ' ')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;|&#34;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d));
const N = (s) => s.normalize('NFC').replace(/[“”„‟″"]/g, '').replace(/[‘’‚‛′`]/g, "'").replace(/[–—−‒―]/g, '-')
  .replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

async function main() {
  const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync(CATALOG)).toString('utf8'));
  const cache = new DiskCache(path.join(ROOT, '.cache'), { offline: args.includes('--offline') });
  const wp = createWikipedia({ cache, log: () => {} });
  const review = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'review.json'), 'utf8'));
  const subpageOf = new Map(review.revisions.filter((r) => r.subpage).map((r) => [r.key, r.subpage.title]));

  // 1. titles vs live pages (sample)
  const withSongs = doc.shows.filter((s) => s.songs.length).sort((a, b) => (a.key < b.key ? -1 : 1));
  const r = rng(SEED); const pick = [];
  const old = withSongs.filter((x) => x.genres.some((g) => /operetta|revue|comic opera/.test(g)));
  const pool = withSongs.filter((x) => !old.includes(x));
  const nOld = Math.min(Math.round(SAMPLE / 3), old.length);
  while (pick.length < nOld) pick.push(old.splice(Math.floor(r() * old.length), 1)[0]);
  while (pick.length < Math.min(SAMPLE, pool.length + nOld)) pick.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  let total = 0; let exact = 0; let ci = 0; const misses = [];
  for (const s of pick) {
    const page = subpageOf.get(s.key) ?? s.wikiTitle;
    const j = await wp.api({ action: 'parse', page, prop: 'text', redirects: '1', disableeditsection: '1', disabletoc: '1' });
    const text = N(decode(j.parse?.text ?? ''));
    const lower = text.toLowerCase();
    for (const g of s.songs) {
      const t = g.title.replace(/ \((?:Reprise \d+|Act \d+|\d+)\)$/, ''); // the builder's own disambiguators
      const parts = t.split(' / ').map((p) => N(p.replace(/ \(Reprise\)$/, '')));
      total++;
      if (parts.every((p) => text.includes(p))) exact++;
      else if (parts.every((p) => lower.includes(p.toLowerCase()))) { ci++; misses.push(`[case] ${s.title} :: ${g.title}`); } else misses.push(`${s.title} :: ${g.title}`);
    }
  }

  // 2. singers supported by the singer text (all shows)
  const SKIP = new Set(['the', 'mr', 'mrs', 'ms', 'dr', 'miss', 'of', 'de', 'von', 'van', 'lord', 'lady', 'king', 'queen', 'prof', 'doctor', 'sir', 'elder', 'sister', 'captain', 'lieutenant', 'madame', 'monsieur', 'la', 'le', 'du', 'and']);
  let refs = 0; let unsupported = 0; const badSingers = [];
  for (const s of doc.shows) {
    for (const g of s.songs) {
      const raw = ` ${norm(g.singersRaw)} `;
      for (const x of g.singers) {
        refs++;
        const ws = norm(x).split(' ').filter((w) => w.length > 1 && !SKIP.has(w));
        const ok = ws.some((w) => raw.includes(` ${w} `) || raw.includes(` ${w}s `)) || (ws.length && raw.includes(` ${ws[0][0]} `)) || raw.includes(` ${norm(x)} `);
        if (!ok) { unsupported++; badSingers.push(`${s.title} :: ${g.title} :: ${x} <= "${g.singersRaw}"`); }
      }
    }
  }

  // 3. instrumentals & duplicates (all shows)
  const instrSung = []; const sungOrchestra = []; const dupes = [];
  for (const s of doc.shows) {
    const chars = s.characters.map((c) => norm(c.name)).filter((c) => c.length > 2);
    const seen = new Set();
    for (const g of s.songs) {
      const raw = ` ${norm(g.singersRaw)} `;
      if (g.instrumental && chars.some((c) => raw.includes(` ${c} `)) && !/danced|instrumental/i.test(g.singersRaw)) instrSung.push(`${s.title} :: ${g.title} <= "${g.singersRaw}"`);
      const toks = g.singersRaw.split(/\s*(?:,|&|\band\b|\/)\s*/).filter(Boolean);
      if (!g.instrumental && toks.length && toks.every((t) => INSTR_TOKEN.test(t.trim()))) sungOrchestra.push(`${s.title} :: ${g.title} <= "${g.singersRaw}"`);
      const k = songKey(g.title, g.reprise);
      if (seen.has(k)) dupes.push(`${s.title} :: ${g.title}`);
      seen.add(k);
    }
  }

  // 4. item structure (all shows)
  const structure = { genericTitles: [], titleLeftovers: [], actsBackwards: [], unmatchedSingers: [], labelSingers: [], repriseRuns: [], pluralSingers: [], rawMarkers: [] };
  let singerTokens = 0; let unmatchedTokens = 0;
  for (const s of doc.shows) {
    const generic = s.songs.filter((g) => GENERIC_TITLE.test(g.title.replace(/\s*\((?:act \d+|\d+)\)$/i, '')) && !/^(?:finale|overture|entr'?acte|prelude|bows|playoff|opening)/i.test(g.title));
    if (generic.length >= 2) structure.genericTitles.push(`${s.title}: ${generic.map((g) => g.title).join(' | ')}`);
    let maxAct = 0;
    const m = createCharacterMatcher(s.characters);
    // 4 or more songs in a row that are "listed again" without the source calling them reprises: two lists read as one
    let run = 0; let longest = 0; const bases = new Set();
    for (const g of s.songs) {
      const again = g.reprise && bases.has(norm(g.title.replace(/ \(Reprise \d+\)$/, ''))) && !/\breprise\b/i.test(g.singersRaw);
      run = again ? run + 1 : 0; longest = Math.max(longest, run);
      if (!g.reprise) bases.add(norm(g.title));
    }
    if (longest >= 4) structure.repriseRuns.push(`${s.title}: ${longest} in a row`);
    for (const g of s.songs) {
      if (/\s[+#*]+(?:$|[,;)])/.test(g.singersRaw)) structure.rawMarkers.push(`${s.title} :: ${g.title} <= "${g.singersRaw}"`);
      if (/[*#†‡§¶]\s*$|"|\s[–—-]\s*reprise\s*$|\((?:1[89]|20)\d\d(?:\s*[–-]\s*(?:(?:1[89]|20)\d\d|present))?\)|\((?:includes?|reprise of|which is)\b/i.test(g.title)) structure.titleLeftovers.push(`${s.title} :: ${g.title}`);
      if (g.act && g.act < maxAct) structure.actsBackwards.push(`${s.title} :: ${g.title}`);
      if (g.act) maxAct = Math.max(maxAct, g.act);
      for (const x of g.singers) {
        singerTokens++;
        if (/^(?:act|part|scene)\s+\S+$|^(?:song|duet|trio|quartet|quintet|sextet|septet|chorus|solo|soloist|concerted number|number)$/i.test(x)) structure.labelSingers.push(`${s.title} :: ${g.title} :: ${x}`);
        if (s.characters.length && !m.matchCharacter(x) && !isGroupName(x)) { unmatchedTokens++; structure.unmatchedSingers.push(`${s.title} :: ${g.title} :: ${x}`); }
        // (a plural word that is no character — "Suspects", "Chess Players" — is probably a group the lexicon lacks; names
        // like "Arthur Kipps" or "Carlos" show up here too, so this is a list to review, not a count of errors)
        if (!m.matchCharacter(x) && /^(?:\p{Lu}[\p{Ll}'’-]+\s+)?\p{Lu}[\p{Ll}'’-]{2,}(?:ers|ies|ists|ians|ites|ettes|ants|ents|ings|oes|ches|shes|ves|ks|ts|ds|gs|ls|ms|ns|ps|rs)$/u.test(x)) structure.pluralSingers.push(`${s.title} :: ${x}`);
      }
    }
  }

  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(2)}%` : 'n/a');
  const report = {
    catalogVersion: doc.version,
    titles: { sampledShows: pick.length, songs: total, exact, exactPct: pct(exact, total), caseInsensitivePct: pct(exact + ci, total), misses },
    singers: { references: refs, unsupported, supportedPct: pct(refs - unsupported, refs), unsupportedList: badSingers },
    instrumentals: { instrumentalButNamesCharacter: instrSung, orchestraMarkedSung: sungOrchestra },
    duplicates: dupes,
    structure: {
      showsWithRepeatedGenericTitles: structure.genericTitles.length, titleLeftovers: structure.titleLeftovers.length, actsBackwards: structure.actsBackwards.length,
      singersNotInCharacterList: `${unmatchedTokens}/${singerTokens} (${pct(unmatchedTokens, singerTokens)}) in shows that have a character list`,
      labelsAsSingers: structure.labelSingers.length, showsWithRepriseRuns: structure.repriseRuns.length,
      pluralNamesKeptAsSingers: structure.pluralSingers.length, legendMarkersInSingerText: structure.rawMarkers.length, lists: structure,
    },
  };
  const out = path.join(ROOT, '.cache', 'verify-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`titles: ${exact}/${total} exact (${report.titles.exactPct}), ${report.titles.caseInsensitivePct} ignoring case — ${pick.length} sampled shows`);
  console.log(`singers: ${refs - unsupported}/${refs} supported by the source's singer text (${report.singers.supportedPct})`);
  console.log(`instrumental but naming a character: ${instrSung.length}; orchestra-only marked sung: ${sungOrchestra.length}; duplicate songs: ${dupes.length}`);
  console.log(`structure: ${structure.genericTitles.length} shows repeat a generic title, ${structure.titleLeftovers.length} titles with leftover notes/markers, ${structure.actsBackwards.length} songs with acts going backwards, ${structure.labelSingers.length} labels read as singers`);
  console.log(`singers not in the show's character list (minor roles, or misreads to review): ${report.structure.singersNotInCharacterList}`);
  console.log(`review lists: ${structure.repriseRuns.length} shows with 4+ songs in a row listed again, ${structure.pluralSingers.length} plural-looking names kept as singers, ${structure.rawMarkers.length} singer texts with legend markers`);
  console.log(`details → ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
