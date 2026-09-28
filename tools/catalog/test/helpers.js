// Shared test helpers: load a trimmed fixture by article title and parse it like the builder does.
import fs from 'node:fs';
import { parseArticle, parseSubpage } from '../src/parse-songs.js';

const DIR = new URL('./fixtures/', import.meta.url);
export const index = JSON.parse(fs.readFileSync(new URL('index.json', DIR), 'utf8'));
const byTitle = new Map(index.map((e) => [e.title, e]));

export function fixtureText(title) {
  const e = byTitle.get(title);
  if (!e) throw new Error(`no fixture for ${title}`);
  return fs.readFileSync(new URL(e.file, DIR), 'utf8');
}

const cache = new Map();
/** Parse a fixture article (subpages are parsed with their parent's characters, like the build). */
export function parsed(title) {
  if (cache.has(title)) return cache.get(title);
  const e = byTitle.get(title);
  let r;
  if (e?.parent) r = parseSubpage(fixtureText(title), parsed(e.parent), { title, mode: e.mode });
  else r = parseArticle(fixtureText(title), { title, kind: e?.kind, year: e?.year, lenient: e?.lenient, preferList: e?.preferList ?? null });
  cache.set(title, r);
  return r;
}

/** The song of a show with this exact title (and reprise flag, when given). */
export function song(title, songTitle, reprise) {
  const r = parsed(title);
  const s = r.songs.find((x) => x.title === songTitle && (reprise === undefined || x.reprise === reprise));
  if (!s) throw new Error(`${title}: no song "${songTitle}" in [${r.songs.map((x) => x.title).join(' | ')}]`);
  return s;
}

/** Fake parsing context for unit tests of the normaliser. */
export function fakeCtx(characters = [], { actors = [] } = {}) {
  const names = characters;
  const n = (s) => s.toLowerCase().replace(/^the\s+/, '');
  return {
    writerSurnames: new Set(),
    compoundNames: names.filter((x) => /\s(?:and|&)\s|\//.test(x)),
    matchCharacter: (tok, exactOnly) => names.find((c) => n(c) === n(tok)) ?? (exactOnly ? null : names.find((c) => n(c).split(' ').includes(n(tok))) ?? null),
    isActor: (tok) => actors.includes(tok),
  };
}
