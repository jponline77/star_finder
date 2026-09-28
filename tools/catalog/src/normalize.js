// Normalisation of song-list items: inline cleanup (links, quotes, footnote markers), the
// title/singers separator, title parsing (medleys, reprises, credit/version notes), singer
// splitting and classification (characters, groups, instrumental tokens, actors) and the final
// per-show dedupe. Pure functions; the character matcher comes in through `ctx`.
import { decodeEntities, stripFormatting, stripLinks, stripRefs, expandTemplates } from './wikitext.js';

// ---------------------------------------------------------------------------------------------
// Folding & inline cleanup
// ---------------------------------------------------------------------------------------------

/** Accent/case/punctuation-insensitive key ("Do You Hear the People Sing?" → "do you hear the people sing"). */
export const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[’‘`´]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '')
  .replace(/\s+/g, ' ').trim();

/** Same as norm but keeps non-Latin letters (for titles in other scripts). */
export const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[’‘`´']/g, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Straight quotes, single spaces. */
export const normalizeQuotes = (s) => s.replace(/[“”„‟″〃]/g, '"').replace(/[‘’‚‛′]/g, "'");

/**
 * Wikitext fragment → plain text: <sup> markers dropped, links → labels (collected in `links`),
 * bold/italic dropped, entities decoded, curly quotes straightened, whitespace collapsed.
 */
export function cleanInline(s, links) {
  s = s.replace(/<sup\b[^>]*>\s*([^<]*?)\s*<\/sup>/gi, (m, c) => (/[a-z0-9]{2,}/i.test(c) && !/^[\s†‡*≠^&§€#\d]+$/.test(c) ? c : ' '));
  s = stripFormatting(stripLinks(s, (t, l) => links && links.push({ target: t, label: stripFormatting(l).trim() })));
  s = normalizeQuotes(decodeEntities(s));
  return s.replace(/\s+/g, ' ').trim();
}

/** Full cleanup of a raw wikitext fragment (refs, templates, links, formatting). */
export const plain = (s, links, warn) => cleanInline(expandTemplates(stripRefs(String(s ?? '')), warn), links);

// Footnote markers: symbols, and asterisk / "#" runs attached to or next to words or quotes.
// "#" followed by a digit is kept ("Cabinet Battle #1", "Reprise #2").
const MARKERS = /[†‡≠≈∞±☆★□■§€¤♦◊※¶⁂✝✢✣✤✥✦✧●○◆◇▲△▼▽^°¹²³⁴⁵✓✗✔✘√]+/g;
export function stripMarkers(s) {
  return s.replace(MARKERS, ' ')
    .replace(/(^|[\s"')\]–—-])[*#]+(?=[\s"'(\[–—-]|$)/g, '$1 ')
    .replace(/"\*+/g, '"').replace(/"#+(?=[\s"])/g, '"').replace(/[*#]+"/g, '"')
    .replace(/([\p{L}.)0-9!?'])[*#]+(?=[\s,;:)"'–—-]|$)/gu, '$1')
    .replace(/\(\s*[*#]+\s*\)/g, ' ')
    // legend symbols a page's key defines, written apart from the word: "Ensemble #+", "Gleb +", "Radames +"
    .replace(/\s[+*#]+(?=\s*(?:$|[,;)/]))/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Cyrillic / Greek letters that look like Latin ones ("Rosabella Clancу" with a Cyrillic "у")
const HOMOGLYPHS = { а: 'a', в: 'B', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ԛ: 'q', ԝ: 'w', А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I', Ј: 'J', Ѕ: 'S', ο: 'o', α: 'a', ν: 'v', Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X' };
/** A word written in Latin letters with a stray Cyrillic/Greek look-alike letter → all Latin (other words untouched). */
export function foldHomoglyphs(s) {
  return s.replace(/[\p{L}]+/gu, (w) => {
    const latin = (w.match(/\p{Script=Latin}/gu) || []).length;
    const other = [...w].filter((ch) => HOMOGLYPHS[ch]).length;
    return latin >= 2 && other && latin + other === [...w].length ? [...w].map((ch) => HOMOGLYPHS[ch] ?? ch).join('') : w;
  });
}

/** Top-level parenthetical groups of s → [{ start, end, inner }]. */
export function parens(s) {
  const out = []; let depth = 0; let start = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') { if (depth === 0) start = i; depth++; } else if (s[i] === ')' && depth > 0) {
      depth--;
      if (depth === 0) out.push({ start, end: i + 1, inner: s.slice(start + 1, i) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Separator between title and singers
// ---------------------------------------------------------------------------------------------

const DASHES = new Set(['–', '—', '-', '−', '‒', '―']);
/**
 * First title/singers separator outside double quotes and parentheses → { start, end } or null.
 * Dashes: " – ", " - " (hyphen needs whitespace on both sides, or a closing quote/paren on the
 * left), " -- ", " — ", U+2212/2012/2015, and an en/em dash straight after a closing quote.
 * With an odd number of quotes (unbalanced), quote tracking is switched off.
 */
export function findSeparator(s, { tightDash = false, dotDash = false } = {}) {
  const trackQuotes = (s.match(/"/g) || []).length % 2 === 0;
  let inQ = false; let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && trackQuotes) { inQ = !inQ; continue; }
    if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1);
    // list-level "Goodbye ..... The Dinky-Doos": a spaced run of dots separates
    if (dotDash && !inQ && !depth && /\s/.test(s[i - 1] ?? '') && /^(?:\.{3,}|…)\s/.test(s.slice(i))) {
      const run = s.slice(i).match(/^(?:\.{3,}|…)/)[0];
      return { start: i, end: i + run.length };
    }
    if (inQ || depth || !DASHES.has(c)) continue;
    const prev = s[i - 1] ?? ' '; const next = s[i + 1] ?? ' ';
    const dbl = c === '-' && next === '-';
    const after = s[i + (dbl ? 2 : 1)] ?? ' ';
    if (c === '-') {
      if (!dbl && !(/\s/.test(prev) || prev === '"' || prev === ')')) continue; // hyphen inside a word
      // '"If the World Should End (Reprise) " -Mary Jane': a hyphen glued to the singers after a closing quote
      if (!/\s/.test(after) && !(!dbl && /\s/.test(prev) && /["”)]\s*$/.test(s.slice(0, i)) && /\p{Lu}/u.test(after))) continue;
      if (!/\s/.test(after)) return { start: i, end: i + 1 };
    }
    // "Laundry Quintet— The Washing Machine", "Jeunesse Dorèe– Chorus of Men": an en/em dash glued to
    // the title and followed by a space and a capitalised name also separates
    const glued = c !== '-' && /\s/.test(after) && /[\p{L}.!?]/u.test(prev) && /^[\p{Lu}"(]/u.test(s.slice(i + 1).trimStart());
    const leftOk = /[\s")\]']/.test(prev) || i === 0 || (tightDash && c === '—' && /[\p{L}.!?]/u.test(prev)) || glued;
    const rightOk = /\s/.test(after) || (c !== '-' && /[\s"A-Z(\[]/.test(after));
    if (leftOk && rightOk) return { start: i, end: i + (dbl ? 2 : 1) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------------------------

const REPRISE_WORD = /\breprise\b/i;
// bare markers are removed from the title (their number is kept for naming: "(reprise 6)" → "(Reprise 6)");
// qualified ones ("Jafar Reprise", "Act 2 Reprise", "Mini-Reprise") stay as written
export const BARE_REPRISE = /^\s*(?:the\s+)?(?:(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s+)?reprise(?:\s*(?:#|no\.?|part)?\s*(\d+|[ivx]+))?\s*$/i;
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
/** Number of a bare reprise marker ("reprise 2", "reprise II", "second reprise", "reprise #3") or null. */
export function repriseNumber(inner) {
  const m = String(inner).match(BARE_REPRISE);
  if (!m) return null;
  if (m[1]) return ORDINAL[m[1].toLowerCase()];
  if (!m[2]) return null;
  return /^\d+$/.test(m[2]) ? Number(m[2]) : ROMAN[m[2].toLowerCase()] ?? null;
}
// "Title – Reprise", "Title - Reprise 2", "December, 1963 (Oh, What a Night) reprise"
const DASH_REPRISE = /(?:\s*[–—-]\s*|\s*:\s*|(?<=\))\s+)((?:(?:first|second|third|1st|2nd|3rd)\s+)?reprise(?:\s*(?:#|no\.?)?\s*(?:\d+|[ivx]+))?)\s*$/i;
const CREDIT_PAREN = /^(?:(?:music|lyrics?|words|melody|book|music and lyrics|words and music|lyric)\b|by\s|from\s|written by|composed by|arr(?:anged)?\.?(?:\s|$)|arrangement\b|traditional|trad\.)/i;
const VERSION_NOTE = /\b(replaced|replaces|renamed|retitled|in (?:the )?(?:19|20)\d\d|revival|productions?|only in|cut from|added (?:in|for)|not (?:in|on) the)\b/i;
const VERSION_PAREN = /^\*?(?:added|cut|only|reinstated|restored|follows|precedes|replaced|replaces|not in|omitted|dropped|new in|in the \d{4}|in \d{4}|\d{4} (?:only|revival|version)|revival only|broadway only|london only|west end only|film only|\d{4} film only|not on|not included|optional|new song)\b/i;
// "(2004–2009)", "(2009–present)", "(1996)": the years a number was in the show — a version note
const YEAR_PAREN = /^((?:1[89]|20)\d\d)(?:\s*(?:[–—-]|to)\s*((?:1[89]|20)\d\d|present|now|current|today)|(?:\s*[/,]\s*(?:1[89]|20)\d\d)+)?$/i;
const FILM_ONLY = /\b(?:film|movie)\b[^()]*\bonly\b|^\d{4} film$/i;
// explanatory notes: "(including …)", "(also known as …)", "(Vocal Arrangement by …)", "(to the tune of …)",
// "(includes "All Choked Up")", "(which is Hungarian for …)", "(short)", "(Theme Song from The Greatest American Hero)"
const NOTE_PAREN = /^(?:including|includes?|incl\.|incorporating|contains?|containing|featuring|also known as|a\.?k\.?a\.?|aka|alt\.|alternately|alternatively|also called|sometimes|originally|formerly|known as|later known as|previously|sung (?:in|over|to|during|before|after|by)|with apologies|see |note:|to the tune of|tune:|based on|replacing|in place of|performed by|recorded by|vocals? by|lead vocals?|interpolated|interpolation|which (?:is|was|means)\b|short$|long$|full$|abridged|extended|excerpts?$|theme (?:song )?(?:from|of|to)\b|from the (?:film|movie|tv|television|album|musical)\b|original(?:ly)? (?:by|performed|recorded)\b|original artist|cover of\b|new song$|this (?:song|number) (?:was|is)\b)\b|\b(?:arrangement|arranged|orchestrations?|orchestrated|adapted|adaptation|translated|translation|written|composed)\s+by\b/i;
const REPRISE_OF = /^(?:a\s+)?reprise of\b/i;
// a lyric excerpt used as a subtitle: "The Ballad of Sweeney Todd: '...Lift Your Razor High, Sweeney!'"
const LYRIC_FRAGMENT = /\s*:\s*'(?:(?:\.{3}|…)[^]*?|[^]*?(?:\.{3}|…)[!?.,]?)'(?=\s*(?:\(|\/|"|$))/g;
// a quoted lyric excerpt used as a track name ends with an ellipsis ("Sometimes my father appeared to …");
// a leading one is part of real titles ("...Baby One More Time")
const ELLIPSIS_LINE = /\S\s+\S+(?:\.{3}|…)[!?.,]?$/;
const SMALL_WORD = /^(?:a|an|the|of|in|on|at|to|for|and|or|but|with|by|from|as|is|it|my|me|i|you|your|we|our|he|she|his|her|they|their)$/i;
/** A sentence-case line ending in an ellipsis ("Read a book...", "Sometimes my father appeared to enjoy …") is a lyric
 * excerpt; a Title-Case one is a real title ("Why So Silent…?", "Track Down This Murderer…"). */
export const lyricExcerpt = (t) => ELLIPSIS_LINE.test(t) && (() => {
  const w = t.replace(/(?:\.{3}|…)[!?.,]?$/, '').split(/\s+/).slice(1).filter((x) => /\p{L}/u.test(x));
  return w.filter((x) => /^\p{Ll}/u.test(x) && !SMALL_WORD.test(x)).length >= 1 && w.filter((x) => /^\p{Ll}/u.test(x)).length >= w.length * 0.5;
})();

// a parenthetical gloss in another script ("(나의 방안에)", "(Korean title: 우린 왜 사랑했을까)", "(lit. In My Room)")
const NON_LATIN = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Armenian}\p{Script=Georgian}]/u;
const GLOSS_PAREN = /^(?:(?:korean|japanese|chinese|mandarin|cantonese|hebrew|russian|german|french|spanish|italian|swedish|dutch|hungarian|czech|polish|original|english|literal|native)\s+(?:title|translation|name)\s*:|lit\.?(?:\s|:)|literally\b|transl?\.?\s*:)/i;
const glossParen = (x) => GLOSS_PAREN.test(x) || NON_LATIN.test(x.match(/\p{L}/u)?.[0] ?? '') || (NON_LATIN.test(x) && (x.match(/\p{Script=Latin}/gu) || []).length < (x.match(/\p{L}/gu) || []).length * 0.5);
// a sentence of prose in parentheses: "(This song was nearly cut, but was restored shortly before the first night.)"
const proseParen = (x) => x.split(/\s+/).length >= 6 && /\.$/.test(x) && /\b(?:was|were|is|are|has|had|been|became)\b/.test(x);
// "leading to a reprise of Now to the banquet we press", "segues into …", "followed by …"
const SEGUE_PAREN = /^(?:lead(?:s|ing)? (?:in)?to|segues? (?:in)?to|segueing (?:in)?to|followed by|then|into|continu(?:es|ing) (?:in)?to|and then)\b/i;
// wrapping single quotes of a lyric-line title: " 'Ah, Christine…!' " (not "'Twas", "Rock 'n' Roll")
const unwrapSingle = (x) => (/^'(?=[\p{Lu}.…])[^]*[^\s]'$/u.test(x) && !/^'(?:tis|twas|til|cause|n)\b/i.test(x) ? x.slice(1, -1).trim() : x);
// "(Hōseki's Lullaby – Reprise)": a reprise marker at the end of a qualifying parenthetical
const PAREN_DASH_REPRISE = /^(.*\S)(?:\s+[–—-]\s*|\s*[–—]\s*)((?:(?:first|second|third)\s+)?reprise(?:\s*(?:#|no\.?)?\s*(?:\d+|[ivx]+))?)$/i;

// function words of French / Spanish / German / Italian titles, and of English glosses
export const FOREIGN_WORD = /(?:^|[\s'’("])(?:les?|la|l|au|aux|j|un|une|des|du|de|et|à|mon|ma|mes|qui|que|quand|on|ne|pas|je|tu|il|elle|nous|vous|est|el|los|las|y|con|por|del|der|die|das|und|ein|eine|ich|ist|nicht|mein|lo|gli|di|che|per|non|io|è)(?=[\s'’"]|$)/i;
export const ENGLISH_WORD = /\b(?:the|of|to|my|your|you|is|in|a|and|we|i|me|it|this|that|for|with|on|what|who|when|how|are|be|do|love|song|day|let|us|here|there)\b/i;
const foreignText = (x) => FOREIGN_WORD.test(x) || /[àâäçéèêëîïôöœùûüñß]/i.test(x);
/** One side reads as French/Spanish/German/Italian and the other as English: a title and its translation. */
export const translationPair = (a, b) => (foreignText(a) && ENGLISH_WORD.test(b) && !foreignText(b)) || (foreignText(b) && ENGLISH_WORD.test(a) && !foreignText(a));

/**
 * Parse the title part of a list item.
 * → { title, reprise, repriseNo, instrumental, medley, filmOnly, prose, lyric, until, notes[] }
 *   repriseNo: the source's reprise number (2 for "(Reprise 2)" / "(reprise II)"), else null;
 *   lyric: the title is a quoted lyric excerpt ("Sometimes my father appeared to enjoy …");
 *   until: last year of a "(2004–2009)" version note (Infinity for "(2009–present)"), else null.
 * Medleys: separately quoted parts are joined by " / "; a slash inside one quoted title keeps the source's
 * spacing ("Valjean Arrested/Valjean Forgiven", "So Big/So Small"). A reprise marker on one part of a medley
 * stays on that part ("No Matter What (Reprise) / Wolf Chase") and the number is a reprise when its first part
 * is; markers on every part are removed and the number is a reprise.
 */
export function parseTitle(t, ctx) {
  const flags = { reprise: false, repriseNo: null, instrumental: false, medley: false, filmOnly: false, prose: false, lyric: false, until: null, notes: [] };
  const writerSurnames = ctx?.writerSurnames ?? new Set();
  if (/^\s*"[^"]*'\s*$/.test(t)) t = t.replace(/'\s*$/, '"'); // "Spring Fete' — a mistyped closing quote
  if (!ctx?.publicDomain) t = t.replace(LYRIC_FRAGMENT, ''); // (a public-domain operetta's first line may name the number)
  t = foldHomoglyphs(t);
  const drop = (inner) => {
    const x = inner.trim();
    const y = x.match(YEAR_PAREN);
    if (y) { flags.notes.push(x); if (y[2]) flags.until = Math.max(flags.until ?? 0, /^\d/.test(y[2]) ? Number(y[2]) : Infinity); return true; }
    if (REPRISE_OF.test(x)) { flags.reprise = true; flags.notes.push(x); return true; }
    if (SEGUE_PAREN.test(x)) { flags.notes.push(x); return true; }
    if (FILM_ONLY.test(x)) { flags.filmOnly = true; return true; }
    // "(known as "I've been to the Durbar")": the other name the number goes by stays searchable in the title
    const aka = x.match(/^(?:also |better |later )?(?:known as|a\.?k\.?a\.?|aka)\s+"([^"]{2,60})"$/i);
    if (aka) { flags.aka = aka[1].trim(); return true; }
    if (NOTE_PAREN.test(x) || glossParen(x) || proseParen(x)) { flags.notes.push(x); return true; }
    // "Waltzing Matilda (in Mandarin)": how it is staged, not its title
    if (/^(?:sung |performed )?in (?:mandarin|chinese|cantonese|english|french|german|italian|spanish|japanese|korean|latin|hebrew|yiddish|russian|dutch|swedish|portuguese|polish|hungarian|czech|welsh|irish|gaelic|zulu|swahili|hindi|tagalog)$/i.test(x)) { flags.notes.push(x); return true; }
    // "The War (''Les Preludes'' by Franz Liszt)": the source piece and its composer
    if (/^[^()]{1,60}\sby\s+\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){1,3}$/u.test(x) && x.split(/\s+/).length <= 10) { flags.notes.push(x); return true; }
    if (CREDIT_PAREN.test(x) || VERSION_PAREN.test(x) || (VERSION_NOTE.test(x) && (x.split(' ').length > 3 || /production|revival|version/i.test(x)))) { flags.notes.push(x); return true; }
    if (/^(?:instrumental|inst\.?|instr\.?)$/i.test(x)) { flags.instrumental = true; return true; }
    if (writerSurnames.size && x.split(/\s*(?:\/|,|&|\band\b)\s*/).every((p) => p && writerSurnames.has(norm(p)))) { flags.notes.push(x); return true; }
    return false;
  };
  const removeParens = (s) => {
    let out = s;
    for (const p of parens(s).reverse()) {
      // ("Friend Like Me (Reprise) (Ashman)/Proud of Your Boy": the space before a dropped note glued to a slash goes too)
      if (drop(p.inner)) out = (/^[/)]/.test(out.slice(p.end)) ? out.slice(0, p.start).replace(/\s+$/, '') : out.slice(0, p.start)) + out.slice(p.end);
      else if (p.inner.includes('(')) out = out.slice(0, p.start) + '(' + removeParens(p.inner) + ')' + out.slice(p.end);
    }
    return out.replace(/\s+/g, ' ').replace(/\s+\)/g, ')').replace(/\(\s+/g, '(').trim();
  };
  t = removeParens(t);
  // reprise markers of one title (no medley): bare ones are removed (their number kept), qualified ones stay;
  // "(Hōseki's Lullaby – Reprise)" → "(Hōseki's Lullaby)"
  const bareReprise = (s, onRep) => {
    let out = s;
    for (const p of parens(s).reverse()) {
      if (!REPRISE_WORD.test(p.inner) || p.inner.includes('/') || p.inner.length >= 40) continue;
      const dr = p.inner.match(PAREN_DASH_REPRISE);
      if (dr) { onRep(repriseNumber(dr[2])); out = `${out.slice(0, p.start)}(${dr[1].trim()})${out.slice(p.end)}`; continue; }
      onRep(repriseNumber(p.inner));
      if (BARE_REPRISE.test(p.inner)) out = (out.slice(0, p.start) + out.slice(p.end)).trim();
    }
    const d = out.match(DASH_REPRISE);
    if (d) { onRep(repriseNumber(d[1])); out = out.slice(0, d.index).trim(); }
    return out.replace(/\s+/g, ' ').trim();
  };
  const marker = (no) => (no > 1 ? ` (Reprise ${no})` : ' (Reprise)');
  // parts of a medley → title + flags (markers kept on the parts that carry them unless every part does)
  const joinParts = (parts, sep) => {
    const all = parts.every((p) => p.reprise);
    if (all || parts[0].reprise) { flags.reprise = true; flags.repriseNo = parts.find((p) => p.no)?.no ?? null; }
    return parts.map((p) => p.title + (p.reprise && !all ? marker(p.no) : '')).join(sep);
  };
  // one title with an inner slash ("Ogre Transformation/Susanoo and the Dragon (Reprise)"): a marker belongs to its part
  const slashParts = (s, sep) => {
    const parts = []; const seps = []; let depth = 0; let cur = '';
    for (let i = 0; i < s.length; i++) { // split at slashes outside parentheses, keeping each separator as written
      const c = s[i];
      if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1);
      if (c === '/' && !depth) {
        const sep = s.slice(i).match(/^\/\s*/)[0]; const lead = cur.match(/\s*$/)[0];
        parts.push(cur.slice(0, cur.length - lead.length)); seps.push(lead + sep); cur = ''; i += sep.length - 1; continue;
      }
      cur += c;
    }
    parts.push(cur);
    if (parts.length < 2) return null;
    if (!parts.some((p) => REPRISE_WORD.test(p)) || parts.some((p) => !p.trim())) return null;
    const ps = parts.map((p) => { let rep = false; let no = null; const title = bareReprise(p.trim(), (n) => { rep = true; no ??= n; }); return { title, reprise: rep, no }; });
    if (!ps.some((p) => p.reprise)) return null;
    const all = ps.every((p) => p.reprise);
    if (all || ps[0].reprise) { flags.reprise = true; flags.repriseNo = ps.find((p) => p.no)?.no ?? null; }
    return ps.map((p, i) => p.title + (p.reprise && !all ? marker(p.no) : '') + (i < seps.length ? (sep ?? seps[i]) : '')).join('');
  };

  let title;
  const quoteCount = (t.match(/"/g) || []).length;
  if (quoteCount >= 2 && t.trimStart().startsWith('"')) {
    // one or more quoted segments, each optionally followed by parentheticals: "A" (x) / "B"
    const segs = []; const joiners = [];
    const re = /"([^"]*)"\s*((?:\([^()]*(?:\([^()]*\)[^()]*)*\)\s*)*)/g;
    let m; let lastEnd = 0;
    while ((m = re.exec(t))) {
      joiners.push(t.slice(lastEnd, m.index).trim()); lastEnd = re.lastIndex;
      let rep = false; let no = null; const mods = [];
      const inner = unwrapSingle(m[1].trim().replace(/[,;:]$/, '').trim());
      let segTitle = bareReprise(inner, (n) => { rep = true; no ??= n; });
      if (/^reprise of\s+\S/i.test(segTitle)) { segTitle = segTitle.replace(/^reprise of\s+/i, ''); rep = true; } // "Reprise of Three Loves"
      if (/\s[–—-]\s*instrumental$/i.test(segTitle)) { segTitle = segTitle.replace(/\s*[–—-]\s*instrumental$/i, ''); flags.instrumental = true; }
      if (!/\.\s/.test(segTitle)) segTitle = segTitle.replace(/(?<=\s\p{L}*\p{Ll}{3,})\.$/u, ''); // "Nobles of Castilian birth." (not "Franklin Shepard, Inc.", "Now. Here. This.")
      if (lyricExcerpt(segTitle)) flags.lyric = true;
      let trailingRep = false;
      for (const p of parens(m[2] || '')) {
        if (REPRISE_WORD.test(p.inner) && !p.inner.includes('/') && p.inner.length < 40) {
          rep = true; trailingRep = true; no ??= repriseNumber(p.inner); if (!BARE_REPRISE.test(p.inner)) mods.push(p.inner.trim());
        } else if (/^\s*"[^"]+"\s*$/.test(p.inner) && !GENERIC_TITLE.test(segTitle)) flags.notes.push(p.inner.trim()); // '"Quand on arrive en ville" ("When We Come to Town")': a gloss or another name (not '"Finale" ("This is Our Story")')
        else if (!drop(p.inner)) mods.push(p.inner.replace(/"/g, '').trim());
      }
      segs.push({ title: segTitle + mods.map((x) => ` (${x})`).join(''), reprise: rep, no, inner, trailingRep });
    }
    let tail = t.slice(lastEnd).trim();
    // "December, 1963 (Oh, What a Night)" reprise / "Title" – Reprise
    const tr = tail.match(/^[–—-]?\s*((?:(?:first|second|third)\s+)?reprise(?:\s*(?:#|no\.?)?\s*(?:\d+|[ivx]+))?)$/i);
    if (tr && segs.length) { segs.forEach((s) => { s.reprise = true; s.no ??= repriseNumber(tr[1]); }); tail = ''; }
    // "Stay, we must not lose our senses" ... "Here's a first-rate opportunity": one number in parts
    const ellipsisJoin = segs.length > 1 && joiners.slice(1).every((j) => /^(?:\.{3}|…)$/.test(j.trim()));
    if (ellipsisJoin) segs.splice(0, segs.length, { title: segs.map((x) => x.title).join(' … '), reprise: segs.some((x) => x.reprise), no: segs.find((x) => x.no)?.no ?? null, inner: '' });
    // prose guard: text between quoted titles must be joiners only
    const badJoin = !ellipsisJoin && joiners.slice(1).some((j) => !/^(\/|&|and|,|\+|–|-|—|into|medley:?|segue:?)?$/i.test(j.replace(/\s+/g, ' ').trim()));
    if (badJoin || tail.split(/\s+/).length > 3) flags.prose = true;
    if (tail && REPRISE_WORD.test(tail)) segs.forEach((s) => { s.reprise = true; });
    // "Think Vulgar" (2002) "Act English" (2003–present): alternatives of one slot → keep the current one
    if (segs.length > 1 && flags.until === Infinity && joiners.slice(1).every((j) => !j)) segs.splice(0, segs.length - 1);
    if (segs.length === 1) {
      const sg = segs[0];
      // "Ogre Transformation/Susanoo and the Dragon (Reprise)": a marker on the last part of an inner medley
      const inner = sg.reprise && /\//.test(sg.title) ? slashParts(sg.inner + (sg.trailingRep ? ' (Reprise)' : ''), null) : null;
      if (inner) title = inner; else { title = sg.title; flags.reprise = flags.reprise || sg.reprise; flags.repriseNo = sg.no; }
    } else {
      flags.medley = true;
      title = joinParts(segs, ' / ');
      if (tr) { flags.reprise = true; title = segs.map((s) => s.title).join(' / '); }
    }
  } else {
    // unquoted title, or "Prefix: "Quoted"" → drop the quote characters, keep the text
    let u = unwrapSingle(t.replace(/"/g, '').trim());
    const ro = u.match(/^reprise of\s+(\S.*)$/i); // "Reprise of Three Loves"
    if (ro) { u = ro[1]; flags.reprise = true; }
    const sp = slashParts(u, null);
    if (sp) title = sp;
    else {
      title = bareReprise(u, (n) => { flags.reprise = true; flags.repriseNo ??= n; });
      if (REPRISE_WORD.test(title.replace(/\([^()]*\/[^()]*\)|\([^()]{40,}\)/g, ' '))) flags.reprise = true;
    }
    if (/\s[–—-]\s*instrumental$/i.test(title)) { title = title.replace(/\s*[–—-]\s*instrumental$/i, ''); flags.instrumental = true; }
    if (lyricExcerpt(title)) flags.lyric = true;
  }
  if (!flags.reprise && /(?:^|\s)reprise$/i.test(title)) flags.reprise = true; // "Spilsbury Reprise"
  title = title.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').replace(/\s*\/(?:\s*\/)+\s*/g, ' / ').replace(/^\/\s*|\s*\/$/g, '').replace(/\s+/g, ' ').trim();
  if (/\((?:instrumental|inst\.?|instr\.?)\)/i.test(title)) { flags.instrumental = true; title = title.replace(/\s*\((?:instrumental|inst\.?|instr\.?)\)/i, '').trim(); }
  if (/^\([^()]+\)$/.test(title) && GENERIC_TITLE.test(title.slice(1, -1).trim())) title = title.slice(1, -1).trim(); // Orange Blossoms "(Opening)", "(Finale)"
  if (flags.aka && !fold(title).includes(fold(flags.aka))) title = `${title} (${flags.aka})`;
  delete flags.aka;
  title = title.replace(/\((reprise)\s+(i{1,3}|iv|v|vi{1,3}|ix|x)\)/gi, (m, r, n) => `(Reprise ${ROMAN[n.toLowerCase()]})`); // "(Reprise I)" → "(Reprise 1)"
  return { title, ...flags };
}

// ---------------------------------------------------------------------------------------------
// Singers
// ---------------------------------------------------------------------------------------------

export const INSTR_TOKEN = /^(?:the )?(?:orchestra|orchestre|orchester|orquesta|orchestral(?: piece| music)?|instrumental|band|the band|pit(?: band| orchestra)?|music|underscore|underscoring|orchestra and band|house band|onstage band)$/i;
export const INSTR_TITLE = /^(?:act (?:\d|i{1,3}|iv|one|two|three) )?(?:(?:original|revised|new|grand|concert|festival|opening|london|broadway) (?=overture|ouverture))?(?:overture|stage music|ouverture|obertura|ouvertüre|overtura|sinfonia|entr[’']?\s?acte|entracte|exit music|play-?off|play ?out|bows|curtain call|underscor(?:e|ing)|scene change|change of scene|dance break|intermezzo|interlude|walk-?out|chaser|utility|incidental music|fanfare|vamp|segue|prelude|main title|end credits|introduction)\b/i;
// dance / march numbers: instrumental only when the list names nobody at all. The whole title must be the
// label ("Dance", "Dance at the Gym", "March of the Toys", "Grand March") — "Dance With Me" is a song
export const DANCE_TITLE = /^(?:act (?:\d|i{1,3}|iv|one|two|three) )?(?:the\s+)?(?:(?:ballet|dance|danse)(?:\s+(?:of|at|in|on|for|to)\s+the\s+.+)?|processional|pas de (?:deux|trois|quatre)|minuet|gavotte|hornpipe|polka|mazurka|galop|tarantella|cakewalk|march|grand march|marche|waltz|waltzes|valse|lanciers|quadrilles?|schottische|cotillion|melodrama|incidental music|scene music|transition music|chase music|dance music|ballet music)(?:\s+(?:\d+|[ivx]+|no\.?\s*\d+|break|sequence|number|specialty|interlude|music))?$/i;
export const STRONG_INSTR_TITLE = /^(?:overture|ouverture|obertura|ouvertüre|overtura|entr[’']?\s?acte|entracte|exit music|play-?off|play ?out|walk-?out|underscor(?:e|ing)|scene change|change of scene)$/i;
const ENSEMBLE_TOKEN = /(?:^|\s)(?:company|ensemble|ensamble|chorus|cast|full cast|choir|all|others|all others|the others|everyone|everybody|chœur|choeur|chœurs|choeurs|coro|chor|tous|tutti|todos|alle)$/i;
const GROUP_WORDS = [
  'robbers', 'highway robbers', 'bandits', 'firefighters', 'firemen', 'samurai', 'ninjas', 'crew', "ship's crew", 'gang',
  'chain gang', 'girls', 'boys', 'men', 'women', 'ladies', 'gentlemen', 'guys', 'dolls', 'kids', 'children', 'students',
  'soldiers', 'sailors', 'townspeople', 'townsfolk', 'villagers', 'citizens', 'workers', 'nuns', 'monks', 'orphans',
  'guests', 'couples', 'friends', 'family', 'families', 'crowd', 'people', 'mourners', 'patrons', 'staff', 'cops',
  'police', 'policemen', 'reporters', 'salesmen', 'salesgirls', 'salespeople', 'shopgirls', 'hairdressers', 'dressers',
  'aristocrats', 'generals', 'advisers', 'advisors', 'apostles', 'disciples', 'priests', 'lovers', 'thieves', 'beggars',
  'whores', 'prostitutes', 'hookers', 'constables', 'onlookers', 'hostages', 'knights', 'guards', 'creatures',
  'performers', 'opportunists', 'carolers', 'carollers', 'devils', 'demons', 'angels', 'skeletons', 'members',
  'dancers', 'singers', 'voices', 'figures', 'spirits', 'ghosts', 'fairies', 'animals', 'rats', 'lunatics', 'customers',
  'inmates', 'prisoners', 'convicts', 'murderesses', 'photographers', 'tourists', 'passengers', 'locals', 'islanders',
  'witches', 'zombies', 'vampires', 'pirates', 'cowboys', 'farmers', 'ranchers', 'cheerleaders', 'jocks', 'nerds',
  'teens', 'teenagers', 'bridesmaids', 'waiters', 'waitresses', 'nurses', 'doctors', 'patients', 'souls', 'residents',
  'neighbors', 'neighbours', 'servants', 'maids', 'footmen', 'courtiers', 'ministers', 'senators', 'delegates',
  'mathletes', 'sisters', 'brothers', 'twins', 'triplets', 'quartet', 'quintet', 'trio', 'sextet', 'octet', 'choristers',
  'chorines', 'showgirls', 'chorus girls', 'hot box girls', 'newsies', 'jets', 'sharks', 'mormons', 'ugandans', 'ozians',
  'storytellers', 'fates', 'wives', 'husbands', 'mothers', 'fathers', 'parents', 'daughters', 'sons', 'elders',
  'seniors', 'juniors', 'freshmen', 'classmates', 'campers', 'scouts', 'travelers', 'travellers', 'pilgrims',
  'refugees', 'immigrants', 'rebels', 'revolutionaries', 'protesters', 'strikers', 'vendors', 'merchants', 'peddlers',
  'shoppers', 'diners', 'drinkers', 'gamblers', 'gangsters', 'mobsters', 'hoods', 'thugs', 'henchmen', 'minions',
  'followers', 'fans', 'admirers', 'suitors', 'groupies', 'mermaids', 'sea creatures', 'fish', 'birds', 'cats', 'dogs',
  'toys', 'puppets', 'trees', 'flowers', 'shadows', 'dreamers', 'chipmunks', 'townswomen', 'townsmen', 'countrymen',
  'swings', 'understudies', 'backup singers', 'backup group', 'backing vocalists', 'vocalists', 'hobbits', 'elves',
  'dwarves', 'orcs', 'munchkins', 'monkeys', 'winkies', 'teachers', 'pupils', 'cadets', 'recruits', 'marines', 'troops',
  'officers', 'sergeants', 'bridesmaids', 'debutantes', 'flappers', 'chorus boys', 'chorus line', 'dance hall girls',
  'clerks', 'socs', 'greasers', 'clientele', 'league', 'nations', 'regulars', 'mob', 'army', 'navy', 'court', 'council',
  'committee', 'jury', 'congregation', 'parliament', 'senate', 'troupe', 'club', 'society', 'union', 'posse', 'squad',
  'team', 'class', 'assembly', 'audience', 'public', 'press', 'populace', 'peasants', 'peasantry', 'gentry', 'nobility',
  'clergy', 'english', 'german', 'french', 'italian', 'spanish', 'russian', 'american', 'british', 'irish', 'scottish',
  'dutch', 'sirens', 'nymphs', 'muses', 'furies', 'graces', 'maidens', 'ushers', 'americans', 'mexicans', 'germans',
  'africans', 'europeans', 'cubans', 'puerto ricans', 'dominicans', 'koreans', 'filipinos', 'greeks', 'romans', 'trojans',
  'spartans', 'hungarians', 'mourners', 'jurors', 'bystanders', 'passersby', 'onlookers', 'chorines', 'hostesses',
  'band', 'mission band', 'bums', 'g\\.\\s?i\\.\\s?s', 'gis', 'widows', 'paparazzi', 'principals', 'secretaries', 'statues',
  'sweeps', 'chimney sweeps', 'trucks', 'engines', 'coaches', 'carriages', 'sleepers', 'kats', 'kit kats', 'nus', 'delta nus',
  'ladies-in-waiting', 'ladies in waiting', 'queens', 'kings', 'community', 'sightseers', 'barkers', 'dandies',
  'stevedores', 'gals', 'hop-pickers', 'bridesmaids', 'harvesters', 'reapers', 'vintagers', 'huntsmen', 'hunters',
  'gondoliers', 'contadine', 'peers', 'dragoons', 'heavy dragoons', 'rapturous maidens', 'fairies', 'bridesmaids',
  'courtesans', 'geishas', 'geisha', 'tea girls', 'dancing girls', 'flower girls', 'chorus of .+', 'ensemble of .+',
  // collective / plural nouns found as singers in the catalog audits ("Tribe" in Hair, "Whos" in Seussical …)
  'tribe', 'tribes', 'duo', 'lads', 'lasses', 'siblings', 'players', 'slaves', 'shirts', 'blue shirts', 'suspects',
  'wildcats', 'banshees', 'hunks', 'immortals', 'acolytes', 'irregulars', 'riffs', 'puritans', 'roundheads', 'cavaliers',
  'saints', 'sinners', 'brides', 'grooms', 'bridegrooms', 'seabees', 'whos', 'hunches', 'wickershams', 'plaids',
  'thoughts', 'paintings', 'portraits', 'moles', 'assassins', 'souljas', 'clan', 'clans', 'coven', 'robots', 'aliens', 'monsters', 'goblins', 'trolls', 'ogres',
  'wizards', 'eunuchs', 'entourage', 'harem', 'wenches', 'milkmaids', 'shepherds', 'shepherdesses', 'fishermen',
  'miners', 'lumberjacks', 'bellhops', 'lawyers', 'politicians', 'voters', 'businessmen', 'bankers', 'socialites',
  'celebrities', 'acrobats', 'clowns', 'freaks', 'musicians', 'minstrels', 'heralds', 'squires', 'noblemen', 'nobles',
  'princesses', 'friars', 'rabbis', 'preachers', 'believers', 'worshippers', 'zealots', 'lepers', 'troopers',
  'musketeers', 'grenadiers', 'hussars', 'gladiators', 'spectators', 'supporters', 'suffragettes', 'anarchists',
  'spies', 'detectives', 'gendarmes', 'deputies', 'outlaws', 'desperadoes', 'rustlers', 'cowhands', 'settlers',
  'pioneers', 'colonists', 'patriots', 'loyalists', 'redcoats', 'yankees', 'confederates', 'hippies', 'punks',
  'bikers', 'surfers', 'sophomores', 'coeds', 'schoolgirls', 'schoolboys', 'schoolchildren', 'youths', 'widows',
  'urchins', 'newsboys', 'costermongers', 'pickpockets', 'crooks', 'burglars', 'swindlers', 'hustlers', 'harlots',
  'tramps', 'hobos', 'hoboes', 'vagabonds', 'drunks', 'madmen', 'orderlies', 'scientists', 'scholars', 'governesses',
  'nannies', 'butlers', 'valets', 'coachmen', 'gardeners', 'serfs', 'labourers', 'laborers', 'millworkers',
  'mill girls', 'dockers', 'longshoremen', 'mariners', 'seamen', 'whalers', 'airmen', 'pilots', 'astronauts',
  'stewards', 'stewardesses', 'porters', 'bridesmaids', 'groomsmen', 'party guests', 'wedding guests', 'dinner guests',
  'rangers', 'gargoyles', 'yuppies', 'caterpillars', 'butterflies', 'fireflies', 'braves', 'backups', 'executives',
  'roustabouts', 'showmen', 'stagehands', 'ushers',
  // round 3 (groups kept as singers gave false Solo/Duet guesses: "Associates", "The Sixth Form", "Metal Imps" …)
  'associates', 'forms?', 'imps', 'crows', 'jitterbugs', 'doubles', 'employees', 'personnel', 'cherubs', 'cherubim',
  'seraphim', 'models', 'lords', 'warlords', 'varmints', 'turks', 'swallows', 'starlets', 'schoolkids', 'penguins',
  'pariahs', 'mandarins', 'kittens', 'insects', 'housemaids', 'hedgehogs', 'hebrews', 'gulls', 'seagulls', 'gossips',
  'gobs', 'ghouls', 'foundlings', 'flunkeys', 'elephants', 'débutantes', 'diplomats', 'cooks', 'companions', 'cockneys',
  'clouds', 'chefs', 'brainiacs', 'beatniks', 'barmaids', 'adults', 'admirals', 'mods', 'moderns', 'blokes',
  'scoundrels', 'death eaters', 'movie stars', 'stars', 'criminals', 'lambs', 'shoeblacks', 'mascots', 'girlfriends',
  'boyfriends', 'machines', 'oompa loompas', 'squirrels', 'automatons', 'partisans', 'santas', 'goons', 'authors',
  'mums', 'dads', 'hazelnuts', 'razorbacks', 'serenaders', 'blowers', 'sultans', 'tongs', 'frogs', 'turtles', 'mock turtles',
  'reporters', 'journalists', 'bridesmaids', 'witnesses', 'jurymen', 'cupids', 'cadets', 'valkyries',
  'harpies', 'gorgons', 'titans', 'giants', 'dwarfs', 'pixies', 'sprites', 'nixies', 'gnomes', 'brownies', 'imps',
  'lemmings', 'bees', 'ants', 'spiders', 'bats', 'wolves', 'bears', 'lions', 'tigers', 'horses', 'cows', 'pigs', 'sheep',
  'pimps', 'extras', 'sylphs', 'sylphides', 'silphides', 'goats', 'chickens', 'hens', 'ducks', 'geese', 'mice', 'owls', 'ravens', 'rabbits', 'bunnies', 'foxes', 'weasels',
  'stoats', 'otters', 'toads', 'snakes', 'serpents', 'dragons', 'unicorns', 'fireflies', 'moths', 'beetles', 'cockroaches',
].join('|');
// number types that sometimes stand where the singers should be ("Ballade", "Duet", "Finale")
const NUMBER_TYPE = /^(?:concerted|ballade?|aria|arietta|romance|romanze|couplets?|recit(?:ative)?|scena|scene|duetto|duettino|terzetto|finale|song|lied|chanson|rondo|polonaise|waltz|valse|march|melodrama|dance|ballet|interlude|intermezzo|reprise|medley|number)$/i;
const GROUP_RE = new RegExp(`(?:^|[\\s-])(?:${GROUP_WORDS})s?$|(?:boys|girls|people|folk|sisters|brothers|ladies)$|^\\S{3,}men$`, 'i');
// "Male Chorus", "Offstage Voices", "Other Girls", "Three Witches" (but "Other Father", "Offstage Voice" are roles)
const GROUP_PREFIX = /^(?:year \d+$|class of\b|grade \d+$|(?:featured|backup|backing)\s|(?:1st|2nd|3rd|\d+th|first|second|third)\s(?:class\s)?\S+s$|(?:male|female|men'?s|women'?s|boys'?|girls'?)\s|(?:offstage|onstage|all(?: the)?|other|some|several|various|two|three|four|five|six|seven|eight|nine|ten|twelve|\d+)\s(?:.*\s)?\S*(?:s|men|people|folk|children|mice|geese|sheep|deer|fish|police|clergy|crew|staff|brethren|oxen|lice|teeth|feet)$)/i;
const HONORIFIC = /^(?:mr|mrs|ms|miss|dr|sir|lady|lord|madame|mme|monsieur|m)\.?$/i;
const TITLE_WORD = /^(?:mr|mrs|ms|miss|dr|sir|lady|lord|madame|mme|monsieur|m|mister|aunt|uncle|captain|capt|prof|professor|father|mother|sister|brother|elder|king|queen|prince|princess|count|countess|baron|baroness|duke|duchess)\.?$/i;
const PLURAL_SUFFIX = /(?:ers|ants|ents|ies|ists|ians|ites|ettes|ards|ors|uns|ims|esses|ues|ucks|eeps|oes)$/;
const PLURAL_SUFFIX_STRONG = /(?:ies|ists|ians|ites|ettes|esses)$/;
// names that look plural but are people (surnames/first names) — never treat as groups
const NOT_PLURAL = new Set(['peters', 'rogers', 'rodgers', 'sanders', 'anders', 'myers', 'meyers', 'travers', 'summers',
  'waters', 'powers', 'rivers', 'chambers', 'withers', 'richards', 'edwards', 'howards', 'leonards', 'bernards', 'gerards',
  'connors', 'flowers', 'somers', 'bowers', 'sellers', 'walters', 'masters', 'winters', 'jeffers', 'ayers', 'byers',
  'akers', 'vickers', 'childers', 'sayers', 'spiers', 'mathers', 'clements', 'sims', 'timms', 'jennings', 'carmen', 'hymen',
  'yemen', 'jacques', 'hughes', 'holmes', 'james', 'charles', 'jones', 'davies', 'moses', 'hades', 'achilles', 'hercules',
  'ulysses', 'dolores', 'mercedes', 'lucas', 'thomas', 'nicholas', 'douglas', 'marcus', 'jesus', 'agnes', 'frances',
  'lewis', 'louis', 'doris', 'boris', 'iris', 'phyllis', 'curtis', 'dennis', 'francis', 'willis', 'otis', 'travis']);

/** A name that denotes a group of people ("Ladies of River City", "Hot Box Girls", "Company"), not a role. */
export function isGroupName(name) {
  const bare = String(name).replace(/^the\s+/i, '');
  if (/['’]s\s+(?:grand)?parents$/i.test(bare)) return false; // "Elle's Parents": a pair of roles
  if (/['’]s\s+(?:\S+\s+)?\S+$/.test(bare) && GROUP_RE.test(bare.replace(/^.*['’]s\s+/, ''))) return true; // "Mrs. Goodhue's Daughters"
  // "The Manhattan Comedy Four", "The Famous Five": a vocal group named by its size (not "Juror Number Eight")
  if (/^(?:[Tt]he\s+)?(?![\s\S]*\b[Nn]umber\b)(?:\p{Lu}[\p{L}'’.-]*\s+){2,}(?:[Tt]wo|[Tt]hree|[Ff]our|[Ff]ive|[Ss]ix|[Ss]even|[Ee]ight|[Nn]ine|[Tt]en|[Tt]welve|[Dd]ozen)$/u.test(String(name).trim())) return true;
  // "Henderson's Razorbacks", "Liza Elliott's Serenaders", "His Girlfriends": someone's band / followers
  if (/^(?:(?:\p{Lu}[\p{L}.'’-]*\s+)*\p{Lu}[\p{L}.-]*['’]s|his|her|their)\s+(?:\p{Lu}[\p{L}'’-]*\s+)?\p{Lu}\p{Ll}+(?:[^s\s]s)$/u.test(bare) && !/(?:ss|us|is|os)$/.test(bare)) return true;
  if (/^(?:mr|mrs|ms|miss|dr)\.?\s/i.test(bare)) return false;
  // the head of "X of Y" / "X to Y" decides: "Ladies of River City", "Secretaries to Mr. Goodhue" are groups,
  // "Sergeant of Police", "Prefect of Police", "Bishop of Basingstoke" are roles
  const head = bare.replace(/\s+(?:of|to|from|at|in|for|on|by)\s+.*$/i, '');
  if (NOT_PLURAL.has(head.toLowerCase())) return false;
  return ENSEMBLE_TOKEN.test(head) || GROUP_RE.test(head) || GROUP_PREFIX.test(head) || /\b(?:ensemble|chorus)\b/i.test(bare);
}

// the head noun of a group role is a plural ("The Fates", "The Twins", "Doctors") or a collective noun — never a
// surname that merely ends like one ("Linda English", "Robert Woolfolk")
const COLLECTIVE = /^(?:men|women|people|folk|children|police|clergy|crew|staff|gentry|nobility|chorus|ensemble|company|cast|choir|band|trio|quartet|quintet|sextet|octet|jury|court|council|committee|army|navy|team|class|club|society|mob|tribe|clan|coven|troupe|posse|squad|family|crowd|public|press|congregation|mice|geese|sheep|personnel|seraphim|cherubim|four|five|six|dozen)$/i;
/**
 * A role of the character list that is several people ("The Fates" in Hadestown, "Elle's Parents", "The Twins"): kept
 * as a singer (the part links to the character), but the number is then an ensemble number — never a Solo or a Duet.
 */
export function isGroupRole(name) {
  const bare = String(name).replace(/\s*\([^()]*\)\s*$/, '').trim();
  if (/['’]s\s+(?:grand)?parents$/i.test(bare)) return true;
  if (!isGroupName(bare)) return false;
  const head = bare.replace(/^the\s+/i, '').replace(/\s+(?:of|to|from|at|in|for|on|by)\s+.*$/i, '');
  const last = head.split(/\s+/).pop();
  return COLLECTIVE.test(last) || (/\p{Ll}s$/u.test(last) && !/(?:ss|us|is|os)$/i.test(last));
}

const ORDINAL_WORD = { '1st': 'First', '2nd': 'Second', '3rd': 'Third', '4th': 'Fourth', first: 'First', second: 'Second', third: 'Third', fourth: 'Fourth' };
/** "Congressmen" → "Congressman", "Witches" → "Witch", "Ladies" → "Lady", "Generals" → "General". */
export const singularOf = (w) => w.replace(/men$/, 'man').replace(/([^aeiou])ies$/, '$1y').replace(/(ch|sh|ss|x)es$/, '$1').replace(/([^s])s$/, '$1');

/**
 * Split and classify the singers part of a list item.
 * ctx: { matchCharacter(tok, exactOnly?) → canonical name|null, isActor(tok, target?) → bool, compoundNames[] }
 * → { singers[], ensemble, instrumental, instrumentalToken, actors[], groups[], dropped[], tokens[] }
 */
export function parseSingers(raw, ctx, links = []) {
  const res = { singers: [], ensemble: false, instrumental: false, instrumentalToken: false, actors: [], groups: [], dropped: [], tokens: [] };
  let s = raw;
  if (/^\s*(?:n\/?a|none|tba|tbd|—|–|-|\?)\s*$/i.test(s)) return res; // a table's "N/A"
  // "William Hardy, Jr.", "Johann Strauss, Jr. (Schani)": a generational suffix belongs to the name before it
  // (a title of honour only after a full name: "Alice, K.C., Leo and Herb" lists K.C. as a character)
  s = s.replace(/,\s*(Jr|Sr|Jnr|Snr|Bart|Bt|M\.\s?P|Q\.\s?C|K\.\s?C|Esq|M\.\s?D)\b\.?(?=\s*(?:$|[,;&()]|\band\b))/g, (m, x, off, str) => {
    const prev = str.slice(0, off).split(/,|;|&|\band\b/).pop().trim();
    return /^(?:Jr|Sr|Jnr|Snr|Bart|Bt)$/i.test(x) || prev.split(/\s+/).length >= 2 || /^(?:Jr|Sr|Jnr|Snr|Bart|Bt|M\.\s?P|Q\.\s?C|K\.\s?C|Esq|M\.\s?D)\.?$/i.test(prev) ? `\u0002${x}.` : m;
  }); // "Sir John Chaldicott, Bart., M.P."
  s = s.replace(/\b([DdOoLl])['’]\s+(?=\p{Lu})/gu, "$1'"); // "Monsieur D' Arque" → "Monsieur D'Arque"
  if (/\(instrumental\)/i.test(s) || /^instrumental\b/i.test(s)) res.instrumental = true;
  if (/^(?:the )?(?:orchestra|instrumental|band)\b[^,]*,?\s*danced by/i.test(s)) res.instrumental = true;
  const danced = /\bdanced by\b/i.test(s);
  s = s.replace(/,?\s*\(?\bdanced by\b[^,;)]*\)?/gi, ' ');
  for (const p of parens(s).reverse()) {
    const x = p.inner.trim(); let rep = ''; let cut = p.start;
    const members = x.split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean);
    const beforeText = s.slice(0, p.start);
    const before = beforeText.trim().split(/\s*(?:,|&|\band\b)\s*/).pop() || '';
    if (/^instrumental$/i.test(x)) res.instrumental = true;
    else if (/^as\s/i.test(x)) { /* "Noel (as other Students)", "Mischa (as the Carnie)": the part played in a scene */ }
    else if (/^(?:full cast|full company|company|ensemble)$/i.test(x)) res.ensemble = true;
    else if (/(?:^|\s)(?:quartet|trio|quintet|group)$/i.test(before) && members.length >= 2 && members.every((w) => /^[A-Z][\w.'-]*(?: [A-Z][\w.'-]*)?$/.test(w))) {
      rep = ', ' + members.join(', '); res.ensemble = true;
    } else if (before && !ctx.matchCharacter(before, true) && isGroupName(x.replace(/^(?:the|a|an)\s+/i, ''))) {
      // "VC (virtual community)": an abbreviation glossed with a group noun is a group
      rep = ` ${x}`; cut = beforeText.trimEnd().length - before.length;
    } else if (members.length && members.every((w) => !/\d|^the\s/i.test(w) && w.split(/\s+/).length <= 3 && (ENSEMBLE_TOKEN.test(w) || isGroupName(w.replace(/^(?:a|an|other|some)\s+/i, ''))))) {
      // "Kitty Savary, (Gentlemen)", "(Ladies and Gentlemen)": the chorus's part, written in brackets (not a band credit
      // "(The Beach Boys)" or a note "(2014 London / 2017 Broadway productions)")
      res.ensemble = true;
    }
    res.dropped.push(x);
    s = s.slice(0, cut) + rep + s.slice(p.end);
  }
  s = s.replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '');
  if (!s) { if (danced) res.instrumental = true; return res; } // "Danced by Vincent and Vanessa"
  // "1st & 2nd Congressmen", "First and Second Witches": one of each
  s = s.replace(/\b((?:1st|2nd|3rd|4th|first|second|third|fourth)(?:\s*(?:,|&|\band\b)\s*(?:1st|2nd|3rd|4th|first|second|third|fourth))+)\s+(\p{Lu}[\p{L}'’-]+)/giu,
    (m, ords, noun) => ords.split(/\s*(?:,|&|\band\b)\s*/i).map((o) => `${ORDINAL_WORD[o.toLowerCase()]} ${singularOf(noun)}`).join(', '));
  const protectedNames = (ctx.compoundNames || []).filter((n) => s.includes(n));
  protectedNames.forEach((n, i) => { s = s.split(n).join(`\u0001${i}\u0001`); });
  const toks = s.split(/\s*(?:,|;|&|\/|\+|\band\b|\bwith\b|\bplus\b)\s*/i).map((x) => x.trim()).filter(Boolean)
    .map((x) => x.replace(/\u0001(\d+)\u0001/g, (m, i) => protectedNames[+i]).replace(/\u0002/g, ' '));
  // "Joan 1, 2 and 3": bare numbers continue the numbered role before them
  for (let i = 1; i < toks.length; i++) {
    const stem = toks[i - 1].match(/^(.*\S)\s+\d{1,2}$/);
    if (stem && /^\d{1,2}$/.test(toks[i])) toks[i] = `${stem[1]} ${toks[i]}`;
  }
  // "Mr. and Mrs. Jefferson" → Mr. Jefferson, Mrs. Jefferson (unless the compound is itself a character)
  for (let i = 0; i < toks.length - 1; i++) {
    if (HONORIFIC.test(toks[i]) && toks[i + 1].split(' ').length >= 2 && !ctx.matchCharacter(toks[i], true)) {
      toks[i] = toks[i] + ' ' + toks[i + 1].split(' ').slice(1).join(' '); // (not "Lady" when Lady is a role)
    }
  }
  const hits = []; // { tok, ch, exact }
  for (let tok of toks) {
    tok = tok.replace(/^(?:and|with)\s+/i, '').replace(/:$/, '').replace(/([a-z]{2})\.$/, '$1')
      .replace(/^["'(\[]+(?=[^"]*$)|(?<=^[^"]*)["')\]]+$/g, '').trim();
    tok = tok.replace(/^"([^"]+)"$/, '$1'); // a role referred to in quotes: "Patrick"
    // quoted lines, scene descriptions and "X – Y" fragments are not names (a quoted nickname is fine: "Captain" Jack Boyle)
    const badQuote = ((tok.match(/"/g) || []).length % 2 === 1) || /"[^"]*(?:\s[^"\s]+){3,}[^"]*"/.test(tok) || /:\s*"/.test(tok);
    if (!tok || !/\p{L}/u.test(tok) || /^\[?\?\]?$/.test(tok) || badQuote || /\s[–—]\s|[–—]\s|\s[–—]/.test(tok)) { if (tok) res.dropped.push(tok); continue; }
    // "1st-, 2nd-, & 3rd-class passengers": the suspended prefixes belong to the group that follows
    if (/-$/.test(tok) && tok.split(' ').length === 1) { res.dropped.push(tok); continue; }
    // a column label, not a role: "Lead Vocals", "Backing vocals" — but someone sings ("The Band and Lead Vocals" is sung)
    if (/^(?:(?:lead|backing|backup|all|additional)\s+)?vocals?$/i.test(tok)) { res.dropped.push(tok); res.vocals = true; continue; }
    res.tokens.push(tok);
    const bare = tok.replace(/^the\s+/i, '');
    const lastWord = bare.split(' ').pop().toLowerCase();
    if (INSTR_TOKEN.test(tok)) { res.instrumentalToken = true; continue; }
    if (ENSEMBLE_TOKEN.test(bare)) { res.ensemble = true; res.ensembleWord = true; continue; }
    // "1st", "2nd", "Soloist", "Solo", "Principals": not a role
    if (/^(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|solo|soloists?|voice over|vo)$/i.test(bare)) { res.dropped.push(tok); continue; }
    if (/^(?:soli|tutti|all soloists|principals)$/i.test(bare)) { res.dropped.push(tok); res.ensemble = true; continue; } // Pinafore "(Soli and Chorus)"
    // a role listed in the Characters/Casts section wins over group-looking words ("The Fates" in Hadestown)
    const exact = ctx.matchCharacter(tok, true);
    if (exact && !ENSEMBLE_TOKEN.test(bare)) { hits.push({ tok, ch: exact, exact: true }); if (isGroupRole(exact)) { res.ensemble = true; res.groupRoles = [...(res.groupRoles || []), exact]; } continue; }
    // "The Three Kates": a numbered group whose members are all characters (Kate McGowan, Kate Murphey, Kate Mullins)
    const members = ctx.expandGroup?.(tok);
    if (members?.length) { for (const m of members) hits.push({ tok: m, ch: m, exact: true }); continue; }
    if (isGroupName(bare) || ctx.groupAbbrevs?.has(norm(bare)) || (/^[a-z]/.test(bare) && !/^(?:d['’]|de |di |da |van |von |le |la |du )\p{Lu}/u.test(bare) && !ctx.matchCharacter(bare, true)) || /\b(?:ensemble|chorus|company|cast)\b/i.test(bare) ||
        (/^the\s/.test(tok) && !ctx.matchCharacter(tok))) { // "the Fairy Band": a lowercase "the" means a group
      res.ensemble = true; res.groups.push(tok); continue;
    }
    const ch = ctx.matchCharacter(tok);
    if (ch) { hits.push({ tok, ch, exact: false }); if (isGroupRole(ch)) { res.ensemble = true; res.groupRoles = [...(res.groupRoles || []), ch]; } continue; }
    // number types / scene labels standing where singers should be: "Ballade", "Couplet Final", "Scene 1"
    if (NUMBER_TYPE.test(bare) || NUMBER_TYPE.test(bare.split(' ')[0].replace(/s$/i, '')) || /^(?:scene|act|part|no\.?|number|track)\s*(?:\d+|[ivx]+|one|two|three|four)$/i.test(bare) ||
        /^(?:entrance|entry|exit|enter|re-?enter)\s+of\b/i.test(bare)) { res.dropped.push(tok); continue; } // "Entrance of Napoleon I"
    // unmatched plural-looking tokens are groups: "The Rays", "Hustlers", "Bowery Beauties"
    const words = bare.split(' ');
    const honorific = words.length > 1 && TITLE_WORD.test(words[0]);
    const pluralish = !honorific && !NOT_PLURAL.has(lastWord) && !/[A-Z]\.$/.test(bare) &&
      ((/^the\s+(?:\S+\s+){0,2}\S+(?:s|some)$/i.test(tok) && !/\b(?:who|that|which|with)\b/i.test(tok)) || (words.length === 1 && PLURAL_SUFFIX.test(lastWord)) ||
       (words.length > 1 && PLURAL_SUFFIX_STRONG.test(lastWord)));
    if (pluralish) { res.ensemble = true; res.groups.push(tok); continue; }
    const link = links.find((l) => norm(l.label) === norm(tok));
    const role = ctx.roleOfActor?.(tok);
    if (role) { hits.push({ tok, ch: role, exact: true }); continue; }
    if (ctx.isActor(tok, link?.target)) { res.actors.push(tok); continue; }
    if (words.length > 6) { res.dropped.push(tok); continue; }
    hits.push({ tok, ch: tok, exact: false }); // a minor role missing from the character list: keep it as written
  }
  // two different names in one item never become the same person ("Audrey and Audrey II")
  for (const h of hits) {
    if (!h.exact && hits.some((o) => o !== h && o.ch === h.ch && o.tok !== h.tok && o.exact)) h.ch = h.tok;
  }
  res.singers = [...new Set(hits.map((h) => h.ch))];
  return res;
}

// ---------------------------------------------------------------------------------------------
// Final per-show dedupe
// ---------------------------------------------------------------------------------------------

/** Dedupe key used for "the same song": folded title (+ reprise flag). */
// a title in another script keeps its letters ("戦車 (INST)" and "合戦 (INST)" are different songs)
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u;
export const titleKey = (title) => (NON_LATIN_LETTER.test(title) ? fold(title) : norm(title) || fold(title));
export const songKey = (title, reprise) => `${titleKey(title)}|${reprise ? 1 : 0}`;

// titles that name a kind of number, not a song: two of them in one list are different numbers
export const GENERIC_TITLE = /^(?:(?:act (?:\d|i{1,3}|iv|one|two|three) )?(?:grand )?(?:finale(?: (?:act )?(?:\d|i{1,3}|iv|one|two|three))?|finale ultimo|opening(?: chorus)?|chorus|dance|dances|ballet|song|duet|duettino|trio|terzetto|quartett?|quintet|sextet|septet|octet|ensemble|recit(?:ative)?|aria|ballad|romance|march|waltz|melodrama|interlude|intermezzo|entr['’]?acte|overture|prelude|introduction|underscore|underscoring|scene change|transition|playoff|play-off|playout|bows|curtain call|exit music|utility|incidental music|stage music|specialty|dance break|tag|encore|medley|montage|sequence)(?:\s+(?:\d+|[ivx]+))?)$/i;

/**
 * Number the items and make titles unique within the show (the site keys songs by title + reprise).
 * Nothing is merged: every numbered item of the source list stays one entry.
 * - "(Finale)/(Tag)/(Encore)/(Bows)…" suffix variants of an existing song become reprises.
 * - a reprise keeps the source's number ("(reprise 6)" → "Title (Reprise 6)"; the first reprise is the bare
 *   title); a repeated reprise title gets the next free "(Reprise N)" — a reprise by another character is
 *   never folded into the first, so it can't turn a solo into a false duet.
 * - a song listed again (an encore, a finale reprise) is a reprise of the first listing;
 * - generic numbers ("Dance", "Quartet", "Finale") listed twice are distinct: "Dance (Act 2)" / "Dance (3)".
 */
export function finalizeSongs(items) {
  const taken = new Set(); const out = [];
  const bases = new Set(items.filter((i) => !i.reprise).map((i) => titleKey(i.title)));
  const free = (title, reprise) => !taken.has(songKey(title, reprise)) && !taken.has(`${title.toLowerCase()}|${reprise}`);
  const take = (it) => { taken.add(songKey(it.title, it.reprise)); taken.add(`${it.title.toLowerCase()}|${it.reprise}`); out.push(it); };
  const firstAct = new Map(); const seen = new Map();
  for (const it of items) {
    const m = it.title.match(/^(.*?)\s*\((?:finale|tag|playoff|play-off|encore|bows|coda|reprise.*)\)$/i);
    if (!it.reprise && m && bases.has(titleKey(m[1]))) it.reprise = true;
    // a reprise of a song (or a whole medley) listed earlier: "Make Up Your Mind / Catch Me I'm Falling (Reprise)",
    // "Welcome to Eden Reprise" → the song's title, flagged as a reprise
    const bare = it.title.match(/^(.*\S)\s*\(((?:(?:first|second|third)\s+)?reprise(?:\s*(?:#|no\.?)?\s*(?:\d+|[ivx]+))?)\)$/i) ||
      it.title.match(/^(.*\S)\s+((?:(?:first|second|third)\s+)?reprise(?:\s*(?:#|no\.?)?\s*(?:\d+|[ivx]+))?)$/i);
    if (bare && bases.has(titleKey(bare[1])) && !/[–—-]$/.test(bare[1])) { it.title = bare[1]; it.reprise = true; it.repriseNo ??= repriseNumber(bare[2]); }
    if (!it.reprise && !free(it.title, false)) {
      if (GENERIC_TITLE.test(it.title)) {
        const base = it.title; const k = titleKey(base);
        const prevAct = firstAct.get(k); const nth = (seen.get(k) ?? 1) + 1; seen.set(k, nth);
        let t = typeof it.act === 'number' && it.act !== prevAct ? `${base} (Act ${it.act})` : null;
        for (let n = nth; !t || !free(t, false); n++) t = `${base} (${n})`;
        it.title = t; take(it); continue;
      }
      it.reprise = true; // listed again: an encore / a later reprise of the same song
    }
    if (!it.reprise) { firstAct.set(titleKey(it.title), it.act); take(it); continue; }
    const base = it.title;
    let t = it.repriseNo > 1 ? `${base} (Reprise ${it.repriseNo})` : base;
    for (let n = 2; !free(t, true); n++) t = `${base} (Reprise ${n})`;
    it.title = t; take(it);
  }
  out.forEach((it, i) => { it.position = i + 1; });
  return out;
}
