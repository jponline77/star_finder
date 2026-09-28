// Assembling one catalog show record from Wikidata facts (CC0), Wikipedia page metadata and the
// parsed article: display title, alternative titles, credits, year, genres. Pure functions.
import { expandTemplates, stripComments, stripRefs, stripLinks, stripFormatting, decodeEntities } from './wikitext.js';
import { fold, normalizeQuotes } from './normalize.js';
import { qidNum } from './wikidata.js';

const STAGE_DISAMBIG = /\s*\((?:[^()]*(?<![\p{L}])(?:musical|revue|operetta|opera|play|burlesque|extravaganza|pantomime|show|song cycle|comic opera|zarzuela|singspiel|opéra bouffe|opera bouffe|opérette|comédie musicale|masque|musical comedy|stage production|music drama|musical drama|parody|stage series|production|version|vaudeville|Cirque du Soleil)(?![\p{L}])[^()]*|\d{4})\)$/iu;

/**
 * Display title from the enwiki title: "Aladdin (2011 musical)" → "Aladdin"; other disambiguators
 * ("Antigone (Honegger)") are dropped when the Wikidata label is the title without them.
 */
export function displayTitle(wikiTitle, wdLabel = null) {
  const t = wikiTitle.replace(STAGE_DISAMBIG, '').trim() || wikiTitle;
  const m = t.match(/^(.*\S)\s*\(([^()]+)\)$/);
  if (m && wdLabel && fold(wdLabel) === fold(m[1])) return m[1];
  return t;
}

// ---------------------------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------------------------

const NAME_SUFFIX = /^(?:jr\.?|sr\.?|ii|iii|iv|esq\.?)$/i;
// "Music by X", "English lyrics by X", "Story by X", "Stage adaptation by X", "Lyrics: X"
const PREFIX = /^((?:[\p{L}'’.-]+\s+){0,4}?by\b:?|[\p{L}'’ .-]{2,40}:)\s*/iu;
// parts that are roles or remarks, not names
const DROP_PART = /^(?:the\s+(?:legendary\s+)?\S+\s+(?:catalog|catalogue|songbook|song book)$|(?:(?:revised|new|additional|original|vocal|dance|musical)\s+)?(?:arranged|arrangements?|orchestrat\w*|additional material|based on(?: themes)?|adapted|incidental(?: music)?|songs?\s+(?:recorded|made famous|popularized|performed|written)|various songs|conceived|concept|story|new material|et al\.?|various(?: artists| composers| writers| lyricists| authors)?|revue basis|revue|none credited|uncredited|traditional|trad\.?))$/i;
const OTHERS = /^(?:and\s+)?(?:others?|various others|many others|more)$/i;

/**
 * Names from an infobox credit field ("[[A]]<br>[[B]] (English)") → ["A", "B"] (an "and others" is dropped).
 * preferEnglish: if some names are marked "English" (Les Misérables' Herbert Kretzmer), keep only those.
 * Arrangers/orchestrators are left out.
 */
export function creditNames(raw, { preferEnglish = false } = {}) {
  if (!raw) return [];
  let s = stripRefs(stripComments(raw));
  s = s.replace(/\{\{\s*(?:plainlist|flatlist|ubl|unbulleted list|hlist|plain list|bulleted list)\s*\|/gi, '{{ubl|');
  s = expandTemplates(s).replace(/\n\s*\*+\s*/g, '\n');
  s = decodeEntities(stripFormatting(stripLinks(s))).replace(/<[^>]+>/g, ' ');
  s = normalizeQuotes(s);
  s = s.replace(/\([^()]*\)/g, (m) => m.replace(/,/g, '\u0001').replace(/\band\b/g, '\u0002').replace(/&/g, '\u0003'));
  // a couple sharing a surname: "Samuel and Bella Spewack" → "Samuel Spewack and Bella Spewack"
  s = s.replace(/(?<=^|[\n,;/]\s*)(\p{Lu}[\p{L}'’-]+)\s+(?:and|&)\s+(\p{Lu}[\p{L}'’-]+)\s+(\p{Lu}[\p{L}'’-]+)(?=\s*(?:$|[\n,;/(]))/gmu, '$1 $3 and $2 $3');
  // "Neil Gooding. Additional material by Stuart Smith": sentences are separate credits
  s = s.replace(/(?<=\p{Ll}{2})\.\s+(?=\p{Lu})/gu, '\n');
  const parts = s.split(/\s*(?:\n|\s\/\s|;|,(?!\s*(?:jr|sr)\b)|\s+and\s+|\s*&\s*|\s+·\s+)\s*/i)
    .map((x) => x.replace(/\u0001/g, ',').replace(/\u0002/g, 'and').replace(/\u0003/g, '&').trim()).filter(Boolean);
  const out = []; // (an "and others" is left out: "Max Martin and others" → "Max Martin", like "Various" credits)
  for (let p of parts) {
    if (NAME_SUFFIX.test(p) && out.length) { out[out.length - 1].name += `, ${p}`; continue; }
    if (OTHERS.test(p)) continue;
    let note = '';
    p = p.replace(/\(([^()]*)$/, (m, x) => { note += ` ${x}`; return ''; }).replace(/^[^(]*\)/, (m) => m.replace(')', '')); // unbalanced parens
    const pm = p.match(PREFIX);
    if (pm) { note += ` ${pm[1]}`; p = p.slice(pm[0].length); }
    p = p.replace(/\s*\(([^()]*)\)\s*/g, (m, x) => { note += ` ${x}`; return ' '; }).replace(/^(?:by|and|with)\s+/i, '')
      .replace(/:+$/, '').replace(/(\p{Ll}{3,})\.$/u, '$1').replace(/\s+/g, ' ').trim();
    if (/arrang|orchestrat|consult/i.test(note)) continue;
    if (OTHERS.test(p)) continue;
    // (a year or a date is a remark; a name may have digits: "KEN the 390")
    if (!p || DROP_PART.test(p) || p.length > 60 || p.split(' ').length > 6 || /\b(?:1[5-9]|20)\d\d\b|\d{1,2}\s+\p{L}+\s+\d{4}/u.test(p) || /^(?:see|n\/a|none|tba|tbd|unknown|—|-)$/i.test(p)) continue;
    if (!/^[\p{Lu}\p{Lo}"'.]/u.test(p) && !/^(?:de|van|von|da|di|le|la|du)\s/.test(p)) continue;
    // a remark, not a name: "There is no script"
    if (p.split(/\s+/).filter((w) => /^\p{Ll}/u.test(w) && !/^(?:de|van|von|da|di|le|la|du|des|del|der|den|y|e|and|of|the|bin|ibn|al|el|dos|das)$/.test(w)).length >= 2) continue;
    out.push({ name: p, note: note.trim() });
  }
  let list = out;
  if (preferEnglish && list.some((x) => /english/i.test(x.note))) list = list.filter((x) => /english/i.test(x.note));
  const seen = new Set();
  const names = list.map((x) => x.name).filter((n) => { const k = fold(n); if (seen.has(k)) return false; seen.add(k); return true; });
  return names;
}

// a list of personal names in running text: "Richard Rodgers", "Paul A. Rubens and Cecil Raleigh", "Edgar Smith, Edward Clark, and Gus Kahn"
const NAME_W = String.raw`(?:\p{Lu}\.|\p{Lu}[\p{L}'’-]*)`;
const ONE_NAME = String.raw`${NAME_W}(?:\s+(?:${NAME_W}|de|van|von|la|le|di|da|du|del|der|y|Jr\.?))*`;
const NAMES = String.raw`${ONE_NAME}(?:\s*(?:,\s*and|,|and|&)\s+${ONE_NAME})*`;
const NATIONALITY = /^(?:american|british|english|french|german|italian|austrian|hungarian|australian|canadian|irish|scottish|welsh|russian|spanish|swedish|danish|dutch|polish|czech|japanese|korean|chinese|filipino|mexican|argentine|argentinian|brazilian|belgian|swiss|norwegian|finnish|greek|israeli|south|new|original|additional|broadway|london)$/i;
const LEAD_ROLES = [
  // "music and lyrics by X", "book and lyrics by X", "music by X", "lyrics by X", "a book by X", "libretto by X"
  [new RegExp(String.raw`\bmusic and lyrics (?:are |were |is |was )?(?:both )?(?:written |composed )?by (${NAMES})`, 'gu'), ['composer', 'lyricist']],
  [new RegExp(String.raw`\bbook and lyrics (?:are |were |is |was )?(?:both )?(?:written )?by (${NAMES})`, 'gu'), ['book', 'lyricist']],
  [new RegExp(String.raw`\bbook,? music and lyrics (?:are |were |is |was )?(?:all )?(?:written )?by (${NAMES})`, 'gu'), ['book', 'composer', 'lyricist']],
  [new RegExp(String.raw`\b(?:words|lyrics) and music (?:are |were |is |was )?(?:both )?(?:written )?by (${NAMES})`, 'gu'), ['composer', 'lyricist']],
  [new RegExp(String.raw`(?<!\b(?:lyrics|words|book) and )\bmusic (?:is |was )?(?:composed |written )?by (${NAMES})`, 'gu'), ['composer']],
  [new RegExp(String.raw`(?<!\b(?:music|book|words) and )\b(?:additional )?lyrics (?:are |were |is |was )?(?:written )?by (${NAMES})`, 'gu'), ['lyricist']],
  [new RegExp(String.raw`(?<!\b(?:music|lyrics|words) and )\b(?:a |the )?(?:book|libretto) (?:is |was )?(?:written )?by (${NAMES})`, 'gu'), ['book']],
  // "the works of Richard Rodgers (music) and Lorenz Hart (lyrics)"
  [new RegExp(String.raw`(${ONE_NAME}) \(music\)`, 'gu'), ['composer']],
  [new RegExp(String.raw`(${ONE_NAME}) \(lyrics\)`, 'gu'), ['lyricist']],
  [new RegExp(String.raw`(${ONE_NAME}) \(book\)`, 'gu'), ['book']],
];
/**
 * Credits stated in the article's opening sentences (used only where the infobox and Wikidata have none): "… with music by
 * [[Jacques Presburg]] and Charles Jules; a book and lyrics by …" → { composer: [...], lyricist: [...], book: [...] }.
 * A surname used alone ("music and lyrics by Rubens") takes the full name written earlier in the lead.
 */
export function leadCredits(wikitext) {
  const out = { composer: [], lyricist: [], book: [] };
  let lead = stripComments(String(wikitext ?? '')).split(/\n==[^=]/)[0];
  lead = stripRefs(lead).replace(/\{\{\s*infobox[\s\S]*?\n\}\}/i, ' ');
  const paras = lead.split('\n').filter((l) => /^'''|^[A-Z"'[]/.test(l.trim()) && !/^\s*[{|!}*#:;=]/.test(l) && !/^\[\[(?:file|image):/i.test(l.trim()));
  const text = normalizeQuotes(decodeEntities(stripFormatting(stripLinks(expandTemplates(paras.slice(0, 2).join(' '))))))
    .replace(/\s+/g, ' ').split(/(?<=\p{Ll}{2}[.!?])\s+(?=\p{Lu})/u).slice(0, 3).join(' ');
  const full = [...text.matchAll(new RegExp(ONE_NAME, 'gu'))].map((m) => m[0]).filter((n) => n.split(' ').length >= 2);
  for (const [re, roles] of LEAD_ROLES) {
    for (const m of text.matchAll(re)) {
      // (not the source work's author: "based on the book by Roald Dahl", "adapted from the play by …")
      if (/\b(?:based (?:up)?on|adapted from|inspired by)\b[^,;.]{0,40}$/i.test(text.slice(Math.max(0, m.index - 60), m.index))) continue;
      const names = m[1].split(/\s*(?:,\s*and|,|\band\b|&)\s+/).map((n) => n.trim().replace(/\.$/, '').replace(/\s+(?:de|van|von|la|le|di|da|du|del|der|y)$/, '')).filter((n) => n && /^\p{Lu}/u.test(n))
        .map((n) => (n.split(' ').length === 1 ? full.find((f) => f.split(' ').at(-1) === n) ?? n : n))
        // a person's name: two words at least, not a nationality or "The …"
        .filter((n) => n.split(' ').length >= 2 && !/^(?:the|a|an|his|her|their)\s/i.test(n) && !NATIONALITY.test(n.split(' ')[0]));
      for (const r of roles) for (const n of names) if (!out[r].includes(n)) out[r].push(n);
    }
  }
  return out;
}

/** Join names for display: up to 6, then "and others". */
export function joinNames(names) {
  const real = names.filter((n) => n !== 'and others');
  if (!real.length) return null;
  if (real.length > 6 || real.length < names.length) return `${real.slice(0, 6).join(', ')} and others`;
  return real.join(', ');
}

// ---------------------------------------------------------------------------------------------
// Wikidata statements
// ---------------------------------------------------------------------------------------------

/** Group query-B rows of one item by property → { composer: [{v, label, precision}], … } (best rank first, QID order). */
export function groupStatements(rows) {
  const g = {};
  for (const r of rows) (g[r.prop] ||= []).push({ v: r.v, label: r.vLabel ?? null, precision: r.precision != null ? Number(r.precision) : null, rank: r.rank });
  for (const k of Object.keys(g)) {
    const preferred = g[k].filter((x) => /PreferredRank$/.test(x.rank || ''));
    const list = preferred.length ? preferred : g[k];
    const seen = new Set();
    g[k] = list.filter((x) => (seen.has(x.v) ? false : seen.add(x.v)))
      .sort((a, b) => (/^Q\d+$/.test(a.v) && /^Q\d+$/.test(b.v) ? qidNum(a.v) - qidNum(b.v) : String(a.v).localeCompare(String(b.v))));
  }
  return g;
}

const labelOk = (l) => l && !/^Q\d+$/.test(l) && !/^_:/.test(l) && !/^https?:/.test(l);
export const wdNames = (vals) => (vals || []).map((x) => x.label).filter((l) => labelOk(l) && !DROP_PART.test(l.trim()) && !OTHERS.test(l.trim()));

/** Earliest year among P1191/P577/P571 (or only `props`) with at least year precision. */
export function wikidataYear(st, props = ['firstPerf', 'published', 'inception']) {
  const ys = props
    .flatMap((p) => (st[p] || []).filter((r) => (r.precision ?? 11) >= 9 && /^[+-]?\d{4}/.test(String(r.v))))
    .map((r) => Number(String(r.v).replace(/^\+/, '').slice(0, 4)));
  const ok = ys.filter((y) => y >= 1600 && y <= new Date().getUTCFullYear() + 3);
  return ok.length ? Math.min(...ok) : null;
}

/** Year from "Category:1980 musicals" (earliest), or null. */
export function categoryYear(categories) {
  const ys = (categories || []).map((c) => c.match(/^(\d{4}) (?:musicals|operettas|revues|operas|comic operas|plays with music|zarzuelas)$/)?.[1]).filter(Boolean).map(Number);
  return ys.length ? Math.min(...ys) : null;
}

// ---------------------------------------------------------------------------------------------
// Genres
// ---------------------------------------------------------------------------------------------

// generic values that say nothing beyond "it's a musical"
const GENERIC_GENRE = new Set(['Q2743', 'Q1954953', 'Q25379', 'Q1344', 'Q58483083', 'Q842256', 'Q1370345', 'Q7725634', 'Q43099500', 'Q2973181']);
const CATEGORY_GENRES = [
  [/^Sung-through musicals$/, 'sung-through'],
  [/^Jukebox musicals$/, 'jukebox musical'],
  [/^Rock musicals$/, 'rock musical'],
  [/^Rock operas$/, 'rock opera'],
  [/^Pop(?:-| )rock musicals$/, 'pop rock musical'],
  [/^Pop musicals$/, 'pop musical'],
  [/^Hip[- ]hop musicals$/, 'hip hop musical'],
  [/^Folk musicals$/, 'folk musical'],
  [/^Country music musicals$|^Country musicals$/, 'country musical'],
  [/^Gospel musicals$/, 'gospel musical'],
  [/^Soul musicals$|^Rhythm and blues musicals$/, 'soul musical'],
  [/^Disco musicals$/, 'disco musical'],
  [/^Punk rock musicals$|^Punk musicals$/, 'punk musical'],
  [/^Musical comedies$|^Comedy musicals$|^Musical comedy$/, 'musical comedy'],
  [/^Comic operas$/, 'comic opera'],
  [/^Operettas$|^\d{4} operettas$|^Operettas by /, 'operetta'],
  [/^Revues$|^\d{4} revues$|^Musical revues$/, 'revue'],
  [/^Christmas musicals$/, 'christmas'],
  [/^Children's musicals$|^Musicals for children$/, "children's musical"],
  [/^Horror musicals$/, 'horror'],
  [/^Science fiction musicals$/, 'science fiction'],
  [/^Fantasy musicals$/, 'fantasy'],
  [/^Satirical musicals$|^Political satire musicals$/, 'satire'],
  [/^Tragedy musicals$|^Tragic musicals$/, 'tragedy'],
  [/^Romance musicals$|^Romantic musicals$/, 'romance'],
  [/^Musical parodies$|^Parody musicals$/, 'parody'],
  [/^Concept musicals$/, 'concept musical'],
  [/^Chamber musicals$/, 'chamber musical'],
  [/^One-act musicals$/, 'one-act musical'],
  [/^Plays with music$/, 'play with music'],
  [/^Savoy operas$/, 'comic opera'],
  [/^Pantomimes$/, 'pantomime'],
  [/^Song cycles$/, 'song cycle'],
];

/** Genre tags from Wikidata forms/genres, the stage kind and Wikipedia categories. */
export function genresOf({ st = {}, kind, categories = [] }) {
  const out = new Set();
  for (const r of [...(st.form || []), ...(st.genre || [])]) {
    if (GENERIC_GENRE.has(r.v) || !labelOk(r.label)) continue;
    const l = r.label.toLowerCase().trim();
    if (l.length <= 40 && !/^(?:musical|musical theatre|musical play|play|opera|stage play|dramatico-musical work|work|musical work|theatre|show tunes?|showtunes?|song|novel|march)$/.test(l) &&
        !/\b(?:film|album|television|tv|documentary|novel|video game|single)\b/.test(l)) out.add(l.replace(/^showtune$/, 'show tune'));
  }
  for (const c of categories) for (const [re, g] of CATEGORY_GENRES) if (re.test(c)) out.add(g);
  if (kind === 'operetta') out.add('operetta');
  if (kind === 'revue') out.add('revue');
  return [...out].sort().slice(0, 12);
}

// ---------------------------------------------------------------------------------------------
// Alternative titles
// ---------------------------------------------------------------------------------------------

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'musical', 'in', 'on', 'to', 'for', 'with', 'at', 'or', 'by', 'from', 'new']);
const sigWords = (s) => fold(s).split(' ').filter((w) => w && !STOP.has(w));
const initials = (s) => sigWords(s).map((w) => w[0]).join('');
const THE_MUSICAL = /(?::|\s[–—-])?\s+(?:the|a)\s+(?:new\s+)?musical$/i;

/**
 * Alternative titles: Wikidata label/aliases (trusted), a "… the Musical"-less variant, and Wikipedia
 * redirects (only those that share a significant word with the title or are its initials, and aren't
 * song titles, character names or other disambiguated pages). Deduped by folded form, max 15.
 */
export function altTitlesOf({ title, wikiTitle, wdLabels = [], wdAliases = [], redirects = [], songTitles = [], characterNames = [] }) {
  // "Sound of Music, The" / "Sound Of Music" add nothing to "The Sound of Music"
  const noArticle = (x) => fold(x).replace(/^(?:the|a|an) /, '').replace(/ (?:the|a|an)$/, '');
  const block = new Set([fold(title), fold(wikiTitle), ...songTitles.map(fold), ...characterNames.map(fold)]);
  const blockBare = new Set([noArticle(title), noArticle(wikiTitle)]);
  const out = []; const seen = new Set(block);
  const add = (raw, { trusted }) => {
    if (!raw) return;
    let a = normalizeQuotes(String(raw)).replace(/\s+/g, ' ').trim();
    a = a.replace(STAGE_DISAMBIG, '').trim();
    if (!a || a.length > 120 || a.includes('(') || /^Q\d+$/.test(a) || /\b(?:cast recording|cast album|soundtrack|original .*recording|film|movie)\b|:\s*live$/i.test(a)) return;
    // redirects / aliases for a character, a tour, fans or a catalogue heading: "Tom Collins - RENT", "RENT-heads",
    // "Rent 20th Anniversary Concert UK Tour", "Chicago The Musical Bangalore", "MacDermot, Galt, 1928- Hair"
    if (/\s-\S|\S-\s|\b(?:tours?|concerts?|productions?|anniversary|revivals?|heads?|fans?|cast|characters?|songs|album|recording)\b|\bthe musical\s+\S|,\s*\d{4}|\d{4}-/i.test(a)) return;
    const dashTail = a.match(/\s[-–—]\s+(.+)$/);
    if (dashTail && fold(dashTail[1]) === fold(title)) return; // "Tom Collins - RENT": a character of the show
    const k = fold(a);
    if (!k || seen.has(k) || blockBare.has(noArticle(a))) return;
    if (k + 's' === fold(title) || k === `${fold(title)}s`) return; // "Into the wood", "Rock musicals"
    if (!trusted) {
      // "Les mis musical", "Wicked play": a known title + a genre word adds nothing
      if (seen.has(fold(a.replace(/[\s:–—-]+(?:the\s+)?(?:musical|play|show|opera|operetta|revue|stage show)$/i, '')))) return;
      if (/\s(?:play|show)$/i.test(a) && !/\s(?:play|show)$/i.test(title)) return;
      const tw = new Set(sigWords(title));
      const shares = sigWords(a).some((w) => tw.has(w) && w.length >= 2);
      const isInitials = /^[A-Z0-9]{2,6}$/.test(a.replace(/[.\s]/g, '')) && a.replace(/[.\s]/g, '').toLowerCase() === initials(title);
      if (!shares && !isInitials) return;
      if (/^(?:list of|songs from|music of|cast of|characters of)\b/i.test(a)) return;
    }
    seen.add(k); out.push(a);
  };
  for (const l of wdLabels) add(l, { trusted: true });
  for (const l of [...wdAliases].sort()) add(l, { trusted: true });
  if (THE_MUSICAL.test(title)) add(title.replace(THE_MUSICAL, ''), { trusted: true });
  for (const r of [...redirects].sort()) {
    // "Florodora girl", "Florodora sextette": a song, a group or a character of the show, not another title for it
    if (new RegExp(String.raw`^${fold(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (?:girls?|boys?|sextettes?|sextets?|quartets?|trio|songs?|numbers?|chorus|dance|waltz|march|ballet|overture|lyrics|music|score|characters?|cast|revival)$`).test(fold(r))) continue;
    add(r, { trusted: false });
  }
  // "& Juliet" → "And Juliet" (typed with the word, searched with the word)
  if (/&/.test(title)) {
    const a = title.replace(/^&\s*/, 'And ').replace(/\s+&\s+/g, ' and ').replace(/\s+/g, ' ').trim();
    if (a !== title && !out.includes(a)) out.unshift(a);
  }
  return out.slice(0, 15);
}
