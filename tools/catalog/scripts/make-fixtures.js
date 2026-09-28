#!/usr/bin/env node
// Maintainer script: turn full Wikipedia articles into small, lyric-free test fixtures.
// Keeps the infobox, the song-list / character / cast sections (list lines, tables, short lines)
// and the wikitables elsewhere (actor names for the "singers are actors" rule); drops prose,
// quote/poem templates and <poem> blocks. Refuses to write a fixture whose parse differs from
// the parse of the full article.
//
// usage: node scripts/make-fixtures.js <spec.json>
//   spec.json: [{ "title": "Guys and Dolls", "file": "/path/to/Guys_and_Dolls.wikitext",
//                 "pageid": 1, "revid": 2, "parent": "Title of main article (subpages only)", "mode": "songs|album",
//                 "kind": "revue" (optional: parsed as the build parses a revue), "year": 1906 (optional: the year the build
//                 uses when the article has no infobox date — first lines of pre-1930 works are titles), "lenient": true
//                 (optional: parsed as the build parses a Wikidata-typed stage work, whose article may start with an album
//                 infobox), "preferList": "^US tour" (optional: overrides.json › preferList of the show) }]
//   Without "file", the page is read from the builder cache (tools/catalog/.cache).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiskCache } from '../src/http.js';
import { parseArticle, parseSubpage, songHeading, infoboxYear } from '../src/parse-songs.js';
import { CHAR_HEAD } from '../src/parse-characters.js';
import { stripComments, stripRefs, mapTemplates, findTemplateEnd, headingOf, cleanHeading, parseTable, stageInfobox } from '../src/wikitext.js';
import { lyricExcerpt } from '../src/normalize.js';

// Lyric excerpts some articles use to name numbers (Fun Home's "Sometimes my father …", Sweeney Todd's
// "The Ballad of Sweeney Todd: '…Lift Your Razor High…'") are replaced by a neutral placeholder in fixtures of
// works still in copyright: the parser drops them either way, so the parse is unchanged and no lyric is copied.
const LYRIC_EXCERPT = /"(\p{Lu}[^"]*?\s\p{Ll}[^"]*?(?:\.{3}|…)[!?.,]?)"/gu;
const LYRIC_SUBTITLE = /(:\s*')((?:\.{3}|…)[^']*(?:'[a-z][^']*)*|[^']*(?:\.{3}|…)[!?.,]?)(')/g;
function scrubLyrics(line) {
  return line.replace(LYRIC_EXCERPT, (m, x) => (lyricExcerpt(x) ? `"${x.split(/\s+/).map((w, i) => (i ? 'la' : 'La')).join(' ').replace(/[!?.,…]*$/, '')}..."` : m))
    .replace(LYRIC_SUBTITLE, (m, a, x, b) => `${a}...La la la${b}`);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'fixtures');
export const fixtureFile = (title) => `${title.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')}.wikitext`;

const LYRIC_TEMPLATES = /^(?:poemquote|poem quote|quote|blockquote|quote box|cquote|rquote|lyrics|verse translation|poem|quotation)$/;
const ACTOR_PROSE = /(?:starring|starred|played by|portrayed by|cast (?:included|of))\s*\[\[[^\]]+\]\]/g;
// "It featured in the cast [[A]], [[B]] …" / "The cast included [[A]] as Woodhull, [[B]] …": the trigger and the links only
const CAST_SENTENCE = /(?:featured in the cast|cast (?:included|featured|comprised|consisted of)|in the cast were|with a cast (?:of|that included))\s*[^\n]{0,400}/gi;

export function trim(full, { year } = {}) {
  let text = stripRefs(stripComments(full));
  const y = year ?? infoboxYear(stageInfobox(text));
  const copyrighted = y == null || y >= 1930;
  text = mapTemplates(text, (name, p, raw) => (LYRIC_TEMPLATES.test(name) ? '' : raw));
  text = text.replace(/<poem>[\s\S]*?<\/poem>/gi, '').replace(/<blockquote>[\s\S]*?<\/blockquote>/gi, '')
    .replace(/\[\[\s*(?:file|image)\s*:[^[\]]*(?:\[\[[^\]]*\]\][^[\]]*)*\]\]/gi, '');
  // lead: keep only the first infobox
  const firstHeading = text.search(/^==[^=]/m);
  const lead = firstHeading >= 0 ? text.slice(0, firstHeading) : text;
  const ibStart = lead.search(/\{\{\s*infobox/i);
  let out = '';
  if (ibStart >= 0) { const e = findTemplateEnd(lead, ibStart); out += (e > 0 ? lead.slice(ibStart, e) : '') + '\n'; }
  const rest = firstHeading >= 0 ? text.slice(firstHeading) : '';
  const lines = rest.split('\n');
  let keepLevel = 0; // >0 while inside a kept section (song/character list), = its heading level
  const actorProse = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = headingOf(l);
    if (h) {
      const t = cleanHeading(h.title);
      if (keepLevel && h.level <= keepLevel) keepLevel = 0;
      if (!keepLevel && (songHeading(t) || CHAR_HEAD.test(t) || /^(?:track ?listing|tracks|musical numbers|songs)/i.test(t) || /\bcast (?:recording|album)\b/i.test(t))) keepLevel = h.level;
      out += l + '\n';
      continue;
    }
    if (/^\s*\{\|/.test(l)) { // tables are data: always keep
      let depth = 0; let e = i;
      for (; e < lines.length; e++) { if (/^\s*\{\|/.test(lines[e])) depth++; if (/^\s*\|\}/.test(lines[e])) { depth--; if (depth === 0) break; } }
      const tbl = lines.slice(i, e + 1);
      if (keepLevel) out += tbl.join('\n') + '\n';
      else { // other tables (awards, casts) only matter for the names they link to (actors): keep just those links
        const links = new Set();
        for (const r of parseTable(tbl).grid) r.cells.forEach((c, ci) => { if (c && ci > 0) for (const m of c.raw.matchAll(/\[\[[^\]]+\]\]/g)) links.add(m[0]); });
        if (links.size) out += `{|\n|-\n| links || ${[...links].join(' ')}\n|}\n`;
      }
      i = e; continue;
    }
    for (const m of l.matchAll(ACTOR_PROSE)) actorProse.push(m[0]);
    for (const m of l.matchAll(CAST_SENTENCE)) {
      const sentence = m[0].split(/(?<=[\p{Ll}\]'")]{2})\.(?:\s|$|\{)/u)[0];
      const trigger = sentence.match(/^[^[]*/)[0].trim();
      const links = [...sentence.matchAll(/(?:\bas\s+(?:the\s+)?(?:[^,;[\]]{0,40}\/\s*(?:the\s+)?)?)?\[\[[^\]]+\]\]/g)].map((x) => x[0]);
      if (links.length) actorProse.push(`${trigger} ${links.join(', ')}`);
    }
    if (!keepLevel) continue;
    // notes next to a list that decide which version it is (licensing), or introduce the current list
    const versionNote = /licen[cs]|\b(?:current|standard)\b[^:]{0,200}\b(?:version|production|list|order)\b[^:]*:\s*$/i.test(l) && l.length < 1200;
    // a line introducing a list ("List of shows … on the cast album:") names that list (a recording, a production)
    const listIntro = /:\s*$/.test(l.trim()) && l.length < 300 && /\b(?:recording|album|production|version|revival|tour|cast)\b/i.test(l);
    // "Songs are listed with performers in the original Broadway version": the singers named are the performers
    const performerNote = l.length < 400 && (/\bdoubl(?:ing|ed|es)\b/i.test(l) || /\b(?:with (?:the |their )?(?:original )?performers|performers (?:in|of|from) the original|(?:listed|given|shown) with (?:the )?(?:original )?(?:cast|performers))\b/i.test(l)); // (and "The usual doubling is as follows:")
    const ln = l.replace(/\{\{\s*(?:efn|refn|sfn)[^{}]*\}\}/gi, ''); // (a footnote doesn't make a list line prose)
    const structural = versionNote || listIntro || performerNote || /^\s*(?:[*#;:]|\{\{|\}\}|\||!)/.test(l) || ln.trim().length < 100 || (/^\s*(?:'''[^']|<)/.test(l) && l.length < 200) ||
      (ln.length < 250 && /\s[–—-]\s*\p{Lu}/u.test(ln) && !/[.!?]\s+\p{Lu}/u.test(ln)) || // "Title - Singers" lines without bullets (Mulan Jr.)
      (/^\s*\d{1,2}[a-z]?\.\s*(?:\{\{[^{}]*\}\}\s*)?\S/.test(ln) && ln.length < 250); // "11a. Polly's Lied (Polly's Song – Polly)<br />"
    // a long note keeps only its version sentences (with the opening/closing markup of the line)
    const note = versionNote && l.length >= 380 && !/^\s*[*#;|!{]/.test(l)
      ? `${l.match(/^\s*(?:<\w+>|'')*/)[0]}${((xs) => [...(/licen[cs]|current|standard/i.test(xs[0]) || !/production|revival|broadway|version/i.test(xs[0]) ? [] : [xs[0]]), ...xs.filter((x) => /licen[cs]|current|standard/i.test(x))].join(' '))(l.split(/(?<=[.!?])\s+/)).replace(/<\/?\w+>|''/g, '')}${(l.match(/(?:<\/\w+>|'')\s*$/) || [''])[0]}` : l;
    if (structural) out += (copyrighted && /^\s*[*#]/.test(note) ? scrubLyrics(note) : note) + '\n';
  }
  if (actorProse.length) out += '\n== Actors mentioned in prose (fixture) ==\n' + [...new Set(actorProse)].map((x) => `${x}.`).join('\n') + '\n';
  return out.replace(/\n{3,}/g, '\n\n');
}

function summary(r) {
  return JSON.stringify({ stage: r.isStageWork, section: r.section, list: r.productionList, characters: r.characters, songs: r.songs, subpages: r.subpages });
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const cache = new DiskCache(path.join(ROOT, '.cache'));
  const index = fs.existsSync(path.join(OUT, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')) : [];
  const fulls = new Map();
  const load = (e) => {
    if (e.file) return fs.readFileSync(e.file, 'utf8');
    const c = cache.get('page', e.title);
    const rev = c?.page?.revisions?.[0];
    if (!rev) throw new Error(`${e.title}: not in the cache`);
    e.pageid ??= c.page.pageid; e.revid ??= rev.revid;
    return rev.slots.main.content;
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const e of spec) {
    const full = load(e);
    fulls.set(e.title, full);
    const small = trim(full, { year: e.year });
    let a; let b;
    const opts = { title: e.title, kind: e.kind, year: e.year, lenient: e.lenient, preferList: e.preferList ?? null };
    if (e.parent) {
      const pf = fulls.get(e.parent) ?? load({ title: e.parent });
      const pa = parseArticle(pf, { title: e.parent });
      const pb = parseArticle(trim(pf), { title: e.parent });
      a = parseSubpage(full, pa, { title: e.title, mode: e.mode });
      b = parseSubpage(small, pb, { title: e.title, mode: e.mode });
    } else {
      a = parseArticle(full, opts);
      b = parseArticle(small, opts);
    }
    if (summary(a) !== summary(b)) { console.error(`SKIP ${e.title}: trimmed fixture parses differently`); continue; }
    const file = fixtureFile(e.title);
    fs.writeFileSync(path.join(OUT, file), small);
    const entry = { title: e.title, file, pageid: e.pageid ?? null, revid: e.revid ?? null, url: `https://en.wikipedia.org/w/index.php?oldid=${e.revid}`, ...(e.parent ? { parent: e.parent, mode: e.mode } : {}),
      ...(e.kind ? { kind: e.kind } : {}), ...(e.year ? { year: e.year } : {}), ...(e.lenient ? { lenient: true } : {}), ...(e.preferList ? { preferList: e.preferList } : {}) };
    const k = index.findIndex((x) => x.title === e.title);
    if (k >= 0) index[k] = entry; else index.push(entry);
    console.log(`${file}: ${full.length} → ${small.length} bytes, ${b.songs.length} songs, ${b.characters.length} characters`);
  }
  index.sort((x, y) => (x.title < y.title ? -1 : 1));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
