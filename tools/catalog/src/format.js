// The catalog.json.gz contract (SPEC §7c) as a validator, used by the build (refuses to write an
// invalid file) and by the tests.
import { songKey } from './normalize.js';

const isStr = (v) => typeof v === 'string' && v.trim() === v && v.length > 0;
const isStrOrNull = (v) => v === null || isStr(v);
const isInt = (v) => Number.isInteger(v);

/** → list of problems (empty = valid). */
export function validateCatalog(doc) {
  const errs = [];
  const err = (m) => { if (errs.length < 200) errs.push(m); };
  if (!doc || typeof doc !== 'object') return ['not an object'];
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(doc.version || '')) err(`version "${doc.version}" is not YYYY-MM-DD.N`);
  if (Number.isNaN(Date.parse(doc.generatedAt))) err('generatedAt is not an ISO date');
  if (!doc.sources || !isStr(doc.sources.wikidata) || !isStr(doc.sources.wikipedia)) err('sources.wikidata/wikipedia missing');
  if (!Array.isArray(doc.shows)) return [...errs, 'shows is not an array'];
  const keys = new Set();
  const SHOW_KEYS = ['key', 'title', 'altTitles', 'wikiTitle', 'wikidataId', 'composer', 'lyricist', 'bookWriter', 'year', 'genres', 'description', 'characters', 'songs'];
  const SONG_KEYS = ['title', 'act', 'position', 'singers', 'singersRaw', 'ensemble', 'reprise', 'instrumental'];
  for (const s of doc.shows) {
    const where = `show ${s?.key}`;
    if (JSON.stringify(Object.keys(s)) !== JSON.stringify(SHOW_KEYS)) err(`${where}: fields ${Object.keys(s).join(',')}`);
    if (!/^(?:Q\d+|wp:.+)$/.test(s.key || '')) err(`${where}: bad key`);
    if (keys.has(s.key)) err(`${where}: duplicate key`);
    keys.add(s.key);
    if (!isStr(s.title)) err(`${where}: title`);
    if (!Array.isArray(s.altTitles) || !s.altTitles.every(isStr)) err(`${where}: altTitles`);
    if (!isStrOrNull(s.wikiTitle)) err(`${where}: wikiTitle`);
    if (!(s.wikidataId === null || /^Q\d+$/.test(s.wikidataId))) err(`${where}: wikidataId`);
    if (s.wikidataId && s.key !== s.wikidataId) err(`${where}: key must equal wikidataId`);
    for (const f of ['composer', 'lyricist', 'bookWriter', 'description']) if (!isStrOrNull(s[f])) err(`${where}: ${f}`);
    if (!(s.year === null || (isInt(s.year) && s.year >= 1600 && s.year <= 2100))) err(`${where}: year ${s.year}`);
    if (!Array.isArray(s.genres) || !s.genres.every((g) => isStr(g) && g === g.toLowerCase())) err(`${where}: genres`);
    if (!Array.isArray(s.characters) || !s.characters.every((c) => c && isStr(c.name) && isStrOrNull(c.voiceType) && Object.keys(c).length === 2)) err(`${where}: characters`);
    if (!Array.isArray(s.songs)) { err(`${where}: songs`); continue; }
    const seen = new Set();
    s.songs.forEach((g, i) => {
      const w = `${where} song ${i + 1}`;
      if (JSON.stringify(Object.keys(g)) !== JSON.stringify(SONG_KEYS)) err(`${w}: fields ${Object.keys(g).join(',')}`);
      if (!isStr(g.title)) err(`${w}: title`);
      if (!(g.act === null || (isInt(g.act) && g.act >= 1 && g.act <= 20))) err(`${w}: act ${g.act}`);
      if (g.position !== i + 1) err(`${w}: position ${g.position}`);
      if (!Array.isArray(g.singers) || !g.singers.every(isStr)) err(`${w}: singers`);
      if (typeof g.singersRaw !== 'string') err(`${w}: singersRaw`);
      for (const f of ['ensemble', 'reprise', 'instrumental']) if (typeof g[f] !== 'boolean') err(`${w}: ${f}`);
      if (g.instrumental && (g.singers.length || g.ensemble)) err(`${w}: instrumental but sung`);
      const k = songKey(g.title, g.reprise);
      const k2 = `${g.title.toLowerCase()}|${g.reprise}`;
      if (seen.has(k) || seen.has(k2)) err(`${w}: duplicate "${g.title}"`);
      seen.add(k); seen.add(k2);
    });
  }
  return errs;
}
