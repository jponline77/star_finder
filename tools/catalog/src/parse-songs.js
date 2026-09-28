// Song list of a stage musical from its English Wikipedia article (wikitext): finds the
// "Musical numbers"/"Songs"/"Song list" section, splits it into production lists and acts,
// parses bullet lists, wikitables and {{Track listing}}s, picks the best production list and
// returns clean song records. Pure functions; see README "How the parser works".
import {
  stripComments, stripRefs, expandTemplates, mapTemplates, templateFields, sections, sectionBody,
  parentSection, firstInfobox, stageInfobox, parseTable, tableEnd, headingOf, stripFormatting,
} from './wikitext.js';
import {
  cleanInline, stripMarkers, findSeparator, parseTitle, parseSingers, finalizeSongs, norm, fold, plain, isGroupName, parens,
  INSTR_TITLE, STRONG_INSTR_TITLE, DANCE_TITLE, GENERIC_TITLE, FOREIGN_WORD, ENGLISH_WORD,
} from './normalize.js';
import { parseCharacters, createCharacterMatcher } from './parse-characters.js';

// ---------- vocabularies ----------
export const SONG_HEAD = /^(?:list of )?(?:principal songs|songs and musical numbers|musical numbers|musical numbers and .+|song ?list(?:ing)?|songlist|songs|song list and .+|list of songs|numbers|musical program(?:me)?|music and lyrics|score and songs|list of musical numbers|musical numbers list|songs list|songs and (?:sketches|numbers|scenes|music)|musical numbers ?\/ ?track ?list(?:ing)?|musical highlights|songs from the .+ (?:version|production)|songs in the (?:original )?(?:.+ )?(?:production|version|staging)|numbers and songs|scenes and (?:musical numbers|songs|music|numbers)|scene and song list|songs included|songs include|song numbers|music numbers|musical numbers\/songs.*|(?:notable|featured|selected|principal) (?:musical numbers|songs)|program and songs|revue sketches and songs.*|the sketches and songs|sketches and songs|.* production musical numbers|(?:synopsis|structure|plot) (?:and|&) (?:musical numbers|songs|numbers)|(?:music|musical) numbers (?:in|of|from|for) .+|.+ (?:production )?song ?list(?:ing)?|.+ production (?:songs|musical numbers)|(?:the musical\s*[—–-]\s*)?scenes,? songs(?: and \w+)?)$/i;
// "Songs and recordings" (Fun Home, Amélie): a song list even though the heading mentions recordings
const SONG_HEAD_WITH_RECORDINGS = /^(?:songs|musical numbers|song list|music) and (?:(?:cast )?(?:recordings?|albums?)|instrumentation|orchestration|orchestra)$/i;
const LANGUAGE = /^(?:english|french|german|dutch|portuguese|spanish|italian|swedish|danish|norwegian|finnish|polish|czech|hungarian|russian|japanese|korean|chinese|hebrew|greek|turkish|catalan)\s+/i;
// (anywhere in the heading: "Musical numbers in German version", "French numbers"; not "… (English adaptation)")
const OTHER_LANGUAGE = /^(?!.*\benglish\b)(?:(?:french|german|dutch|portuguese|spanish|italian|swedish|danish|norwegian|finnish|polish|czech|hungarian|russian|japanese|korean|chinese|hebrew|greek|turkish|catalan)\b|.*\b(?:in|of the) (?:french|german|dutch|portuguese|spanish|italian|swedish|danish|norwegian|finnish|polish|czech|hungarian|russian|japanese|korean|chinese|hebrew|greek|turkish|catalan) (?:version|original|language|production)\b|.*\b(?:french|german|dutch|portuguese|spanish|italian|swedish|danish|norwegian|finnish|polish|czech|hungarian|russian|japanese|korean|chinese|hebrew|greek|turkish|catalan)[ -](?:version|language|lyrics|titles)\b)/i;
/** Heading → 'strong' | 'weak' | null. Qualifiers like "(Broadway)", "(2007)", "1927 …", "Original …", "English …" are ignored. */
export function songHeading(title) {
  if (SONG_HEAD_WITH_RECORDINGS.test(title.trim())) return 'strong';
  if (EXCLUDE_HEAD.test(title)) return null;
  const t = title.replace(/\s*\([^()]*\)\s*$/, '').replace(/\b(?:1[89]|20)\d\d\b/g, ' ')
    .replace(/^\s*(?:original|revised|current|final|confirmed|broadway|west end|off-broadway|london|new york)\s+/i, '').replace(LANGUAGE, '')
    .replace(/\s+/g, ' ').trim();
  if (SONG_HEAD.test(t)) return 'strong';
  if (SONG_HEAD_WEAK.test(t)) return 'weak';
  return null;
}
export const SONG_HEAD_WEAK = /^(?:music|score|the music|music and songs|songs and music|the score|musical score)$/i;
export const EXCLUDE_HEAD = /(?:\bcut\b|deleted|unused|dropped|additional|other songs|\bnotes?\b|recording|album|\bfilm\b|movie|soundtrack|analysis|revision|alteration|title song|\bcharts?\b|orchestration|instrumentation|reception|critical|style|influence|background|development|writing|composition|discography|\bhistory\b)/i;
const STOP_LABEL = /^(?:notes?|keys?|legend|notes on (?:the )?(?:songs|music)|song notes|footnotes|sources?|cut songs?|deleted songs?|songs? cut|cut numbers|other songs|additional songs|screen|film(?: version)?|movie(?: version)?|unused songs|orchestration|instrumentation|band|recordings?|cast recordings?|original cast album|album|charts?|discography|singles|history|changes|differences|variations)\b/i;
const PROD_LABEL = /(?:production|broadway|west end|london|off-broadway|revival|original|revised|revision|current|version|tour|concert|workshop|\b(?:1[89]|20)\d\d\b|film|movie|licen[cs]|premiere|staging|script)/i;
const PROD_WORD = /(?:production|broadway|west end|london|off-broadway|revival|original|revised|revision|current|version|tour|concert|workshop|film|movie|licen[cs]|premiere|staging|script)/i;
const REJECT_INFOBOX = /^(?:musical artist|person|officeholder|writer|artist|song|single|album|television|film|tv|video game|company|organi[sz]ation|band|award|venue|theatre|building|settlement|website|book|comic|radio|podcast|character|fictional character|attraction|amusement park|concert tour|parade)\b/;
// for items Wikidata already types as stage works, an album/song/book infobox usually means the article
// also covers the cast album or the source book — only clearly different subjects are rejected
// (a theme-park show's {{Infobox attraction}} — "Beauty and the Beast Live on Stage", "Frozen – Live at the Hyperion" — too)
const REJECT_INFOBOX_LENIENT = /^(?:musical artist|person|officeholder|writer|artist|television|film|tv|video game|company|organi[sz]ation|band|award|venue|theatre|building|settlement|website|radio|podcast|character|fictional character|attraction|amusement park|concert tour|parade)\b/;
const SUBPAGE_TEMPLATE = /^(?:main|main article|further|further information|see also|details)$/;

const ACT_WORDS = { one: 1, two: 2, three: 3, four: 4, i: 1, ii: 2, iii: 3, iv: 4, first: 1, second: 2, third: 3 };
/** "Act II" → 2, "Prologue" → 'prologue', "Epilogue" → 'epilogue', else null. */
export function actOf(label) {
  // ("Act l", "Act ll", "Act lll": Roman numerals typed with a lowercase L — Orange Blossoms)
  label = label.replace(/^((?:act|part)\s+)(l{1,3})(?=\s*$|\s*[:.,–—-])/i, (m, a, l) => a + 'i'.repeat(l.length));
  const m = label.match(/^(?:act|part)\s+(\d+|one|two|three|four|iv|iii|ii|i)\b/i) || label.match(/^(first|second|third) act\b/i);
  if (m) { const k = m[1].toLowerCase(); return /^\d+$/.test(k) ? +k : ACT_WORDS[k]; }
  if (/^prologue\b/i.test(label)) return 'prologue';
  if (/^epilogue\b/i.test(label)) return 'epilogue';
  return null;
}

function classifyLabel(label) {
  const x = label.replace(/[:.]+$/, '').trim();
  if (!x) return { kind: 'none' };
  const act = actOf(x);
  if (act) return { kind: 'act', act };
  if (/^(?:side|disc|cd|record)\s*(?:\d+|one|two|[ab])$/i.test(x)) return { kind: 'none' };
  if (/^sources?\s*:/i.test(x)) return { kind: 'none' }; // ";Source: playbillvault" cites the list below
  if (STOP_LABEL.test(x)) return { kind: 'stop' };
  if (/^(?:scene|sc\.)\s*\w+\b|^(?:encore|bows|curtain call)\b|^(?:time|place|setting|location|the time|the place)\s*:/i.test(x)) return { kind: 'other', label: x };
  if (PROD_LABEL.test(x) && x.split(' ').length <= 10) return { kind: 'prod', label: x };
  return { kind: 'other', label: x };
}

// ---------- list items ----------
// kinds of number in operetta / Edwardian musical-comedy lists ("Song with Trio", "Recit. and Quartett",
// "Act I Finale", "Opening Chorus") — a label, not the number's title
const FORM_ONE = String.raw`(?:(?:opening|closing|grand|concerted|comic|patter|drinking|topical|laughing|entrance|exit|promenade|men's|ladies'|male|female|double|act (?:\d|i{1,3}|iv|one|two|three)|(?:\d|i{1,3})(?:st|nd|rd|th)? act)\s+)*(?:chorus|choruses|song|songs|air|aria|arietta|ballad|ballade|duet|duetto|duettino|duo|introduction|cotillion|promenade|trio|terzetto|quartett?e?|quintett?e?|sextett?e?|septett?e?|octett?e?|ensemble|finale|finaletto|recit(?:ative)?\.?|romance|romanza|romanze|couplets?|cavatina|cabaletta|scena|lied|madrigal|serenade|serenata|lullaby|hymn|barcarolle|bolero|habanera|march|waltz|valse|polka|mazurka|gavotte|minuet|galop|tango|dance|ballet|melodrama|canon|glee|number|concerted piece|entrance|exit|meditation|chorale|solo|seguidilla|tarantella|polonaise|rondo|rondeau|chanson|narration|legend|ballata|stretta|scene|opening|schottische|bourr[ée]e|sarabande|jig|reel|fandango|cachucha|czardas|csardas|cancan|can-can|refrain|ditty|solos|duets|quartets|recitatives|complainte?|presentation|fabliau|rondeau|villanelle|chansonnette|air de ballet|prelude|preludio|coro|seguidillas?(?: \p{L}+)?|jota|intermedio|romanza|terceto|cuarteto|dúo|duo)(?:\s+(?:\d+|[ivx]+|act (?:\d|i{1,3}|iv|one|two|three)))?(?:\s+of\s+(?:the\s+)?[\p{L}'’-]+(?:\s+[\p{L}'’-]+)?)?`;
// ("Recitative Solo and Chorus", "Introduction, Duet and Refrain": kinds joined by "and", commas or just a space)
const FORM_LABEL = new RegExp(`^${FORM_ONE}(?:(?:\\s*(?:,|and|&|with|\\+)\\s*|\\s+)${FORM_ONE})*$`, 'iu');
const FORM_PREFIX = new RegExp(`^(${FORM_ONE}(?:(?:\\s*(?:,|and|&|with|\\+)\\s*|\\s+)${FORM_ONE})*)\\s*:\\s*(\\S.*)$`, 'iu');
/** "Song with Trio" / "Chorus with Dorothy, Lydia and Bantam" / "Duet (Rosette, Vincent)" → { form, names } or null */
export function formLabel(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  const paren = t.match(/^(.*?)\s*\(([^()]+)\)$/);
  const head = paren ? paren[1] : t;
  if (FORM_LABEL.test(head)) return { form: head, names: paren ? paren[2] : '' };
  const w = head.match(/^(.+?)\s+(?:with|by|for)\s+(\p{Lu}.*)$/u);
  if (w && FORM_LABEL.test(w[1]) && !paren) return { form: w[1], names: w[2] };
  return null;
}
// "(Act I) Finale:", "Act II Finale:", "Finale Act 1:" before a number's own (quoted) title
const POSITIONAL = /^(?:act\s+(?:\d|[ivx]+|one|two|three)\s+)?(?:finale|finaletto|opening|introduction|prologue|epilogue|entr['’]?acte)(?:\s+(?:(?:to|of)\s+)?(?:act\s+)?(?:\d|[ivx]+|one|two|three))?$/i;
// a production note in <small> after the singers: "<small>- Added for the Hamburg 2001 production …</small>"
const PROD_NOTE_WORDS = /\b(?:added|replaced|cut|originally|retained|omitted|shortened|revised|renamed|retitled|running order|production|revival|premiere|version|relocated|collapsed|derives|inserted)\b/i;
const prodNote = (c) => {
  const t = c.replace(/<[^>]+>/g, '').trim(); const w = t.split(/\s+/).length;
  const lower = t.split(/\s+/).filter((x) => /^\p{Ll}/u.test(x) && !/^(?:and|with|the|of|&|de|la|von|van)$/.test(x)).length;
  return (/^[-–—]\s/.test(t) && (PROD_NOTE_WORDS.test(t) || lower >= 2)) || (w >= 5 && PROD_NOTE_WORDS.test(t)) || (w >= 8 && sentenceBreak(t)); // (not "<small>— Gloria, Company</small>")
};
// '"Who would be a "Boy," nothing to enjoy…"': quotes inside a quoted line become single quotes
function nestedQuotes(s) {
  // (the inner quote opens after a space and closes before punctuation or the end: not '"A" (x), valse: " B "')
  return s.replace(/"([^"]*)"([^"]*)"([^"]*)"/g, (m, a, b, c) => (/\s$/.test(a) && /^(?:$|[\s,.;:!?…])/.test(c) && /\p{L}/u.test(b) && !/[:()]/.test(b) &&
    b.trim().split(/\s+/).length <= 5 && !/^\s*(?:\/|&|and|,|\+|–|-|—|into|…|\.{3})?\s*$/i.test(b) && !/\s[–—-]\s/.test(b) ? `"${a}'${b}'${c}"` : m));
}
/** A quoted first line used as a number's title (public-domain works only): ellipses dropped, cut at a phrase break. */
export function firstLineTitle(q) {
  let t = q.replace(/^["'\s]+|["'\s]+$/g, '').replace(/^(?:\.{3}|…)\s*|\s*(?:\.{3}|…)$/g, '').replace(/[,;:]+$/, '').trim();
  const words = t.split(/\s+/);
  if (words.length > 16) { // at the first phrase break, else at most ~20 words
    const cut = t.match(/^((?:\S+\s+){2,15}?\S+?)[,;:!?.](?:\s|$)/);
    t = cut ? cut[1] : words.length > 20 ? words.slice(0, 16).join(' ') : t;
  }
  return t.replace(/[,;:]+$/, '').trim();
}

/**
 * Parse one list line (without its bullet) into a song item, or null if it isn't one.
 * ctx: { writerSurnames, matchCharacter, isActor, compoundNames, publicDomain, parenCredits }
 */
export function parseItem(text, ctx, warn = () => {}, depth = 0) {
  const links = [];
  const rawText = depth ? '' : stripRefs(text);
  // a translation gloss in <small> after a title: "Inútil <small>(Useless)</small>" (reprise/act markers stay)
  const pre = depth ? text : rawText.replace(/<small>\s*(\((?:[^()<>]|\([^()<>]*\))*\))\s*<\/small>/gi, (m, p) => (/reprise|instrumental|\bpart\b|\bact\b|finale|version/i.test(p) ? p : ''))
    .replace(/<small>((?:(?!<\/small>)[\s\S])*)<\/small>/gi, (m, c) => (prodNote(c) ? '' : m));
  // an italic parenthetical after a (foreign) title is its translation: '"Qui je suis?" (''Who am I?'') – L'Opinion publique'
  const pre1 = depth ? pre : pre.replace(/\s*\(\s*''(?!')((?:(?!'').){3,}?)''\s*\)/g, (m, x) => (/\b(?:reprise|instrumental|part|version|act|finale|medley|cut|added|encore)\b/i.test(x) || x.trim().split(/\s+/).length < 2 ? m : ''));
  // a songbook revue names each song's source show: '"I'm Glad I'm Single" from ''The Gay Life'' (Richard)', '"Johnny One
  // Note", "My Funny Valentine" and "The Lady Is a Tramp" from ''Babes in Arms'' (1937)' — a note, not part of the title
  // (only right after the item's own quoted title(s), never inside a note: '… parody of "X" from ''Carousel''')
  const FROM_WORK = /(["”])\s+from\s+(?:the\s+(?:musical|film|revue|show)\s+)?''(?!')(?:(?!'').)+''(?:\s*\((?:1[89]|20)\d\d\))?/g;
  let sourceNote = false;
  const pre2 = depth ? pre : pre1.replace(FROM_WORK, (m, q, off) => {
    if (!/^\s*(?:(?:Medley|Dance Medley)\s*:\s*)?(?:["“](?:[^"”]|\[\[[^\]]*\]\])+["”]\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s*&\s*|\s*\/\s*)?)+$/.test(pre1.slice(0, off + 1))) return m;
    sourceNote = true; return q;
  });
  let s = depth ? text : cleanInline(expandTemplates(pre2, warn), links);
  s = nestedQuotes(stripMarkers(s));
  s = s.replace(/\s*\(\s*\)/g, ''); // '"One, Two, Three" ({{audio|…}})': the brackets of a dropped template
  // '"Finale: "Nutbush City Limits (Reprise)" / Proud Mary (Reprise)" – Company' (Tina): a label inside the opening quote,
  // and a medley whose last part lost its opening quote
  s = s.replace(/^"((?:act\s+\S+\s+)?(?:finale|opening|prologue|epilogue|entr['’]?acte|medley)(?:\s+(?:act\s+)?\S+)?)\s*:\s*"/i, '$1: "');
  if ((s.match(/"/g) || []).length % 2 === 1) s = s.replace(/("[^"]+"(?:\s*\([^()]*\))*\s*\/\s*)([^"\s/(][^"/]*?)"(?=\s*(?:[–—-]\s|$))/, '$1"$2"');
  // '"After the Murder ("The Game" Reprise; "Act I Finale") – Suspects' (the closing quote is missing): the inner quotes
  // become single quotes
  if ((s.match(/"/g) || []).length % 2 === 1 && /\)"(?=\s*(?:[–—-]\s|$))/.test(s)) s = s.replace(/\)"(?=\s*(?:[–—-]\s|$))/, ')'); // '"A" / "B" (Reprise)" – …'
  else if ((s.match(/"/g) || []).length % 2 === 1 && /[\p{L}.)]"$/u.test(s) && /^"[^"]+"\s*[–—-]\s/.test(s)) s = s.slice(0, -1); // '"Title" - Bella, Moriarty"'
  else if (/^"/.test(s) && (s.match(/"/g) || []).length % 2 === 1 && (s.match(/"/g) || []).length >= 3) s = s.slice(1).replace(/"([^"]*)"/g, "'$1'");
  s = s.replace(/^(?:No\.\s*)?\d{1,2}[a-z]?[.)]\s*(?=["'\p{Lu}(])/u, ''); // "1. "Title" (Singers)", "No. 3. …", "1.Overture"
  if (ctx.bareNumbers) s = s.replace(/^\d{1,2}[a-z]?\s+(?=\p{Lu})/u, ''); // list-level "1 Opening Chorus"
  const bareNo = s.match(/^\d{1,2}[a-z]?\s+(?=\p{Lu})/u); // "5  Quintet – …", "3 Song: Omar and Chorus – …"
  if (bareNo) { const rest = s.slice(bareNo[0].length); if (formLabel(rest.split(/\s*[:–—]\s*|\s-\s/)[0])) s = rest; }
  s = s.replace(/^(?:No\.\s*)?\d{1,2}[a-z]?[.)]\s*(?=\()/, '');
  // Ruddigore: '22. (original) "Away, remorse!" … (Robin)', '22. (replaced) …': which version of the number, not its title
  s = s.replace(/^\((?:original|replaced|replacement|revised|new|later|alternative|alternate|added|revival|(?:original|revised|later|revival) version)\)\s*(?=["\p{Lu}])/iu, '');
  if (/^\((?:dance|ballet|instrumental|entr'?acte)\)$/i.test(s)) s = s.slice(1, -1); // "4a. (Dance)"
  if (/^(?:cut|deleted|dropped|unused)\s+(?:song|number)s?\s*:/i.test(s)) { warn('dropped:cut-number'); return null; } // Pinafore "5a. Cut song: …"
  // a number marked as cut / lost / never performed is not part of the show: "Susan's Dream [Cut Song]", "(cut before opening)"
  if (/[[(]\s*(?:cut|deleted|dropped|unused|lost)(?:\s+(?:song|number|before (?:the )?(?:opening|broadway)|during (?:previews|tryouts?|the tryout)|in (?:previews|tryouts?)|out of town))?\s*[\])]/i.test(s)) { warn('dropped:cut-number'); return null; }
  s = s.replace(/\s*\[(?!\?\])[^\][]{2,80}\]/g, ''); // editorial notes: [The "paradox" trio]
  if (!s || /^(?:side|disc|cd|record|lp)\s*(?:\d+|one|two|three|[ab])\s*:?$/i.test(s)) return null;
  if (/^(?:lyrics?|music|composition|arrangement|words|orchestrations?|co-arrangement)(?:\s*[/・]\s*\p{L}+)?\s*:/iu.test(s)) return null; // a credit line
  // "A new introductory verse to "Every Day a Little Death"", "Additional lyrics for …": a change to a number, not a number
  if (/^(?:an?\s+)?(?:new|additional|revised|extra|alternate|alternative)\s+(?:introductory\s+)?(?:verses?|lyrics?|sections?|introductions?|endings?|codas?|bridges?|choruses)\b/i.test(s)) return null;
  // legend / note bullets ("Not included in the original production …")
  const noParens = s.replace(/\([^()]*\)/g, ' ').trim();
  // (a Title-Case line is a title: "The Men Who We've Become / Mért nem ért meg engem", "The Hunt / Wrestle with the Devil")
  const firstPart = noParens.split(/\s+\/\s+/)[0].split(/\s+/);
  const proseWords = firstPart.filter((w) => /^\p{Ll}/u.test(w) && !/^(?:a|an|the|of|in|on|at|to|for|and|or|with|by|from|as|is|it|my|me|you|your|we|our|his|her|its)$/.test(w)).length;
  if (/^(?:not |only |this |these |the |songs? |note|sources?:|in the |during |added |cut |originally )/i.test(s) && !/^"/.test(s) && !/:\s*"[^"]+"\s*$/.test(s) && !findSeparator(s) &&
      ((noParens.split(/\s+/).length > 6 && proseWords >= 2) || /\b(?:recording|production|album|revival|version|cast|playbill|included|featured)\b/i.test(noParens))) return null;
  s = s.replace(/\s*[—–-]?\s*\(?\b\d{1,2}:\d{2}\)?\s*$/, '').replace(/\s*[([]\d{1,2}:\d{2}[)\]]/g, '').trim(); // durations "(3:41)" / "[3:04]" / "— 2:56"
  s = s.replace(/^"0\d[.)]?\s+/, '"').replace(/^0\d[.)]?\s+(?=\p{L})/u, ''); // zero-padded track numbers "01 …"
  if (/^'[^']{2,}'(?:\s|$)/.test(s) && !/^'[^']*'[a-z]/.test(s)) s = s.replace(/^'([^']+)'/, '"$1"'); // 'Title' → "Title"
  // "Title" by [[Writer]] & [[Writer]] – singers (jukebox / compilation shows): the writer credit goes
  s = s.replace(/^("[^"]+"(?:\s*\([^()]*\))*)\s+by\s+[^–—"]+?(?=\s[–—-]\s)/, '$1');
  // '"Papa Was A Rollin' Stone", Pt. 2' (Ain't Too Proud): the part belongs to the title — not a reprise of Pt. 1
  s = s.replace(/^"([^"]+)",?\s+(Pt\.?|Part)\s*(\d+|[IVX]+)\b/i, (m, t, p, n) => `"${t} (${/^pt/i.test(p) ? 'Pt.' : 'Part'} ${n})"`);
  // a songbook revue's '"Johnny One Note", "My Funny Valentine" and "The Lady Is a Tramp" from ''Babes in Arms'' (1937)':
  // the source show is a note; several titles on one line are several numbers (Beguiled Again)
  let splitTitles = null;
  if (!depth) {
    const several = sourceNote && s.match(/^((?:"[^"]+"\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s*&\s*))+"[^"]+")\s*(\([^()]*\))?\s*$/);
    if (several) { // (not a labelled "Medley: …")
      splitTitles = [...several[1].matchAll(/"([^"]+)"/g)].map((m) => `"${m[1].trim()}"${several[2] ? ` ${several[2]}` : ''}`);
      s = splitTitles[0];
    }
    // '"Oh! My Bow" with Dance of the Rainbows – Polychrome with Rainbow Girls': a staging note after the quoted title
    s = s.replace(/^("[^"]+")\s+with\s+(?:a\s+|the\s+)?(?:dance|ballet|chorus|dancers)\b[^–—"]*?(?=\s[–—-]\s|$)/i, '$1');
  }
  // '"Pretty daughter of mine" (Captain and Ensemble) and "He is an Englishman" (Boatswain and Ensemble)' (Gilbert &
  // Sullivan): each part of a combined number names its own singers — one number, sung by all of them
  if (!depth && !findSeparator(s)) {
    const segs = [...s.matchAll(/"([^"]+)"\s*((?:\([^()]*\)\s*)*)/g)];
    const joined = segs.length >= 2 && s.replace(/"[^"]+"\s*(?:\([^()]*\)\s*)*/g, '\u0001').split('\u0001').slice(1, -1).every((j) => /^\s*(?:and|&|\/|,|\+)?\s*$/i.test(j)) &&
      /^\s*"/.test(s) && !s.replace(/"[^"]+"\s*(?:\([^()]*\)\s*)*/g, '').replace(/\s*(?:and|&|\/|,|\+)\s*/gi, '').trim();
    if (joined) {
      const parts = segs.map((m) => {
        const ps = parens(m[2] || '');
        const last = ps.at(-1)?.inner.trim() ?? '';
        const singer = last && !/^(?:reprise|part|finale|prelude|instrumental|tag|encore|playoff|medley|opening|act|from|version|remix|\d)/i.test(last) &&
          last.split(/\s*(?:,|&|\band\b|\bwith\b)\s*/).filter(Boolean).every((x) => SINGER_PART.test(x.trim()));
        return { title: m[1], rest: (singer ? ps.slice(0, -1) : ps).map((p) => `(${p.inner})`).join(' '), singers: singer ? last : '' };
      });
      const named = parts.filter((p) => p.singers);
      // (each part names a character or the chorus: not '"I Want It That Way" (Backstreet Boys) / "Bye Bye Bye" (NSYNC)')
      const real = (x) => { const sg = parseSingers(x, ctx, []); return sg.singers.some((y) => ctx.matchCharacter(y)) || sg.ensembleWord; };
      if (named.length >= 2 && named.every((p) => real(p.singers))) {
        s = `${parts.map((p) => `"${p.title}"${p.rest ? ` ${p.rest}` : ''}`).join(' / ')} – ${named.map((p) => p.singers).join(', ')}`;
      }
    }
  }
  let sep = findSeparator(s, { tightDash: ctx.tightDash, dotDash: ctx.dotDash });
  if (!sep && (s.match(/—/g) || []).length === 1) { // "Overture—Orchestra", "I Ain't Down Yet—Molly Tobin and Her Brothers"
    const g = s.match(/[\p{L}.!?'")]—(?=\p{Lu})/u);
    if (g) sep = { start: g.index + 1, end: g.index + 2 };
  }
  let titlePart = sep ? s.slice(0, sep.start).trim() : s;
  let singersRaw = sep ? s.slice(sep.end).trim() : '';
  let actHint = null; let formHint = null; let forceInstr = false;
  // "Instrumental Introduction: Prelude" (a table of numbers): an instrumental number
  const ip = titlePart.match(/^instrumental(?:\s+(?:introduction|interlude|music|number|piece))?\s*:\s*(\S.*)$/i);
  if (ip) { titlePart = ip[1]; forceInstr = true; }
  // "Finale – "In Every Age" / "Godspeed, Titanic" (Reprise) – Company": a label, the quoted number, then the singers
  if (sep && (POSITIONAL.test(titlePart) || formLabel(titlePart)) && /^"/.test(singersRaw)) {
    const sep2 = findSeparator(singersRaw);
    const after = sep2 ? singersRaw.slice(sep2.end).trim() : '';
    if (sep2 && /^"[^"]+"/.test(singersRaw.slice(0, sep2.start).trim()) && !/^"/.test(after) && !formLabel(titlePart)?.names && singerLike(after, ctx)) {
      formHint = titlePart; titlePart = singersRaw.slice(0, sep2.start).trim(); singersRaw = singersRaw.slice(sep2.end).trim();
    }
  }
  const afterDash = singersRaw; // (as written, for the dance notes below)
  // 'No. 9. (Singer unknown) – "The world has maidens sweet and pretty…"' (The School Girl): the singers in brackets, then
  // the number's (quoted) first line
  const pf = sep && titlePart.match(/^\(([^()]+)\)$/);
  if (pf && /^"[^"]+"/.test(singersRaw)) {
    titlePart = singersRaw.match(/^"[^"]+"(?:\s*\([^()]*\))*/)[0];
    singersRaw = /\bunknown\b|\?/i.test(pf[1]) ? '' : pf[1];
  }
  // bilingual operetta lists (La belle Hélène): 'Air de Pâris "Au mont Ida" – Air: "Mount Ida" – Paris', '"Amours divins" –
  // "Divine loves" – Chorus and Helen': the original title, its translation(s), then the singers (the last part)
  if (sep && !formHint && !depth && !/^(?:Nos?\.?\s*)?\d{1,3}[a-z]?\.?$/i.test(titlePart)) {
    const segs = []; let rest = singersRaw;
    for (let sp2 = findSeparator(rest); sp2 && segs.length < 4; sp2 = findSeparator(rest)) { segs.push(rest.slice(0, sp2.start).trim()); rest = rest.slice(sp2.end).trim(); }
    const last = rest.replace(/\s*;\s*/g, ', ');
    if (segs.length && (/"/.test(titlePart) || segs.some((m) => /"/.test(m))) && !/^"/.test(last) && !/<br\s*\/?>/i.test(rawText) &&
        segs.every((m) => /"/.test(m) || (m.split(/\s+/).length <= 6 && !singerLike(m, ctx))) && namedSingers(last, ctx)) {
      // the original title: its first quoted part ('Chœur "Gloire au berger victorieux"; "Gloire! gloire! …"', '"Un mari sage"
      // (Hélène), valse et final: "…"'), after a form label; an unquoted title keeps its words
      const fq1 = titlePart.match(/^([^"]{0,60}?)\s*("[^"]+"(?:\s*\([^()]*\))*)/);
      if (fq1 && (!fq1[1].trim() || FORM_FIRST.test(fold(fq1[1].trim().split(/\s+/)[0])))) {
        if (fq1[1].trim()) formHint = fq1[1].trim();
        titlePart = looksLikeSingerParen(fq1[2]) ? fq1[2].replace(/\s*\([^()]*\)$/, '') : fq1[2]; // (not "(Part 1)")
      }
      singersRaw = last;
    }
  }
  // "Die Moritat von Mackie Messer ("The Ballad of Mack the Knife" – Street singer)": English title and singers in the parenthetical
  if (!sep && ctx.parenDash) {
    const pd = titlePart.match(/^(.*\S)\s*\(([^()]*?)\s+[–—-]\s+([^()]+)\)$/);
    if (pd && !/^(?:reprise|instrumental|part|version|act)\b/i.test(pd[3].trim()) && !/\d/.test(pd[3])) {
      titlePart = `${pd[1]} (${pd[2].trim()})`;
      // "(Men - Milady and chorus)", "("Milady is back" - Milady - written for the German production)": notes after the singers go
      const sp3 = pd[3].split(/\s+[–—-]\s+/).filter((x) => !/\b(?:only|productions?|version|cut|added|omitted|written for|not found)\b/i.test(x));
      singersRaw = sp3.length ? sp3[0].trim() : '';
    }
  }
  // '"Southern Son" (sung by [[Martin Crewes]])': the singers in a trailing parenthetical
  if (!sep) {
    const sb = titlePart.match(/^(.*\S)\s*\((?:sung|performed) by\s+([^()]+)\)$/i);
    if (sb) { titlePart = sb[1]; singersRaw = sb[2].trim(); }
  }
  // '"Summertime", act 1, scene 1 – Clara and Jake': the number's place in the show between title and dash
  const where = titlePart.match(/^("[^"]+"),?\s+act\s+(\d|[ivx]+|one|two|three)\b(?:,?\s*scene\s+\w+)?\s*$/i);
  if (where) { titlePart = where[1].trim(); actHint = actOf(`act ${where[2]}`); }
  // "Recit. and song, "Alone, and yet alive" (Katisha)", "Couplet by Johann: "Ich bin Gousmand"", "Act II Finale: "Or he or I
  // must die"": the kind of number, then its (quoted) title — the kind names the singers or the chorus
  const fq = titlePart.match(/^([^"]{2,60}?)\s*[,:]\s*("[^"]+"(?:\s*\([^()]*\))*)\s*$/);
  let fqNames = '';
  if (fq) {
    const f2 = formLabel(fq[1]) ?? (POSITIONAL.test(fq[1].trim()) && !/^(?:prologue|epilogue)\b/i.test(fq[1].trim()) ? { form: fq[1].trim(), names: '' } : null) ??
      (FORM_FIRST.test(fold(fq[1].trim().split(/\s+/)[0])) && fq[1].trim().split(/\s+/).length <= 5 && !/"/.test(fq[1]) ? { form: fq[1].trim(), names: '' } : null) ?? // "Choeur des bergers: "Voici …"
      (/^\p{Lu}[\p{L}'’-]+\s+(?:song|duet|trio|quartet|chorus|ballad|aria|march|waltz|dance|number|scena|ensemble)$/iu.test(fq[1].trim()) ? { form: fq[1].trim(), names: '' } : null) ?? // "Gambling Duet, "Sixes!
      (/\s(?:&|and)\s/.test(fq[1]) && !/^(?:pt|part|act|scene|no|nos|track|side|disc)\.?\s/i.test(fq[1]) && !/''[^"]*"/.test(rawText) && singerLike(fq[1], ctx) ? { form: '', names: fq[1] } : null); // "Ravennes & Cadeaux: "We're a philanthropic couple"
    if (f2) {
      formHint = f2.form; fqNames = f2.names; titlePart = fq[2];
      // Cox and Box: 'Finale, "My Hand upon It" (Box, Cox, Bouncer)'; The Sorcerer: '… "Or he or I must die" (leading to …) (Ensemble)'
      const sp = titlePart.match(/^("[^"]+"(?:\s*\([^()]*\))*?)\s*\(([^()]+)\)\s*$/);
      if (sp && looksLikeSingerParen(titlePart)) { titlePart = sp[1]; fqNames = [fqNames, sp[2]].filter(Boolean).join(', '); }
    }
  }
  // 'Air de Pâris "Au mont Ida"', 'Duo Hélène-Pâris "Oui c'est un rêve"', 'Chœur et Oreste "C'est Parthoénis"': a (French /
  // Italian / German …) kind of number, then the quoted title; the label may name the singers
  if (!fq && !formHint) {
    const fl2 = titlePart.match(/^([^"]{2,60}?)\s+("[^"]+"(?:\s*\([^()]*\))*)\s*$/);
    if (fl2 && FORM_FIRST.test(fold(fl2[1].split(/\s+/)[0])) && !/[.;:!?]/.test(fl2[1])) {
      formHint = fl2[1]; titlePart = fl2[2];
      // '"Eh! Quoi vous seriez" (All)': the singers after the quoted title
      const tail = titlePart.match(/^("[^"]+"(?:\s*\([^()]*\))*?)\s*\(([^()]+)\)$/);
      if (tail && !singersRaw && namedSingers(tail[2], ctx)) { titlePart = tail[1]; singersRaw = tail[2]; }
      if (!singersRaw) {
        // 'Couplets (Atala) "Petit bébé"', 'Duet (Jim and Liza) "Celebrities"', 'Air de Pâris "Au mont Ida"', 'Duo Hélène-Pâris …'
        const inParens = fl2[1].match(/\(([^()]+)\)\s*$/)?.[1];
        const names = inParens && namedSingers(inParens, ctx) ? parseSingers(inParens, ctx, []).singers
          : fl2[1].split(/\s+|-|['’]/).filter((w) => /^\p{Lu}/u.test(w) && !FORM_FIRST.test(fold(w)) && ctx.matchCharacter(w)).map((w) => ctx.matchCharacter(w));
        const chorus = /\b(?:ch(?:œ|oe)ur|chorus|coro|chor)\b/i.test(fl2[1]) || /\b(?:all|chorus|ensemble|company|tutti)\b/i.test(inParens ?? '');
        if (names.length || chorus) singersRaw = [...names, ...(chorus ? ['Chorus'] : [])].join(', ');
      }
    }
  }
  // 'Felice, Chloris, Max and Ferdinand "Although we are at war"': the singers, then the quoted title
  if (!sep && !fq) {
    const nq = titlePart.match(/^([^"]*[^",:\s])\s+("[^"]+"(?:\s*\([^()]*\))*)\s*$/);
    if (nq && /,|\band\b/.test(nq[1]) && singerLike(nq[1], ctx)) { titlePart = nq[2]; singersRaw = nq[1]; }
  }
  if (!sep) { // "Let Us Pray performed by Father MacLean", "Sydney You're Wonderful by David Campbell" (album)
    const pb = s.replace(/\.$/, '').match(/^(.+?)\s+(?:[Pp]erformed|[Ss]ung) by\s+(\p{Lu}.*)$/u) || (ctx.album ? s.match(/^(.+?)\s+by\s+(\p{Lu}[\p{L}.'-]+(?:\s+\p{Lu}[\p{L}.'-]+)+)$/u) : null);
    if (pb && /^\p{Lu}[\p{L}.'’-]*(?:\s+(?:(?:and|&|of|the|de|la)\s+)*\p{Lu}[\p{L}.'’-]*){0,6}$/u.test(pb[2].trim())) {
      titlePart = pb[1].trim(); singersRaw = ctx.album ? '' : pb[2].trim();
    }
  }
  // "No. 3a – Reprise for Exit – …": a bare number designation; the item is what follows
  if (sep && depth === 0 && /^(?:Nos?\.?\s*)?\d{1,3}[a-z]?(?:\s*(?:and|&|,)\s*\d{1,3}[a-z]?)*\.?$/i.test(titlePart)) return parseItem(singersRaw, ctx, warn, 1);
  // "Act III – Ballet": an act label and a kind of number
  if (sep && actOf(titlePart) && /^(?:act|part)\s+\S+$/i.test(titlePart) && formLabel(singersRaw)) { titlePart = `${titlePart} ${singersRaw}`; singersRaw = ''; }
  if ((titlePart.match(/\(/g) || []).length > (titlePart.match(/\)/g) || []).length) titlePart += ')'; // "(Music by X" never closed
  // the text after the dash is an italic work title — the source show (Side by Side by Sondheim) or a translation
  // (Rebecca: "Ich hab geträumt von Manderley ("Ich", Shadows) – ''I dreamt of Manderley''"), not singers
  const italicTail = depth === 0 && sep && /\s[–—-]\s*''(?!')(?:(?!'').)+''\s*$/.test(rawText.trim());
  // an italic tail that doesn't read as singers ("I dreamt of Manderley", "A Little Night Music") is a title;
  // italic singers ("– ''Theo, Nicola''") stay — a list where most italic tails are titles is decided per list
  const workLink = depth === 0 && sep && /\s[–—-]\s*(?:'')?\[\[[^\]|]*\((?:[^)]*\s)?(?:musical|film|album|opera|play|song|operetta|revue|TV series)\)(?:\|[^\]]*)?\]\](?:'')?\s*$/i.test(rawText.trim());
  const italicWork = (italicTail && !singerLike(singersRaw, ctx)) || workLink;
  if (italicWork) singersRaw = '';
  // "''Gypsy'' (1959), music by Jule Styne, book by Arthur Laurents: "Smile, Girls"" (Sondheim on Sondheim): a described
  // source before the quoted song title; a line with only the description ("… , book by George Furth") is a header
  const described = titlePart.match(/^([^"]+?):\s*("[^"]+"(?:\s*\/\s*"[^"]+")*.*)$/);
  if (described && (/,|\(|\b(?:music|book|lyrics|words|written|performed) (?:by|at)\b/i.test(described[1]) || described[1].split(/\s+/).length > 5)) titlePart = described[2].trim();
  else if (!/"/.test(titlePart) && /\b(?:music|book|lyrics|words) by\b/i.test(titlePart.replace(/\([^()]*\)/g, ' '))) {
    if (/^''[^']/.test(rawText.trim()) || /^(?:(?:music|lyrics?|words|book)(?:\s+(?:and|&)\s+(?:music|lyrics?|words))?)\s+by\b/i.test(titlePart)) return null; // a header / a credit line
    titlePart = titlePart.replace(/\s*(?:\/|,)\s*(?:(?:music|lyrics?|words|book)(?:\s+(?:and|&)\s+(?:music|lyrics?|words))?)\s+by\b.*$/i, ''); // "Moonlight surfing / words & music by …"
  }
  // "Timid Frieda (Les Timides) tune also used in an Ovaltine television advert GB": a remark after the title
  if (!/"/.test(titlePart)) titlePart = titlePart.replace(/^(.*\S\s*\([^()]+\))\s+(?=\p{Ll})([^()]+(?:\s+[^()]+){2,})$/u, (m, a, b) => (b.split(/\s+/).filter((w) => /^\p{Ll}/u.test(w)).length >= 2 && (a.match(/\(/g) || []).length === (a.match(/\)/g) || []).length ? a : m));
  // prose: long unquoted text or a sentence break outside quotes/parentheses (each part of a medley counted apart); "!" and
  // "?" inside a title are not sentence breaks ("I Do! I Do!", "Ha! Ein Liebesnest!", "Who Can? You Can")
  const outside = titlePart.replace(/"[^"]*"/g, ' Q ').replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ').trim();
  if (!titlePart.startsWith('"') && (outside.split(/\s*\/\s*/).some((p) => p.split(/\s+/).length > 12) || sentenceBreak(outside, false, true) || (/[^.]\.$/.test(outside) && outside.split(/\s+/).length > 7))) {
    // "Overture (a potpourri, which includes …). This was arranged …": the overture itself is a number
    const ov = titlePart.match(/^(overture|ouverture|entr['’]?acte|prelude|introduction)\b\s*(?:\(|[.:;,])/i);
    if (!ov) return null;
    titlePart = ov[1]; singersRaw = '';
  }
  let raw = singersRaw;
  let formQuoted = false; let formNames = '';
  // operetta / musical-comedy formats where the dash follows a kind of number ("Song with Trio", "Duet (Rosette, Vincent)"):
  //   Form – "first line" (Singers) · Form – Singers – "first line…" · Form: Singers – "Title" · Form (Singers) – Title (gloss)
  const colonForm = titlePart.match(FORM_PREFIX);
  const fl = formLabel(titlePart) ?? (colonForm && !/"/.test(titlePart) && singerLike(colonForm[2], ctx) ? { form: colonForm[1], names: colonForm[2] } : null);
  if (fl && raw) {
    const q = raw.match(/^(.*?)\s*(?:[–—-]\s*)?"([^"]+)"?[.…]*\s*((?:\([^()]*\)\s*)*)(?:\s*(?:and|&|\/)\s*"[^"]*"[.…]*)*\s*(?:[–—-].*)?$/);
    let lead = q ? q[1].replace(/[\s,;:–—-]+$/, '').trim() : '';
    if (q && lead && actOf(lead) && /^(?:act|part)\s+\S+$/i.test(lead)) lead = ''; // "Finale - Act I - "We have had …""
    if (q && (!lead || singerLike(lead, ctx))) {
      const line = q[2].trim();
      const words = line.replace(/\.{3}|…/g, ' ').trim().split(/\s+/).length;
      const lyricish = ELLIPSIS.test(line) || words > 10;
      if (ctx.publicDomain || !lyricish) titlePart = `"${ctx.publicDomain ? firstLineTitle(line) : line}"`;
      else titlePart = fl.form;
      const parenNames = parens(q[3] || '').map((p) => p.inner.split(/\s[–—-]\s/).pop().trim())
        .filter((x) => x.split(/\s*(?:,|&|\band\b)\s*/).filter((y) => y.trim()).every((y) => SINGER_PART.test(y.trim()))).join(', ');
      raw = [lead, fl.names, parenNames].filter(Boolean).join(', ');
      formQuoted = true; formNames = fl.names;
    } else if (!q && /^\p{Lu}/u.test(raw) && raw.split(/\s+/).length >= 2 && !parseSingers(raw.replace(/\([^()]*\)/g, ' '), ctx).instrumentalToken &&
        (/\([^()]+\)$/.test(raw) || /\s(?!(?:and|with|of|the|de|la|le|du|von|van)\s)\p{Ll}/u.test(raw)) && !singerLike(raw, ctx) &&
        raw.replace(/\([^()]*\)/g, ' ').trim().split(/\s+/).length <= 10 && !/[.;]\s+\p{Lu}|;|\.$/u.test(raw) &&
        !isGroupName((raw.match(/\(([^()]+)\)$/)?.[1] || '').replace(/^(?:the|a|an)\s+/i, '').replace(/\s+and\s+.*$/, ''))) {
      titlePart = `"${raw.replace(/\s*\([^()]*\)\s*$/, '').trim()}"`; // Form (Singers) – Title (translation)
      raw = fl.names; formQuoted = true; formNames = fl.names;
    }
    if (formQuoted && /\b(?:chorus|ensemble|finale|finaletto)\b/i.test(fl.form) && !/\b(?:chorus|ensemble|company)\b/i.test(raw)) raw = raw ? `${raw}, Chorus` : 'Chorus';
  }
  if (formQuoted && fl) formHint ??= fl.form;
  if ((formHint || fqNames) && !formQuoted) { // "Couplet by Johann: "Ich bin Gousmand"" / "Act II Finale: "Or he or I must die""
    raw = [raw, fqNames].filter(Boolean).join(', ');
    if ((/\b(?:chorus|ensemble)\b/i.test(formHint) || (/\b(?:finale|finaletto)\b/i.test(formHint) && !raw)) && !/\b(?:chorus|ensemble|company)\b/i.test(raw)) raw = raw ? `${raw}, Chorus` : 'Chorus';
    if (fqNames || /"/.test(titlePart)) formQuoted = Boolean(fq);
  }
  // "Chorus and Zara – The sun is down and over the town, far above …" (an old operetta list): the singers, then the first line
  if (ctx.publicDomain && !formQuoted && raw && !/"|\(/.test(raw + titlePart) && singerLike(titlePart, ctx)) {
    const w = raw.split(/\s+/);
    if (w.length >= 6 && w.filter((x) => /^\p{Ll}/u.test(x)).length >= w.length * 0.5) { titlePart = `"${firstLineTitle(raw)}"`; raw = sep ? s.slice(0, sep.start).trim() : ''; formQuoted = true; }
  }
  // the singers part must be singers, not a note or a quoted lyric line
  const rawNoParens = raw.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const quotedOnly = /^"[^"]+"?[.…]*$/.test(rawNoParens);
  if (!quotedOnly && /^(?:"[^"]+"\s*(?:,|and|&|\/)?\s*){2,}$/.test(rawNoParens)) raw = ''; // a list of song titles, not singers
  if (!formQuoted && quotedOnly && !/"/.test(titlePart)) {
    // "Rudolph – "Is love a dream…"": singers first, the number's title (first line) in quotes
    const title = rawNoParens.replace(/^"|"?[.…]*$/g, '').replace(/[,;:!.…]+$/, '').trim();
    if (singerLike(titlePart, ctx)) {
      if (title.split(/\s+/).length > 10 && !ctx.publicDomain) return null; // a whole lyric line, not a title
      raw = titlePart; titlePart = `"${ctx.publicDomain ? firstLineTitle(title) : title}"`;
    } else raw = '';
  } else if (/\s[–—-]\s*"[^"]*"?[.…]*$/.test(raw)) {
    raw = raw.replace(/\s*[–—-]\s*"[^"]*"?[.…]*$/, '').trim(); // trailing quoted first line after the singers
  }
  if (/^"[^"]*(?:\s+[^"\s]+){3}/.test(raw)) raw = ''; // starts with a quoted line: a first line of lyrics, not singers
  raw = raw.replace(/^\((?:sung|performed) by\s+([^()]+)\)$/i, '$1').replace(/^(?:performed|sung|played) by\s+/i, '').replace(/\s*\/\s*(?:performed|sung) by\s+/gi, ' / ');
  if (/^(?:(?:music|lyrics?|words|book)(?:\s+(?:and|&)\s+(?:music|lyrics?|words))?|written|composed|arranged)\s+by\b/i.test(raw)) raw = ''; // a credit, not singers
  if (/^\p{Ll}/u.test(raw) && !/^(?:the|and|with|all|both|everyone|company|ensemble|chorus|cast)\b/.test(raw) && !/^(?:d['’]|de |di |da |van |von |le |la |du )\p{Lu}/u.test(raw)) raw = ''; // "featured the dancers …" is a note (not "d'Artagnan")
  // "Included in all stage versions", "Used only in American productions": a production note
  if (/^(?:included|used|cut|added|reinstated|restored|dropped|omitted|replaced|originally|later|only|not|also|first|written|sung in|performed in)\b/i.test(raw) && raw.split(/\s+/).length >= 3 && !singerLike(raw, ctx)) raw = '';
  // "– ''1877 version'' only", "– 1884 version": which version has the number, not who sings it
  // "Trina (Added for 1982 LA run of … production; written originally for In Trousers)": a production note in the singers
  raw = raw.replace(/\s*\(([^()]*)\)/g, (m, x) => (x.split(/\s+/).length >= 5 && /\b(?:added|cut|written|production|revival|version|originally|replaced|run|dropped|omitted)\b/i.test(x) ? '' : m));
  const rawBare = raw.replace(/\([^()]*\)/g, ' ');
  if (/\b(?:1[6-9]|20)\d\d\b/.test(rawBare) && /\b(?:version|production|revival|only|premiere|staging)\b/i.test(rawBare) && !singerLike(rawBare, ctx)) raw = '';
  // "Sophie - Running order adjusted for the 2015 revival.": a note after a second dash
  raw = raw.replace(/\s+[–—-]\s+(?=\S+\s+\p{Ll})[^–—"]*$/u, (m) => (m.split(/\s+/).length >= 4 && m.split(/\s+/).filter((w) => /^\p{Ll}/u.test(w) && !/^(?:and|with|the|of|&)$/.test(w)).length >= 2 ? '' : m));
  const rawOut = raw.replace(/\([^()]*\)/g, ' ').trim();
  // group descriptions ("backup male dancers", "a Student") are not prose
  const rawWords = rawOut.split(/\s*(?:,|;|&|\band\b)\s*/).filter((p) => p && !isGroupName(p.replace(/^(?:the|a|an|some|two|three|four)\s+/i, ''))).join(' ').split(/\s+/).filter(Boolean);
  if (raw && (sentenceBreak(rawOut) || /\b(?:was|were|is|are|has|had|been|inserted|replaced|performed in|sung in|appears)\b/.test(rawOut) ||
      (rawWords.length > 25 && lowerShare(rawWords) > 0.3) || (rawWords.length >= 5 && lowerShare(rawWords) > 0.5))) raw = ''; // a note or a lyric line, not singers
  // never keep a quoted line of five or more words (a first line of lyrics) in the singers text
  raw = raw.replace(/"[^"]*"/g, (m) => (m.split(/\s+/).length >= 5 ? '' : m)).replace(/,?\s*(?:\b(?:and|or)\b|&)?\s*\)/g, ')').replace(/\(\s*\)|:\s*(?=$|[,/])/g, '')
    .replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').replace(/[\s,;:–—-]+$/, '').trim();
  singersRaw = raw;
  const t = parseTitle(titlePart, ctx);
  if (!t.title || t.title.length > 160 || t.filmOnly || t.prose || /^(?:scene \d+:\s*)?\(?untitled\)?$/i.test(t.title)) return null;
  if (!/[\p{L}\p{N}]/u.test(t.title)) return null;
  if (t.lyric && !formQuoted) { // a lyric excerpt used as a track name (Fun Home: "Sometimes my father appeared to …")
    if (!ctx.publicDomain) { warn('dropped:lyric-title'); return null; }
    t.title = firstLineTitle(t.title);
  }
  let sg = parseSingers(singersRaw, ctx, links);
  // medley with one singer group per part: "Golden Bangkok / One Night in Bangkok – Instrumental / Freddie and Ensemble"
  const rawParts = singersRaw.split(/\s+\/\s+/);
  if (t.medley && rawParts.length > 1 && rawParts.length === t.title.split(' / ').length) {
    const per = rawParts.map((r) => parseSingers(r, ctx, links));
    const sung = per.filter((x) => !(x.instrumental || (x.instrumentalToken && !x.singers.length && !x.ensemble)));
    if (sung.length && sung.length < per.length) {
      sg = { ...sg, instrumental: false, instrumentalToken: false, singers: [...new Set(sung.flatMap((x) => x.singers))], ensemble: sung.some((x) => x.ensemble), actors: sung.flatMap((x) => x.actors) };
    }
  }
  // "A Miracle Would Happen/When You Come Home to Me – Jamie/Cathy" (The Last Five Years): two numbers sung one after the
  // other, each by its own singer — two entries, never a false duet
  let splitParts = null;
  if (!depth && !t.reprise) {
    const tp = t.title.split(/\s*\/\s*/); const spp = singersRaw.split(/\s*\/\s*/);
    if (tp.length >= 2 && tp.length <= 4 && tp.length === spp.length && tp.every((x) => x.split(/\s+/).length >= 2 || x.length >= 6)) {
      const per = spp.map((r) => parseSingers(r, ctx, links));
      const all = per.flatMap((x) => x.singers);
      if (per.every((x) => x.singers.length && !x.ensemble && !x.instrumental && x.singers.every((y) => ctx.matchCharacter(y))) && new Set(all).size === all.length) {
        splitParts = tp.map((x, i) => `"${x}" – ${spp[i]}`);
      }
    }
  }
  if (STRONG_INSTR_TITLE.test(t.title) && (sg.singers.length || sg.groups.length) && !sg.ensembleWord && !sg.singers.some((x) => ctx.matchCharacter(x, true))) {
    sg.singers = []; sg.ensemble = false; sg.instrumentalToken = true; // Six: "Playout – The Ladies in Waiting" (the band)
  }
  // instrumental by title only when every part of a combined title is instrumental ("Overture / Prologue" and
  // "Prelude and Simply Heavenly" are sung)
  const parts = t.medley ? [] : t.title.split(/\s*\/\s*|\s+(?:and|&)\s+/);
  const instrTitle = parts.length > 0 && parts.every((p) => INSTR_TITLE.test(p) || (!singersRaw && DANCE_TITLE.test(p)));
  // a bare "Dance" / "Ballet" number is danced even when the list names who dances it ("Ballet: 'The Upside-Down Thief'")
  // (only a quoted ballet name: "Dance: Ten; Looks: Three" is a song)
  const balletOf = t.title.match(/^(?:ballet|dance|dance break|pas de deux)\s*:\s*'(.+)'$/i);
  if (balletOf) t.title = balletOf[1].trim();
  const danceOnly = (balletOf || BARE_DANCE.test(t.title)) && !/\bsing|\bsung|vocal/i.test(singersRaw);
  // a danced number: '"Mosquito Ballet" – (Dancers)', '"Imps March" – Dance of Metal Imps', '"Fox Trot" – featured the dancers
  // …', 'Prelude – "A Storm at Sea" – Dance of Waves' (nobody sings)
  const danceTail = afterDash.split(/\s[–—-]\s/).pop().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const danced = !sg.singers.length && !/\bsing|\bsung|vocal|chorus|company|ensemble/i.test(afterDash) &&
    /^(?:(?:the\s+)?(?:[\p{L}'-]+\s+)?dancers?|(?:a\s+|the\s+)?dance of\b.*|(?:featured|featuring)\s+(?:the\s+)?dancers?\b.*|danced by\b.*|ballet(?:\s+\S+)?)$/iu.test(danceTail);
  const instrumental = forceInstr || t.instrumental || (sg.instrumental && !sg.vocals) || danceOnly || danced ||
    (!sg.singers.length && !sg.ensemble && !sg.actors.length && !sg.vocals && (sg.instrumentalToken || instrTitle));
  return {
    title: t.title,
    singersRaw: singersRaw.replace(/\s+/g, ' ').trim(),
    singers: instrumental ? [] : sg.singers,
    ensemble: instrumental ? false : sg.ensemble,
    reprise: t.reprise,
    repriseNo: t.repriseNo,
    instrumental,
    medley: t.medley,
    actors: sg.actors,
    until: t.until,
    formQuoted, form: formHint, actHint, quoted: /"/.test(titlePart), sungBy: /\b(?:sung|performed)\s+by\b/i.test(depth ? text : rawText),
    italicTail, italicWork,
    parenLinked: parenLinked(t.title, links),
    marks: depth ? [] : [...new Set(rawText.replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/g, '').match(/[†‡§¶]/g) || [])],
    ...(splitTitles ? { splitTitles } : splitParts ? { splitTitles: splitParts } : {}),
  };
}
const ELLIPSIS = /^(?:\.{3}|…)|(?:\.{3}|…)[!?.,]?$/;

// first word of a kind-of-number label in the lists of French / Italian / German / Spanish / English operettas (folded)
const FORM_FIRST = /^(?:air|aria|ariette|arietta|choeur|chœur|chor|coro|chorus|duo|duet|duett|duetto|trio|terzett|terzetto|terceto|quatuor|quartet|quartett|quartetto|quintette?|quintet|sextuor|sextet|septuor|couplets?|ronde|rondeau|rondo|romance|romanza|romanze|chanson|chansonnette|valse|walzer|waltz|marche|march|invocation|finale?|introduction|tyrolienne|barcarolle|bolero|serenade|ballade|cavatine|cavatina|lied|entree|recit|recitatif|recitative|melodrame|melodrama|priere|hymne|madrigal|canzone|canzonetta|seguidilla|habanera|polonaise|mazurka|galop|cancan)$/;
const BARE_DANCE = /^(?:act (?:\d|i{1,3}|iv|one|two|three)\s+)?(?:dance|ballet|dance break|dance music|dance sequence|dance specialty|specialty dance|dance number|ballet music|pas de deux|pas de trois)(?:\s+(?:\d+|[ivx]+))?(?:\s*\((?:act \w+|\d+)\))?$/i;
// "Another World ([[Take A Chance On Me]])", "Am I Blue? ([[Harry Akst]], [[Grant Clarke]])": every part of the
// trailing parenthetical is a wikilink — a source song or its writers, not the singers
function parenLinked(title, links) {
  const m = title.match(/\(([^()]+)\)$/);
  if (!m || !links.length) return false;
  // the parenthetical is only link labels joined by commas / "and": "(Snow White and the Seven Dwarfs and Pinocchio)"
  let rest = ` ${m[1]} `; const used = [];
  for (const l of [...links].filter((x) => x.label).sort((a, b) => b.label.length - a.label.length)) {
    if (rest.includes(l.label)) { rest = rest.split(l.label).join(' '); used.push(l); }
  }
  if (!used.length || !/^[\s,;&/]*(?:(?:and|&)[\s,;&/]*)*$/i.test(rest)) return false;
  // 'work' when a part links to a film / show / album ("On the Record": "… ([[Cinderella (1950 film)|Cinderella]])")
  return used.some((l) => /\((?:[^)]*\s)?(?:film|musical|album|opera|operetta|TV series|song)\)$/i.test(l.target)) ? 'work' : true;
}

// share of ordinary lowercase words (not "and/the/of/company/chorus …") — names are capitalised
const lowerShare = (words) => (words.length ? words.filter((w) => /^\p{Ll}/u.test(w) && !/^(?:and|the|of|with|de|la|von|van|du|chorus|company|ensemble|cast|all|others|a|an)$/.test(w)).length / words.length : 0);

// A sentence break (". Next", "; then") that isn't an abbreviation ("Mr. X", "St. Bridget", "J. D.").
const ABBREV = /(?:(?:^|\s)(?:mr|mrs|ms|dr|st|jr|sr|no|nos|mt|vs|vol|pt|op|ca|mme|mlle|messrs|prof|gen|col|capt|lt|sgt|rev|fr|recit|arr|orch|ed|approx|sen|gov|pres|hon|[ivx]{1,4})|(?:^|[\s.])\p{L})$/iu;
/** titleMode: only "." and ";" break a sentence ("I Do! I Do!", "Who Can? You Can" are titles). */
export function sentenceBreak(str, lowerOnly = false, titleMode = false) {
  const re = titleMode ? (lowerOnly ? /[.;]\s+(?=\p{Ll})/gu : /[.;]\s+(?=\p{L})/gu) : lowerOnly ? /[.!?;]\s+(?=\p{Ll})/gu : /[.!?;]\s+(?=\p{L})/gu;
  for (const m of str.matchAll(re)) {
    const before = str.slice(0, m.index);
    if (m[0][0] === '.' && ABBREV.test(before)) continue;
    return true;
  }
  return false;
}

// Does this text read like a list of singers (all characters / groups / short capitalised names)?
function singerLike(text, ctx) {
  // ("Peter and Trio", "Dee Anthony, Greg, Peter, Trio and Male Ensemble": a vocal group named with the singers is the chorus)
  const probe = String(text).split(/\s*(?:,|;|&|\/|\band\b|\bwith\b)\s*/)
    .filter((t) => !/^(?:the\s+)?(?:(?:male|female|men's|women's|boys'?|girls'?|backup|backing|vocal|singing|close-harmony|barbershop)\s+)?(?:trio|quartet|quintet|sextet|septet|octet)$/i.test(t.trim())).join(', ');
  if (!probe.trim()) return false;
  if (/\b(?:reprise|finale|entr'?acte|overture|recitative|duet|trio|quartet|quintet|sextet+e?|song|scene|dance|opening|number|march|waltz|ballet|medley|prologue|epilogue|introduction)\b/i.test(probe.replace(/\bchorus\b/gi, ''))) return false;
  const sg = parseSingers(text, ctx, []);
  if (!sg.tokens.length || sg.instrumentalToken || sg.actors.length) return false;
  if (sg.dropped.some((d) => /^\d+$/.test(d.trim()))) return false; // "70, Girls, 70" is a show title
  if (!sg.singers.length && !sg.ensemble) return false; // nothing read as a name (a long title was dropped)
  if (sg.tokens.some((t) => /[!?]/.test(t) || (/^\p{Ll}/u.test(t) && !isGroupName(t.replace(/^(?:the|a|an|all|some|other)\s+/i, ''))))) return false; // "Hardi, moissonneurs! du courage"
  return sg.singers.every((x) => ctx.matchCharacter(x) || /^\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*)?$/u.test(x));
}

// Stricter than singerLike: every name is a character, a chorus/company word or a capitalised group or role, and nothing
// reads like a sentence ("The day has just finished" is a translation, not the singers)
function namedSingers(text, ctx) {
  const t = String(text).trim();
  if (!t || /"/.test(t) || !singerLike(t, ctx)) return false;
  const sg = parseSingers(t, ctx, []);
  const known = (x) => ctx.matchCharacter(x) || /^(?:all|chorus|company|ensemble|tutti|full company|full cast|everyone|others)$/i.test(x) ||
    (isGroupName(x.replace(/^(?:the|a|an)\s+/i, '')) && x.split(/\s+/).length <= 4 && !/\s\p{Ll}+\s+\p{Ll}/u.test(x));
  // (a show without a character list: capitalised names of up to three words, not an interjection like "Oh")
  const name = (x) => (!ctx.hasCharacters || sg.tokens.some(known)) && /^\p{Lu}[\p{L}.'’-]*(?:\s+(?:of|the|de|la|le|du|von|van|di|da)?\s*\p{Lu}[\p{L}.'’-]*){0,2}$/u.test(x) &&
    !/^(?:oh|o|ah|yes|no|hail|hey|come|go|see|lo|alas|hurrah|farewell|goodbye|hello)$/i.test(x);
  return sg.tokens.length > 0 && sg.tokens.every((x) => known(x) || name(x));
}

// A trailing "(Samuel and Chorus of Pirates)" / "(Isabelle)" that reads like a list of singers:
// every part starts with a capital and has at most 5 words (lowercase only for linking words).
const SINGER_PART = /^(?:the\s+)?"?\p{Lu}[\p{L}.'’-]*"?(?:\s+(?:(?:of|the|de|la|le|von|van|du|in|on|at|des|del|di|for|to)\s+)*\p{Lu}[\p{L}.'’-]*){0,4}$/u;
export function looksLikeSingerParen(title) {
  const m = title.match(/\(([^()]+)\)$/);
  if (!m || m.index === 0) return false;
  const parts = m[1].split(/\s*(?:,|&|\band\b|\bwith\b)\s*/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((x) => SINGER_PART.test(x));
}

// {{Track listing}} → synthetic "* "Title" – extra" lines (extra only when the extra column is characters)
function trackListingLines(params) {
  const f = templateFields(params);
  const out = [];
  if (f.headline) out.push(`;${f.headline}`);
  const charCol = /character|sung by|performed by|singer/i.test(f.extra_column || '');
  const nums = Object.keys(f).map((k) => k.match(/^title(\d+)$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  for (const n of nums) {
    const raw = f[`title${n}`].replace(/"/g, '').replace(/\s*\(?\s*<small>[\s\S]*?<\/small>\s*\)?/gi, '').trim();
    if (!raw || /^(?:medley|megamix|mega-mix|mashup)$/i.test(raw)) continue; // (a track called only "Medley" names no song: Love, Linda)
    const extra = charCol && f[`extra${n}`] ? ` – ${f[`extra${n}`]}` : '';
    // a note is kept only when it says what kind of track it is ("reprise", "instrumental", "part 2"); other notes name
    // the performers ("Tom Jones with Sounds of Blackness"), a source piece or where it comes in the show
    const noteText = cleanInline(stripRefs(f[`note${n}`] || '')).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    const note = /\b(?:reprise|instrumental|part \d|medley|finale|overture|entr'?acte)\b/i.test(noteText) && noteText.split(' ').length <= 5 ? ` (${noteText})` : '';
    // one side of a 78 with several numbers: "(1) Midsummer's Eve<br />(…)<br />(2) March of the Trollgers"
    const parts = raw.split(/<br\s*\/?>/i).map((x) => x.trim()).filter((x) => x && !/^\(/.test(x.replace(/^\(\d\)\s*/, 'x')));
    if (parts.length > 1 && parts.some((x) => /^\(\d\)/.test(x))) {
      for (const x of parts) out.push(`* "${x.replace(/^\(\d\)\s*/, '').replace(/<[^>]+>/g, '').replace(/'''/g, '').trim()}"${extra}`);
      continue;
    }
    out.push(`* "${raw}"${note}${extra}`);
  }
  return out;
}

// list templates → list lines; column templates on lines of their own (so "'''Label'''{{col-begin}}" is a label line)
const LIST_TEMPLATE = /^(?:ordered list|unbulleted list|ubl|ublist|bulleted list|plainlist|plain list|flatlist|hlist|collapsible list)$/;
const COLUMN_TEMPLATE = /^(?:col-begin|col-start|col-break|col-end|col-\d+|col-\d+-of-\d+|colbegin|colend|div col|div col end|columns-list|multicol|multicol-break|multicol-end|end multicol|top|mid|bottom|refbegin|refend)$/;
function preprocessBody(lines) {
  let text = stripRefs(stripComments(lines.join('\n')));
  text = mapTemplates(text, (name, params, raw) => {
    if (/^track ?listing$/.test(name)) return '\n' + trackListingLines(params).join('\n') + '\n';
    if (/^infobox\b|^album ratings$|^music ratings$|^certification table/.test(name)) return '';
    if (COLUMN_TEMPLATE.test(name)) return `\n${raw}\n`;
    if (LIST_TEMPLATE.test(name)) {
      const pos = params.filter((x) => !/^\s*[a-z_ -]+\s*=/i.test(x)).map((x) => x.trim()).filter(Boolean);
      const items = /^(?:plainlist|plain list|flatlist|collapsible list)$/.test(name) ? pos.join('\n').split('\n').filter((l) => /^\s*[*#]/.test(l)).map((l) => l.replace(/^\s*[*#]+\s*/, ''))
        : pos.flatMap((x) => x.split(/\n\s*[*#]+\s*/)).map((x) => x.replace(/^\s*[*#]+\s*/, ''));
      return '\n' + items.map((x) => `# ${x.trim()}`).join('\n') + '\n';
    }
    return raw;
  });
  return text.split('\n');
}
/** A short line that can name the list after it ("Boston", "New York Theatre Workshop", "… on the cast album:"), or null. */
function softLabel(text) {
  const t = cleanInline(expandTemplates(String(text))).replace(/\s+/g, ' ').trim();
  // (not a legend: "Renamed from the Hartford production (#)", "† Not on the cast recording")
  if (!t || /[#*†‡§^¤]|\((?:[^()]{0,3})\)|\b(?:denotes|indicates|renamed|replaced|not (?:included|in|on)|only in)\b/i.test(t)) return null;
  if (t.length <= 60 && t.split(' ').length <= 8 && /^\p{Lu}/u.test(t) && !/[.!?;]\s|[.!?;]$/.test(t)) return t.replace(/:\s*$/, '');
  if (/:\s*$/.test(t)) { const last = t.replace(/:\s*$/, '').split(/(?<=[.!?])\s+/).pop(); if (last.split(' ').length <= 40) return last; }
  return null;
}

/**
 * Two production lists written one after the other with only a plain line, an italic venue or a paragraph between
 * them (Sing Street: "New York Theatre Workshop" … "Boston"; Sondheim on Sondheim: the revue's list, then "… on the
 * cast album:"): split a list where the items after such a line repeat most of the list before it. (Songs listed
 * again inside one list — reprises, a finale — are never split off: they are few, or marked as reprises.)
 */
function splitRepeatedLists(blocks) {
  const out = [];
  for (const b of blocks) {
    // several lines at one place ("‡ Cut from …", a paragraph, "… on the cast album:"): the last one that reads as a label
    const byAt = new Map();
    for (const c of b.soft || []) if (c.at > 0 && c.at < b.items.length) byAt.set(c.at, { at: c.at, label: c.label ?? byAt.get(c.at)?.label ?? null });
    const cuts = [...byAt.values()].sort((x, y) => x.at - y.at);
    const all = b.items; let start = 0; let label = b.label; let first = true;
    const push = (items, lab) => {
      if (first) { Object.assign(b, { items, label: lab }); out.push(b); first = false; return; }
      // items that kept the act of the list before (no act label of their own) have no act
      const inherited = items[0]?.actSeq;
      for (const it of items) if (it.actSeq === inherited && out.at(-1).items.some((x) => x.actSeq === inherited)) it.act = null;
      out.push({ label: lab, items, notes: [], maxAct: Math.max(0, ...items.map((x) => (typeof x.act === 'number' ? x.act : 0))), soft: [], legendLines: [] });
    };
    for (const c of cuts) {
      if (c.at <= start) continue;
      const before = all.slice(start, c.at);
      const after = all.slice(c.at).filter((x) => !x.reprise);
      const key = (t) => norm(t.replace(/(?:\s*\([^()]*\))+$/, '')); // "Love Is In The Air (Barbara Cook, …)" = "Love Is in the Air"
      const base = new Set(before.map((x) => key(x.title)));
      const again = after.filter((x) => base.has(key(x.title))).length;
      if (again >= 3 && again >= after.length * 0.4 && again >= before.length * 0.4) {
        push(before, label); start = c.at; label = c.label;
      }
    }
    push(all.slice(start), label);
    if (out.at(-1) !== b) b.maxAct = Math.max(0, ...b.items.map((x) => (typeof x.act === 'number' ? x.act : 0)));
  }
  return out;
}

// Lines of a song section in formats that are read like list items:
//  - operetta lists whose numbers have "**Verse …"/"**Refrain …" first lines under them (Die Herzogin von Chicago):
//    one item per number, named by its refrain (or first line), singers from the number's parenthesis
//  - scene-by-scene lists of typed lines ": song: "X" (sung by Y)", ": instrumental music: "Z"" (an arena spectacular)
//  - "::Overture" lines above a numbered list
function normalizeListLines(lines) {
  let out = lines;
  if (out.filter((l) => /^\s*\*{2,}\s*(?:verse|refrain)\b/i.test(l)).length >= 3) {
    const res = [];
    for (let i = 0; i < out.length; i++) {
      const top = out[i].match(/^\s*\*(?!\*)\s*(.*)$/);
      if (!top) { if (!/^\s*\*{2,}/.test(out[i])) res.push(out[i]); continue; }
      let text = top[1].trim(); const kids = [];
      let j = i + 1;
      for (; j < out.length && /^\s*\*{2,}/.test(out[j]); j++) kids.push(out[j].replace(/^\s*\*+\s*/, '').trim());
      i = j - 1;
      // an unclosed singer parenthesis goes on over the next lines: "Finale I (Mary, Prinz, … Perolin" + "**Negresco, … Chorus)"
      while (kids.length && (text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length) text += `, ${kids.shift()}`;
      const num = text.match(/^((?:No\.\s*)?\d{1,3}[a-z]?[.)]?\s+)/i)?.[1] ?? '';
      const body = text.slice(num.length);
      const sp = body.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
      const withSingers = sp && (kids.length || /,|\band\b|chorus|ensemble/i.test(sp[2]));
      const head = withSingers ? sp[1] : body; const sing = withSingers ? sp[2] : '';
      const form = head.replace(/\s*\([^()]*\)\s*$/, '').trim();
      const refrain = kids.find((k) => /^refrain\b/i.test(k)) ?? kids.find((k) => !/^verse\b/i.test(k)) ?? kids.find((k) => /^verse\b/i.test(k));
      const line = (refrain || '').replace(/^(?:verse|refrain)\s*/i, '').replace(/"/g, "'").trim();
      if (!line || /^finale/i.test(form)) { res.push(`* ${num}${sing ? `${form} – ${sing}` : body}`); continue; }
      res.push(`* ${num}"${line}"${/^reprise$/i.test(form) ? ' (Reprise)' : ''}${sing ? ` – ${sing}` : ''}`);
    }
    out = res;
  }
  const TYPED = /^\s*:+\s*(?:scene\s+\d+\.\s*)?(song|instrumental(?:\s+music)?|poem|epilogue|prologue)\s*[:"]\s*(.*)$/i;
  if (out.filter((l) => TYPED.exec(l)?.[1].toLowerCase() === 'song').length >= 3) {
    out = out.flatMap((l) => {
      const m = l.match(TYPED);
      if (!m) return /^\s*\*/.test(l) ? [] : [l]; // other bullets there are notes ("* Country songs and country dancing")
      const kind = m[1].toLowerCase(); const rest = m[2].replace(/^"?/, '"').replace(/&mdash;|—|–/g, ' – ');
      if (kind === 'song') return [`* ${rest}`];
      if (kind.startsWith('instrumental')) return [/\bsung by\b/i.test(rest) ? `* ${rest}` : `* ${rest.replace(/\s*\([^()]*\)\s*$/, '')} (instrumental)`];
      return [];
    });
  }
  // "::Overture" above a "#" list
  if (out.some((l) => /^\s*[*#]/.test(l))) out = out.map((l) => (/^\s*:+\s*([^"*#:{|].{0,40})$/.test(l) && INSTR_TITLE.test(l.replace(/^\s*:+\s*/, '').trim()) && l.replace(/^\s*:+\s*/, '').trim().split(/\s+/).length <= 3 ? `# ${l.replace(/^\s*:+\s*/, '').trim()}` : l));
  return out;
}

// footnote templates after a label: "'''Act I'''{{sfn|…}}{{sfnm|…}}"
const dropRefTemplates = (l) => mapTemplates(l, (name, params, raw) => (/^(?:sfnm?|sfnp|efn(?:-[a-z]+)?|refn|r|rp|cn|citation needed|harvnb|ref label|note label)$/.test(name) ? '' : raw));
const LICENCE_NOTE = /\blicen[cs]/i;

/** Split a song section into production lists ("blocks") of items with acts. */
export function extractBlocks(bodyLines, ctx, warn = () => {}) {
  let lines = normalizeListLines(preprocessBody(bodyLines));
  // no list at all, but "Title - Singers" paragraph lines (Mulan Jr.) or "{{0|1}}1. Ouverture<br />" lines (Threepenny Opera):
  // read those lines as list items
  if (!lines.some((l) => /^\s*[*#]/.test(l) || /^\s*\{\|/.test(l))) {
    const cand = lines.map((l) => {
      const t = l.trim();
      if (!t || /^(?:[=;:|!<]|\{\|)/.test(t)) return false;
      const c = cleanInline(expandTemplates(stripRefs(t))).replace(/\s*\/\s*$/, ''); const sp = findSeparator(c);
      if (c.length > 200) return false;
      if (/^\d{1,2}[a-z]?\.\s*\p{Lu}/u.test(c) && c.length < 160 && !sentenceBreak(c.replace(/^\d{1,2}[a-z]?\.\s*(?:[IVX]{1,4}\.\s*)?/, ''), false, true)) return true; // "2. Too Old For This (Harry, Frannie)", "11a. Polly's Lied (…)"
      return Boolean(sp && sp.start > 0 && c.slice(0, sp.start).split(/\s+/).length <= 12 && !sentenceBreak(c.slice(0, sp.start)));
    });
    const nonEmpty = lines.filter((l) => l.trim() && !headingOf(l)).length;
    if (cand.filter(Boolean).length >= 3 && cand.filter(Boolean).length >= nonEmpty * 0.5) lines = lines.map((l, i) => (cand[i] ? `* ${l.trim().replace(/(?:<br\s*\/?>\s*)+$/i, '')}` : l));
  }
  // list-level numbering without punctuation ("* 1 Opening Chorus", "* 2 Duet: …")
  const bullets = lines.map((l) => l.match(/^\s*[*#]+\s*(.*)$/)?.[1]).filter(Boolean).map((b) => stripFormatting(b).trim());
  ctx.bareNumbers = bullets.length >= 3 && bullets.filter((b) => /^\d{1,2}[a-z]?\s+\p{Lu}/u.test(b)).length >= bullets.length * 0.7;
  // "Opener—Sebastian, Billy and Chorus": an unspaced em dash is the separator when most items use it
  ctx.tightDash = bullets.length >= 3 && bullets.filter((b) => /[\p{L}.!?'"]—\p{Lu}/u.test(b) && !/\s[–—-]\s/.test(b)).length >= bullets.length * 0.5;
  ctx.dotDash = bullets.length >= 3 && bullets.filter((b) => /\s(?:\.{3,}|…)\s/.test(b) && !/\s[–—-]\s/.test(b)).length >= bullets.length * 0.5;
  // "Seeräuberjenny (Pirate Jenny – Polly)": the English title and the singers in a trailing parenthetical
  const plainBullets = bullets.map((b) => cleanInline(expandTemplates(b)));
  ctx.parenDash = plainBullets.length >= 3 && plainBullets.filter((b) => /\([^()]*\s[–—-]\s[^()]+\)\s*$/.test(b)).length >= plainBullets.length * 0.5;
  // "Note: composers in parentheses" — a trailing parenthetical is a credit, not the singers
  const parenCredits = lines.some((l) => /\b(?:composers?|writers?|songwriters?|original (?:artists?|performers?|songs?)|credits?|authors?)\b[^.]{0,40}\bparenthes/i.test(l));
  const blocks = []; let block = null; let act = null; let skip = false; let skipLevel = 99; let layoutDepth = 0;
  let pendingOther = null; const notes = [];
  let actSeq = 0; // counts act labels, so a list split later knows which items inherited an act from the list before
  let noteBlock = null; // the list a "Notes"/"Key" block under it belongs to (its lines can name added numbers)
  const newBlock = (label) => { block = { label, items: [], notes: [], maxAct: 0, soft: [], legendLines: [] }; blocks.push(block); act = null; actSeq++; };
  // a line between two parts of the section ("Boston", "''Guthrie Theater''", "… on the cast album:"): a possible list
  // boundary, used only if the items after it repeat the list before it (see splitRepeatedLists)
  // the label of a line right after the list so far ("The musical numbers from the 1954 Broadway production are as follows:")
  const endLabel = () => [...block.soft].reverse().find((c) => c.at === block.items.length && c.label)?.label ?? null;
  const softBreak = (text) => { if (block.items.length) block.soft.push({ at: block.items.length, label: softLabel(text) }); else if (!block.label && softLabel(text)) block.label = softLabel(text); };
  newBlock(null);
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    const h = headingOf(raw);
    let label = null; let level = 99; let italicLabel = false;
    const bare = dropRefTemplates(raw).trim();
    if (h) { label = h.title; level = h.level; if (skip && level > skipLevel) continue; skip = false; } else if (/^\s*;/.test(raw)) label = dropRefTemplates(raw.replace(/^\s*[;:]+\s*/, ''));
    else if (/^'''[^']/.test(bare) && /'''\s*:?\s*$/.test(bare) && bare.length < 90) label = bare.replace(/^'+|'+\s*:?$/g, '');
    // "*'''1977 world premiere production'''": a bullet that is only a bold production label
    else if (/^\*+\s*'''[^']/.test(bare) && /'''\s*:?\s*$/.test(bare) && bare.length < 90 &&
      ['prod', 'act'].includes(classifyLabel(cleanInline(expandTemplates(bare.replace(/^\*+\s*/, '')))).kind)) label = bare.replace(/^\*+\s*/, '').replace(/^'+|'+\s*:?$/g, '');
    else if (/^''[^']/.test(bare) && /[^']''\s*:?\s*$/.test(bare) && bare.length < 60 && !/''[^']+''.*''/.test(bare)) { label = bare.replace(/^'+|'+\s*:?$/g, ''); italicLabel = true; } // ''Guthrie Theater''
    else if (/^\s*(?:notes?|keys?|legend|notes on the songs)\s*:?\s*$/i.test(stripFormatting(raw).trim())) label = stripFormatting(raw).trim();
    else if (!/^\s*[*#:|!{]/.test(raw) && bare.length < 40 && actOf(cleanInline(expandTemplates(bare)).replace(/[:.]+$/, ''))) label = bare; // a plain "Act 1" line (Candide)
    else if (!/^\s*[*#:|!{<]/.test(raw) && /:\s*$/.test(bare) && bare.length < 60 && PROD_LABEL.test(bare) && !/[.;]\s/.test(bare)) label = bare.replace(/:\s*$/, ''); // "1960 Broadway Show:"
    if (label !== null) {
      let cls = classifyLabel(cleanInline(expandTemplates(label)));
      // an italic line names a production venue or an act's setting (''Paris, 1927''), never a version by itself
      // (but ''From the 2015 Broadway Production'' does name a version)
      if (italicLabel && (cls.kind === 'prod' || cls.kind === 'stop') && !(cls.kind === 'prod' && PROD_WORD.test(cls.label))) cls = cls.kind === 'stop' ? { kind: 'none' } : { kind: 'other', label: cls.label };
      if (italicLabel && cls.kind === 'other' && /\b(?:1[89]|20)\d\d\b/.test(cls.label)) cls = { kind: 'none' };
      if (h && /\b(?:history|changes|differences|variations|notes)\b/i.test(cls.label || label)) { skip = true; skipLevel = level; continue; } // "History of revisions"
      if (cls.kind === 'act') {
        skip = false;
        const a = cls.act === 'prologue' ? 1 : cls.act;
        // the act structure starts again: a new production list ("; Chicago" / "; Act I" after the Broadway list)
        const pureAct = /^(?:act|part)\s+\S+$|^(?:first|second|third) act$|^prologue$/i.test(cleanInline(expandTemplates(label)).replace(/[:.]+$/, '').trim());
        if (typeof a === 'number' && pureAct && block.items.length && (a < block.maxAct || (a === 1 && block.maxAct === 1 && (act === null || pendingOther)))) newBlock(pendingOther ?? endLabel());
        pendingOther = null;
        if (cls.act === 'prologue') act = act ?? 1; else if (cls.act !== 'epilogue') act = cls.act;
        actSeq++;
        continue;
      }
      if (cls.kind === 'stop') { skip = true; skipLevel = h ? level : 99; noteBlock = /^(?:notes?|keys?|legend|notes on (?:the )?(?:songs|music)|song notes|footnotes)\b/i.test(cls.label ?? cleanInline(label)) ? block : null; continue; }
      if (cls.kind === 'prod') { skip = false; pendingOther = null; if (block.items.length || block.label) newBlock(cls.label); else block.label = cls.label; continue; }
      if (h && EXCLUDE_HEAD.test(cls.label || '')) { skip = true; skipLevel = level; continue; }
      if (cls.kind === 'other' && cls.label && cls.label.split(' ').length <= 6 && /^\p{Lu}/u.test(cls.label) && !/^(?:scene|sc\.)\b/i.test(cls.label)) pendingOther = cls.label;
      if (cls.kind === 'other' && cls.label && !/^(?:scene|sc\.)\b/i.test(cls.label)) softBreak(cls.label);
      continue;
    }
    if (skip) { if (noteBlock && !headingOf(raw) && raw.trim()) noteBlock.legendLines.push(raw); continue; }
    if (/^\s*\{\|/.test(raw)) {
      const e = tableEnd(lines, k);
      const used = tableItems(parseTable(lines.slice(k, e + 1)), ctx, block, () => act, (a) => { act = a; }, warn,
        (label) => { if (block.items.length || block.label) newBlock(label); else block.label = label; act = null; return block; });
      if (used) { k = e; pendingOther = null; continue; }
      // a layout table (columns of bullet lists): read the lines inside it as ordinary lines
      layoutDepth++; continue;
    }
    if (layoutDepth) {
      if (/^\s*\|\}/.test(raw)) { layoutDepth--; continue; }
      if (/^\s*\|-/.test(raw)) continue;
      const cell = raw.match(/^\s*[|!](?:[^|[\]{}]*\|(?!\|))?\s*(.*)$/);
      if (cell) { if (!cell[1].trim()) continue; lines[k] = cell[1]; k--; continue; } // re-read the cell content as a line
    }
    // ':"Song"' continuation lines under a header bullet are items too (Sondheim on Sondheim)
    const lm = raw.match(/^\s*([*#]+)\s*(.*)$/) || (/^\s*:+\s*"/.test(raw) ? raw.match(/^\s*(:+)\s*(.*)$/) : null);
    const itemText = lm && (lm[2].trim().length < 30 || /^\s*(?:'''|'')?act\s/i.test(lm[2])) ? cleanInline(expandTemplates(dropRefTemplates(lm[2]))).replace(/[:.]+$/, '') : '';
    // "* Act 1", "* Act One: London" (not "* Part I", and not "* Act Two Finale", a number)
    const itemAct = /^(?:act\s+(?:\d+|one|two|three|four|iv|i{1,3})|(?:first|second|third) act)(?:\s*[:(,–—-].*)?$/i.test(itemText) ? actOf(itemText) : null;
    if (itemAct) { // a bullet that is only "Act 1": an act label
      const a = itemAct === 'prologue' ? 1 : itemAct;
      if (itemAct === 'prologue' || itemAct === 'epilogue') { /* a number called "Prologue" */ } else {
        if (typeof a === 'number' && block.items.length && (a < block.maxAct || (a === 1 && block.maxAct === 1 && pendingOther))) newBlock(pendingOther ?? endLabel());
        pendingOther = null; act = a; actSeq++; continue;
      }
    }
    if (!lm || !lm[2].trim()) {
      // a note next to a list ("The 1972 version is the standard version licensed …")
      const note = cleanInline(expandTemplates(raw));
      // "As of the late 1990s the order of songs was changed … The current version is as follows:" introduces a list
      if (/:\s*$/.test(note) && note.length < 300 && /\b(?:current|licen[cs]ed|standard)\b[^:]*\b(?:version|production|list|order|score)\b/i.test(note)) {
        const lab = note.replace(/:\s*$/, '').split(/(?<=[.!?])\s+/).pop();
        if (block.items.length) newBlock(lab); else block.label = lab;
        pendingOther = null; continue;
      }
      if (LICENCE_NOTE.test(note)) { notes.push({ text: note, block }); block.notes.push(note); }
      if (note && !/^[{|!]/.test(raw.trim()) && /\p{L}/u.test(note)) softBreak(note);
      continue;
    }
    // "*: Lyrics: Kubota Youji, Composition: …" — a note line under the item above (Shock), not a number
    if (/^\s*[*#]+\s*:/.test(raw)) continue;
    const nextNested = (lines[k + 1] || '').match(/^\s*([*#]+)/);
    // a group header with nested children ("* "Parlor Sequence":") is not a song
    if (/:\s*$/.test(stripFormatting(lm[2]).trim()) && nextNested && nextNested[1].length > lm[1].length) continue;
    const item = parseItem(lm[2], ctx, warn);
    if (!item) {
      const note = cleanInline(expandTemplates(lm[2]));
      if (LICENCE_NOTE.test(note) && note.split(' ').length > 6) { notes.push({ text: note, block }); block.notes.push(note); }
      continue;
    }
    item.act = item.actHint ?? act; item.actSeq = actSeq;
    if (typeof item.act === 'number') block.maxAct = Math.max(block.maxAct, item.act);
    pushItem(block, item, ctx, warn);
    pendingOther = null;
  }
  blocks.splice(0, blocks.length, ...splitRepeatedLists(blocks));
  // licensing notes that name another list ("In the 1975 Original Broadway Production … removed from the licensable music")
  for (const n of notes) {
    const named = blocks.find((b) => b.label && b.label.length > 6 && n.text.toLowerCase().includes(b.label.toLowerCase()));
    if (named && named !== n.block) { n.block.notes = n.block.notes.filter((x) => x !== n.text); named.notes.push(n.text); }
  }
  for (const b of blocks) {
    // Side by Side by Sondheim: the text after the dash names each song's source show ("– ''Company''")
    const italic = b.items.filter((it) => it.italicTail);
    if (italic.length >= 3 && italic.filter((it) => it.italicWork).length >= italic.length * 0.3) {
      for (const it of italic) Object.assign(it, { singers: [], singersRaw: '', ensemble: false });
    }
    // translation glosses: "Marathon (Les Flamandes)", "Old Folks (Les Vieux)" (Jacques Brel: the French original after the
    // English title), "Quand on arrive en ville (When We Come to Town)", "Mangeons vite, buvons vite (Let us eat and drink
    // quickly)": when many items of a list carry one, they are glosses — dropped, and never read as singers
    const glossOf = (it) => {
      const m = it.title.match(/^(.*\S)\s*\(([^()]+)\)$/);
      if (!m || /\b(?:reprise|instrumental|part|version|act|finale|medley|cut|added|encore|dance|ballet)\b/i.test(m[2]) || ctx.matchCharacter(m[2].replace(/"/g, ''), true)) return false;
      const [out, inn] = [m[1], m[2]];
      const foreign = (x) => FOREIGN_WORD.test(x) || /[àâäçéèêëîïôöœùûüñß]/i.test(x);
      if (foreign(out) && ENGLISH_WORD.test(inn) && !foreign(inn)) return 'fwd'; // "Mangeons vite (Let us eat and drink quickly)"
      if (!foreign(out) && foreign(inn) && !ENGLISH_WORD.test(inn) && !/,|\band\b/.test(inn)) return 'rev'; // "Marathon (Les Flamandes)"
      return false;
    };
    const keep = (it) => { const inner = it.title.match(/\(([^()]+)\)$/)[1]; return /\b(?:reprise|instrumental|part|version|act|finale|medley|cut|added|encore|dance|ballet)\b|^\s*\d+\s*$|\bno\.?\s*\d/i.test(inner) || ctx.matchCharacter(inner.replace(/"/g, ''), true); };
    const withParen = b.items.filter((it) => /\([^()]+\)$/.test(it.title));
    // (a foreign title's English translation goes everywhere in the list; an English title's original goes only where it
    // would otherwise be read as the singers — Elisabeth's "The Cheerful Apocalypse (Die fröhliche Apokalypse) – Lucheni" keeps it)
    if (withParen.filter((it) => glossOf(it) === 'fwd').length >= Math.max(3, withParen.length * 0.4)) {
      for (const it of withParen) if (!keep(it)) it.title = it.title.replace(/\s*\([^()]+\)$/, '');
    }
    const bare = b.items.filter((it) => /\([^()]+\)$/.test(it.title) && !it.singersRaw);
    if (bare.filter((it) => glossOf(it) === 'rev').length >= Math.max(3, bare.length * 0.4)) {
      for (const it of bare) if (!keep(it)) it.title = it.title.replace(/\s*\([^()]+\)$/, '');
    }
    // list-level format: '* "Song" (Isabelle)' — no separator, singers in a trailing parenthetical
    const charParen = (it) => {
      const m = it.title.match(/\(([^()]*)\)$/);
      return m && m[1].split(/\s*(?:,|&|\band\b)\s*/).every((x) => ctx.matchCharacter(x.replace(/"/g, ''), true));
    };
    const cand = b.items.filter((it) => !it.singersRaw && looksLikeSingerParen(it.title) && (!it.parenLinked || charParen(it)) &&
      !/\((?:reprise|part|finale|prelude|instrumental|tag|encore|playoff|medley|opening|act|from|version|remix|reprise)/i.test(it.title));
    if (!parenCredits && b.items.length >= 3 && (cand.length >= b.items.length * 0.5 || cand.filter(charParen).length >= 2)) {
      for (const it of cand.filter((x) => cand.length >= b.items.length * 0.5 || charParen(x))) {
        const m = it.title.match(/^(.*?)\s*\(([^()]*)\)$/);
        const again = parseItem(`"${m[1]}" – ${m[2]}`, ctx, warn);
        if (again) Object.assign(it, { title: again.title, singers: again.singers, singersRaw: again.singersRaw, ensemble: again.ensemble, instrumental: again.instrumental, actors: again.actors });
      }
    }
    // a trailing credit / source-song parenthetical that isn't the singers goes: "Am I Blue? (Harry Akst, Grant Clarke)"
    // ("Note: composers in parentheses"), "Another World (Take A Chance On Me)" (links to the ABBA songs)
    const linkedParens = b.items.filter((it) => it.parenLinked && !it.singersRaw).length >= Math.max(3, b.items.length * 0.3);
    for (const it of b.items) {
      if (it.singersRaw || !/\([^()]+\)$/.test(it.title)) continue;
      if ((linkedParens && it.parenLinked) || (parenCredits && looksLikeSingerParen(it.title))) it.title = it.title.replace(/\s*\([^()]+\)$/, '');
    }
    // list-level "Aria: Glitter and Be Gay" / "Duet: Oh, Happy We" (Candide): the kind-of-number prefix goes
    const prefixed = b.items.filter((it) => FORM_PREFIX.test(it.title));
    if (prefixed.length >= 3 && prefixed.length >= b.items.length * 0.4) {
      for (const it of prefixed) it.title = it.title.match(FORM_PREFIX)[2].trim();
    }
    // "Temper, Temper (2004–2009)" was replaced by "Playing the Game (2009–present)": keep the current number
    if (b.items.some((it) => it.until === Infinity)) b.items = b.items.filter((it) => !(it.until && it.until !== Infinity));
    // operetta lists (Form – "first line" (Singers)): the other items are orchestral / dance numbers — except a finale,
    // which the company sings
    if (b.items.filter((it) => it.formQuoted).length >= Math.max(3, b.items.length * 0.5)) {
      for (const it of b.items) {
        if (it.formQuoted || it.quoted || it.singers.length || it.ensemble || it.singersRaw || it.reprise) continue;
        if (/^(?:(?:act\s+\S+\s+)?(?:grand\s+)?finale|finaletto)\b|\b(?:chorus|ensemble)\b/i.test(it.title)) it.ensemble = true; else it.instrumental = true;
      }
    }
    // no act headings, but "Act 1 finale" / "Act 2 finale" numbers (Blindekuh): the acts end there
    if (b.items.length >= 6 && b.items.every((it) => it.act == null)) {
      const ends = b.items.map((it) => actOf(`${it.form ?? ''} ${it.title}`.trim().replace(/^.*?\b(act\s+\S+)\s+finale.*$/i, '$1')));
      const marks = ends.map((a, i) => (typeof a === 'number' && /\bfinale\b/i.test(`${b.items[i].form ?? ''} ${b.items[i].title}`) ? a : null));
      if (marks.filter((a) => a != null).length >= 1 && marks.filter((a) => a != null).every((a, i, arr) => i === 0 || a > arr[i - 1])) {
        let cur = 1;
        b.items.forEach((it, i) => { it.act = cur; if (marks[i] != null) cur = marks[i] + 1; });
      }
    }
    // a revue's "Las Vegas (Joyce Jameson with Bert Convy and Ken Berry; …)": who performed it, not part of the title
    if (ctx.revue) {
      const person = /\p{Lu}[\p{L}'’-]+\s+\p{Lu}[\p{L}'’-]+/u;
      for (const it of b.items) {
        it.title = it.title.replace(/\s*\(([^()]*)\)$/, (m, x) => (person.test(x) && /\b(?:with|featuring|feat\.|and)\b|[,;&]/.test(x) && !/^(?:from|reprise)\b/i.test(x) ? '' : m));
      }
    }
    // a reprise of an instrumental number with nobody named is instrumental too ("Sparks (Reprise)")
    const instr = new Set(b.items.filter((it) => it.instrumental && !it.reprise).map((it) => norm(it.title)));
    for (const it of b.items) {
      if (it.reprise && !it.instrumental && !it.singers.length && !it.ensemble && !it.singersRaw && instr.has(norm(it.title))) it.instrumental = true;
    }
  }
  return blocks.filter((b) => b.items.length);
}

const TITLE_COL = /^(?:song|songs|title|song title|musical number|musical numbers|musical item|number|track|name|song name|music|piece|song\/number|song \(original artist\)|(?:song )?title (?:\+|and|&) performers?|first line(?: in english)?|english first line|(?:original|english|english-language|english version|english language|french|german|original french|original german|original language)\s+(?:version\s+)?(?:song\s+)?title|title \((?:original|english|french|german)\)|english translation|translation)$/;
// charts / discography tables are never song lists
const CHART_COL = /^(?:peak(?: chart)? positions?|chart|charts|certifications?|format|label|release|release date|year|sales|album details|us|uk|aus)$/;
const SINGER_COL = /^(?:performer\(s\)|performers?|performed by|singers?|sung by|character\(s\)|characters?|cast|vocals?|role\(s\)|roles?|singer\(s\))$/;
// columns that credit writers or cite sources, never the numbers' titles
const CREDIT_COL = /^(?:words|music|lyrics|book|composers?|lyricists?|writers?|written|arrange\w*|references?|refs?|notes?|sources?|scene|act|no\.?|nos?\.?|number|#|recording|page|length|duration|time|key|original (?:artists?|performers?))\b|\bby$/;
/**
 * The columns of a song table whose header names no title column (The Arcadians: " | | Words by | Music by", La Périchole:
 * no header) → { title, singer, form } column indexes (-1 = none), or null when no column reads like titles. The title column
 * is the leftmost one that is mostly filled and is not numbers, credits, singers or kinds of number ("Chœur", "Couplets");
 * a kind-of-number column names the numbers that have no title of their own ("Ouverture", "Marche indienne").
 */
function inferTableColumns(g, hdrRow, hdr, ctx) {
  const rows = g.filter((r) => r !== hdrRow && !r.fullWidth && !r.allHeader && r.cells.filter((c) => c && cleanInline(c.raw).trim()).length >= 2);
  if (rows.length < 3 || rows.some((r) => r.cells.some((c) => c && /\n\s*[*#]/.test(c.raw)))) return null; // (a layout table of bullet lists)
  const ncol = Math.max(...rows.map((r) => r.cells.length));
  const cols = [];
  for (let j = 0; j < ncol; j++) {
    const vals = rows.map((r) => (r.cells[j] && !r.cells[j].spanned ? cleanInline(expandTemplates(stripRefs(r.cells[j].raw))).trim() : '')).filter(Boolean);
    const share = (f) => (vals.length ? vals.filter(f).length / vals.length : 0);
    cols.push({
      j, filled: vals.length / rows.length, credit: CREDIT_COL.test(hdr[j] ?? ''),
      numeric: share((v) => /^(?:No\.?\s*)?\d{1,3}[a-z]?\.?$|^[IVXL]+\.?$/i.test(v)),
      prose: share((v) => (v.split(/\s+/).length >= 5 && /[.;]\s*$/.test(v) && !/"\s*[.;]?\s*$/.test(v)) || v.split(/\s+/).length >= 14),
      singer: share((v) => namedSingers(v, ctx) && !/[–—]|\s-\s|"/.test(v)),
      form: share((v) => v.split(/\s+/).length <= 5 && (Boolean(formLabel(v)) || FORM_FIRST.test(fold(v.split(/[\s,]+/)[0])) || /^(?:chansons?|complaintes?|sortie|entr[ée]e|marche|séguedille|seguidilla|ronde|finale?|ouverture|overture|entr'?acte)\b/i.test(v))),
    });
  }
  const title = cols.find((c) => !c.credit && c.filled >= 0.4 && c.numeric < 0.5 && c.singer < 0.5 && c.form < 0.5 && c.prose < 0.3);
  if (!title) return null;
  const singer = cols.find((c) => c.j > title.j && !c.credit && c.singer >= 0.5 && c.filled >= 0.3);
  const form = cols.find((c) => c.j < title.j && c.form >= 0.4);
  return { title: title.j, singer: singer?.j ?? -1, form: form?.j ?? -1 };
}

function tableItems(tbl, ctx, block, getAct, setAct, warn, blockFor = null) {
  const g = tbl.grid;
  if (g[0] && g[0].cells.every((c) => c && /^'''[^']+'''$/.test(c.raw.trim()))) g[0].allHeader = true;
  const hdrRow = g.find((r) => r.allHeader && !r.fullWidth);
  const hdr = (hdrRow?.cells || []).map((c) => (c ? cleanInline(stripRefs(expandTemplates(c.raw))).toLowerCase() : ''));
  const titleCols = hdr.map((h, i) => (TITLE_COL.test(h) ? i : -1)).filter((i) => i >= 0);
  // bilingual lists (Notre-Dame de Paris: "Original French Title" | "English Version Title"): the English title
  // (a "Number" column is the title only when there is no "Name"/"Title"/"Song" column: La Grande-Duchesse's "Number | Name | …")
  let titleCol = titleCols.find((i) => /english|translation/.test(hdr[i])) ?? titleCols.find((i) => !/^(?:number|track)$/.test(hdr[i])) ?? titleCols[0] ?? -1;
  let singCol = hdr.findIndex((h) => SINGER_COL.test(h));
  const actCol = hdr.findIndex((h) => /^act$/.test(h));
  let formCol = -1;
  if (hdr.filter((h) => CHART_COL.test(h)).length >= 2) return titleCol >= 0; // a discography table: consumed, not read
  // one column per version ("1858 version | 1874 version" in Orpheus in the Underworld, "English version (1931) | American
  // version (1936)"): each column is a production list of its own
  const versionCols = hdr.map((h, i) => (/\bversions?\b|\b(?:original|revised|revision)\b/.test(h) && !TITLE_COL.test(h) ? i : -1)).filter((i) => i >= 0);
  // (the columns hold the numbers themselves, not notes on how each production staged them — Anything Goes)
  const cellText = (c) => (c && !c.spanned ? cleanInline(expandTemplates(stripRefs(c.raw))).trim() : '');
  const versionVals = versionCols.flatMap((j) => g.filter((r) => r !== hdrRow && !r.fullWidth).map((r) => cellText(r.cells[j])).filter(Boolean));
  const versionProse = versionVals.filter((v) => v.split(/\s+/).length >= 6 && /[.;]\s*$/.test(v) && !/"\s*[.;]?\s*$/.test(v)).length;
  if (titleCol < 0 && versionCols.length >= 2 && blockFor && versionProse < versionVals.length * 0.3) {
    for (const j of versionCols) {
      const b = blockFor(cleanInline(stripRefs(expandTemplates(hdrRow.cells[j].raw))));
      for (const r of g) {
        if (r === hdrRow) continue;
        const c = r.cells[j];
        const txt = c && !c.spanned ? cleanInline(expandTemplates(stripRefs(c.raw))).trim() : '';
        const a = actOf(txt.replace(/:.*$/, ''));
        if (r.fullWidth || a) { const aa = actOf(cleanInline(expandTemplates(r.cells.find(Boolean)?.raw || '')).replace(/:.*$/, '')) ?? a; if (typeof aa === 'number') setAct(aa); continue; }
        if (!txt) continue;
        const item = parseItem(c.raw.replace(/<br\s*\/?>/gi, ' / ').replace(/\s*\n\s*/g, ' '), ctx, warn);
        if (item) { item.act = getAct(); pushItem(b, item, ctx, warn); if (typeof item.act === 'number') b.maxAct = Math.max(b.maxAct, item.act); }
      }
    }
    return true;
  }
  if (titleCol < 0) {
    const inf = inferTableColumns(g, hdrRow, hdr, ctx);
    if (!inf) return false;
    titleCol = inf.title; singCol = inf.singer; formCol = inf.form;
  } else block.titledTable = true; // (a "Musical item" column under a weak "Music" heading is a song list)
  for (const r of g) {
    if (r === hdrRow) continue;
    const cells = r.cells.filter(Boolean);
    const filled = cells.filter((c) => cleanInline(expandTemplates(stripRefs(c.raw))).trim());
    // an act row: a full-width label, the same text in every cell, or one filled cell ("| '''Act I'''", "| Act 1 || || ||")
    const oneAct = filled.length === 1 && actOf(cleanInline(expandTemplates(filled[0].raw)).trim().replace(/[:.]+$/, ''));
    if (r.fullWidth || (cells.length > 1 && cells.every((c) => c.raw === cells[0].raw)) || (r.allHeader && cells.length === 1) || oneAct) {
      const a = oneAct || actOf(cleanInline(expandTemplates(cells[0]?.raw || '')));
      if (a && a !== 'epilogue') setAct(a === 'prologue' ? 1 : a);
      continue;
    }
    if (r.allHeader) continue;
    let tc = r.cells[titleCol];
    // (a number with no title of its own is named by its kind: "Ouverture", "Marche indienne")
    if ((!tc || !cleanInline(tc.raw).trim()) && formCol >= 0 && r.cells[formCol]) tc = r.cells[formCol];
    if (!tc) continue;
    const sc = singCol >= 0 ? r.cells[singCol] : null;
    const title = tc.raw.replace(/<br\s*\/?>/gi, ' / ').replace(/\s*\n\s*/g, ' ');
    // names on separate lines of a cell are separate singers ("Dorothy\nChorus")
    // (a cell listing a medley's parts as bullets, '* "Part" – Singers': the singers of each part)
    const cellLines = sc ? sc.raw.split('\n') : [];
    const sung = !sc ? '' : cellLines.some((l) => /^\s*\*/.test(l))
      ? cellLines.filter((l) => /^\s*\*/.test(l)).map((l) => { const x = cleanInline(expandTemplates(l.replace(/^\s*\*+\s*/, ''))); const sp = findSeparator(x); return sp ? x.slice(sp.end).trim() : ''; }).filter(Boolean).join(', ')
      : sc.raw.replace(/<br\s*\/?>/gi, ', ').replace(/\s*\n\s*/g, ', ').trim();
    const item = parseItem(`${title}${sung ? ' – ' + sung : ''}`, ctx, warn);
    if (actCol >= 0 && r.cells[actCol]) { // an "Act" column (1, 2, "II")
      const v = cleanInline(expandTemplates(r.cells[actCol].raw)).trim();
      const a = /^\d$/.test(v) ? +v : actOf(`act ${v}`);
      if (typeof a === 'number') setAct(a);
    }
    if (item) { item.act = getAct(); pushItem(block, item, ctx, warn); }
  }
  return true;
}

/** Add a parsed item to a list — as several numbers when it names several ('"A", "B" and "C" from ''Show''', "A/B – X/Y"). */
function pushItem(block, item, ctx, warn) {
  if (!item.splitTitles) { block.items.push(item); return; }
  for (const t of item.splitTitles) block.items.push({ ...parseItem(t, ctx, warn) ?? { ...item, title: t }, act: item.act, actSeq: item.actSeq });
}

/** Score of a production list (higher wins; ties → first). */
export function scoreBlock(b) {
  const L = b.label || '';
  let sc = 0;
  if (/film|movie|soundtrack|screen/i.test(L)) sc -= 1000;
  if (/current|revised|revision|licen[cs]|definitive|final|standard|\bonwards\b|to (?:the )?present|\bsince\s+(?:1[89]|20)\d\d\b/i.test(L)) sc += 300; // (The Fix: "1998 onwards")
  if (/(?<!pre-|off-|off )\bbroadway\b/i.test(L)) sc += 100;
  if (/off-broadway|off broadway|workshop|tryout|pre-broadway|reading|out-of-town/i.test(L)) sc -= 50;
  // a recording's track list is not the show's list (Jekyll & Hyde "1994 Complete Works" concept album)
  if (/\b(?:concept|complete works|recording|album|cd|demo|studio|highlights|replacements?)\b/i.test(L)) sc -= 150;
  // "… featured a number of songs that were cut and reworked in future productions": an earlier version
  if (/\b(?:were|was|later|since been)\s+(?:cut|dropped|removed|replaced|reworked|rewritten)|\bearl(?:y|ier) (?:version|draft|production)s?\b/i.test(L)) sc -= 100;
  // the original list beats a revival's unless the revival is the current / licensed version (Grease)
  if (/\brevival\b/i.test(L) && !/current|licen[cs]|standard|revised/i.test(L)) sc -= 30;
  // a note next to the list: "The 1972 version is the standard version licensed to …" / "… were removed
  // from the licensable music" (Chicago 1975)
  for (const n of b.notes || []) {
    if (/\b(?:removed|cut|dropped|excluded|omitted|no longer)\b[^.]*\blicen[cs]|\bnot\b[^.]*\blicen[cs]/i.test(n)) sc -= 300;
    else if (n.length < 400 && /\b(?:is|are)\s+(?:now\s+)?(?:the\s+)?(?:standard|licen[cs]ed|official|current)\b[^.]*\b(?:version|licen[cs])/i.test(n)) sc += 300; // "The 1972 version is the standard version licensed …"
  }
  // (the singers a recording's list names are its performers, so they don't make it a better show list)
  const withS = recordingList(b) ? 0 : b.items.filter((i) => i.singers.length || i.ensemble || i.instrumental).length;
  sc += Math.round((withS / b.items.length) * 200) + Math.min(b.items.length, 40);
  return sc;
}
const recordingList = (b) => /\b(?:concept|complete works|recording|album|cd|demo|studio|highlights)\b/i.test(b.label || '');

// ---------- credits ----------
/** Surnames of the infobox music/lyrics/book writers (to drop "(Ashman/Rice)" credit notes). */
export function writerSurnamesOf(ib, fullNames) {
  const out = new Set();
  for (const k of ['music', 'lyrics', 'book', 'basis']) {
    if (!ib?.[k]) continue;
    plain(ib[k]).split(/\s*(?:,|\/|;|\band\b|&|\bwith\b|\bby\b)\s*/).forEach((n) => {
      const w = n.trim().split(' ');
      if (w.length >= 2) { out.add(norm(w[w.length - 1])); if (k !== 'basis') fullNames?.add(norm(n)); }
    });
  }
  return out;
}

// ---------- subpages ----------
/** Mode for a linked subpage title: 'songs' (Songs from …), 'album' (cast recording), or null (never follow). */
export function subpageMode(title) {
  if (/mixtape|tribute|compilation|\bfilm\b|movie|soundtrack|\bcovers?\b|\bremix/i.test(title)) return null;
  if (/^(?:songs from|list of songs (?:in|from)|list of musical numbers in)\b/i.test(title)) return 'songs';
  if (/cast recording|cast album|\((?:[^)]*\s)?album\)$|original (?:[a-z]+ )*cast\b/i.test(title)) return 'album';
  return null;
}

function subpageLinks(lines) {
  const out = [];
  mapTemplates(stripComments(lines.join('\n')), (name, params, raw) => {
    if (SUBPAGE_TEMPLATE.test(name)) {
      for (const p of params) {
        if (/=/.test(p)) continue;
        const t = p.replace(/#.*$/, '').replace(/_/g, ' ').trim();
        const mode = t && subpageMode(t);
        if (mode && !out.some((x) => x.title === t)) out.push({ title: t, mode });
      }
    }
    return raw;
  });
  return out;
}

// ---------- entry points ----------
function emptyResult(title) {
  return {
    title, isStageWork: true, infoboxType: null, rejectedReason: null, infobox: null, characters: [], section: null,
    productionList: null, lists: [], songs: [], subpages: [], singersSource: 'none', warnings: [],
  };
}

// a link to an article about a performer: "[[Queen (band)|Queen]]", "[[Jubilee Singers]]"
const PERFORMER_TARGET = /\((?:band|singer|musician|rapper|actor|actress|entertainer|comedian|group|duo|vocalist|performer|singer-songwriter)\)$|\bsingers$/i;
function buildContext(characters, actors, actorLinks, writerSurnames, showName, writers = new Set(), { publicDomain = false, aliases = {}, actorRoles = new Map() } = {}) {
  const matcher = createCharacterMatcher(characters.map((c) => ({ ...c, aliases: aliases[c.name] || [] })));
  const isActor = (tok, target) => {
    if (target && PERFORMER_TARGET.test(target)) return true;
    if (matcher.matchCharacter(tok)) return false;
    if (norm(tok) === showName) return false;
    return actors.has(norm(tok)) || writers.has(norm(tok)) || Boolean(target && actorLinks.has(norm(target)));
  };
  const compoundNames = [...characters.map((c) => c.name), ...Object.values(aliases).flat().map((a) => a.replace(/^=/, ''))].filter((n) => /\s(?:and|&)\s|\/|,/.test(n));
  // a performer the cast list names with their role ("[[Lee Kernaghan]] as the Balladeer") sings as that character
  const roleOfActor = (tok) => { const r = actorRoles.get(norm(tok)); return r ? matcher.matchCharacter(r, true) ?? r : null; };
  return { writerSurnames, matchCharacter: matcher.matchCharacter, setListTokens: matcher.setListTokens, expandGroup: matcher.expandGroup, isActor, roleOfActor, compoundNames, publicDomain, hasCharacters: characters.length > 0 };
}

/** Earliest year of the infobox premiere date and the "productions" list (film / recording lines ignored), or null. */
export function infoboxYear(ib) { return infoboxYears(ib).year; }

/**
 * Years of the infobox → { year, notFirst }: `year` = the earliest premiere / production (tryouts count; films, cast
 * albums, concept albums, workshops, readings and concerts don't; a private preview — "1985: 1st performance at
 * Sydmonton" — counts only when nothing else is listed: The Likes of Us); `notFirst` = years the productions list
 * gives only for a recording, a concept album or a private preview (Jesus Christ Superstar's 1970 concept album),
 * which other sources then shouldn't count as the first performance either.
 */
export function infoboxYears(ib) {
  const none = { year: null, notFirst: new Set() };
  if (!ib) return none;
  const now = new Date().getUTCFullYear();
  const ys = []; const priv = []; const notFirst = new Set(); const premiere = new Set();
  const yearsIn = (line) => [...line.matchAll(/(?<![\d/-])(1[6-9]\d\d|20\d\d)(?![\d])/g)].map((m) => +m[1]).filter((y) => y >= 1700 && y <= now + 3);
  for (const k of ['premiere_date', 'premiere', 'first_performance', 'productions']) {
    if (!ib[k]) continue;
    // {{Start date|1935|06|28}}, {{start date and age|df=yes|1986|10|9}} → the year; links → their labels
    const txt = plain(String(ib[k]).replace(/\{\{[^{}]*?\|\s*(1[6-9]\d\d|20\d\d)\s*(?:\|[^{}]*)?\}\}/g, ' $1 '));
    // (a {{ubl}}/{{plainlist}} comes out as "1962 Broadway, 1963 West End, 1966 Film": one production per year)
    for (const line of txt.split(/\s*(?:\/|\n|;|,(?=\s*(?:1[6-9]|20)\d\d\b))\s*/)) {
      if (k !== 'productions') { for (const y of yearsIn(line)) { ys.push(y); premiere.add(y); } continue; }
      if (/\b(?:film|movie|album|recording|concept|tv|television|radio)\b/i.test(line)) { yearsIn(line).forEach((y) => notFirst.add(y)); continue; }
      if (/\b(?:concert|workshop|reading|demo|lab)\b/i.test(line)) continue;
      if (/\b(?:private|preview|previews|sydmonton|showcase|backers)\b/i.test(line)) { priv.push(...yearsIn(line)); continue; }
      ys.push(...yearsIn(line));
    }
  }
  if (!ys.length) ys.push(...priv); else priv.forEach((y) => notFirst.add(y));
  for (const y of premiere) notFirst.delete(y);
  for (const y of ys) notFirst.delete(y);
  return ys.length ? { year: Math.min(...ys), notFirst } : { year: null, notFirst };
}

function songCandidates(ss, { album }) {
  const cands = [];
  ss.forEach((s, i) => {
    if (s.level < 2 || (EXCLUDE_HEAD.test(s.title) && !SONG_HEAD_WITH_RECORDINGS.test(s.title) && !(album && /^track ?listing$/i.test(s.title)))) return;
    const kind = songHeading(s.title);
    if (kind === 'strong' || (album && /^(?:track ?listing|tracks|songs|track list)$/i.test(s.title))) cands.push({ i, strong: true, otherLanguage: OTHER_LANGUAGE.test(s.title) });
    else if (kind === 'weak') cands.push({ i, strong: false });
  });
  // "==Original London Cast Recording==" laid out as the show's numbers by act (";Act I" … ";Act II"): the song list
  // when the article has no other (Whistle Down the Wind) — never a concept album or a film soundtrack
  ss.forEach((s, i) => {
    if (s.level < 2 || cands.some((c) => c.i === i) || !/\b(?:cast|original|london|broadway|west end)\b[^()]*\b(?:recording|album)\b/i.test(s.title) ||
        /concept|film|movie|soundtrack|studio|tribute/i.test(s.title)) return;
    const acts = sectionBody(ss, i).filter((l) => /^\s*(?:;|={2,}|''')\s*(?:act\s+(?:\d|[ivx]+|one|two|three)|(?:first|second) act)\b/i.test(l)).length;
    if (acts >= 2) cands.push({ i, strong: true, otherLanguage: false, recording: true });
  });
  const chosen = [];
  for (const c of cands) { // a matching heading nested inside a strong one is part of the parent's body
    const parent = chosen.find((p) => p.i < c.i && ss.slice(p.i + 1, c.i + 1).every((x) => x.level > ss[p.i].level));
    if (parent && parent.strong) continue;
    chosen.push(c);
  }
  // English lists before lists of other language versions (Abbacadabra: French/English/Dutch numbers)
  return [...chosen.filter((c) => c.strong && !c.otherLanguage && !c.recording), ...chosen.filter((c) => c.strong && c.otherLanguage),
    ...chosen.filter((c) => !c.strong), ...chosen.filter((c) => c.recording)];
}

/** Single-word singer tokens (folded) and multi-word names ("Charles Lee", "Mr. Darcy") of a list. */
function listTokensOf(lines) {
  const toks = new Set(); const names = new Set();
  for (const line of lines) {
    const sm = line.match(/\s[–—-]\s|"\s*[–—]\s*/);
    if (!sm) continue;
    plain(line.slice(sm.index + sm[0].length)).replace(/\([^()]*\)/g, ' ').split(/\s*(?:,|&|\band\b|\/)\s*/).forEach((t) => {
      const x = t.trim();
      if (/^[A-ZÀ-Ý][\wÀ-ÿ'.-]*$/.test(x)) toks.add(norm(x));
      else if (/^\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){1,3}$/u.test(x)) names.add(x);
    });
  }
  return { toks, names: [...names] };
}

function parseSongSections(ss, ctx, res, { album = false } = {}) {
  const warnSet = new Set(res.warnings); const warn = (w) => warnSet.add(w);
  const cands = songCandidates(ss, { album });
  // every candidate section is read (round 3): the song list comes from the first one, unless a later one sits under a
  // heading named after the show ("1996: ''By Jeeves''" — the article's first list is the 1975 "Jeeves"); the lists of the
  // other sections can still add numbers (addFromOtherLists)
  const secs = [];
  for (const c of cands) {
    const body = sectionBody(ss, c.i);
    const lt = listTokensOf(body);
    ctx.setListTokens(lt.toks, lt.names);
    // "VC (virtual community)" glossed once: "VC" is a group everywhere in the list
    ctx.groupAbbrevs = new Set([...plain(body.join('\n')).matchAll(/\b(\p{Lu}{2,5})\s*\(([^()]+)\)/gu)].filter((m) => isGroupName(m[2].replace(/^(?:the|a|an)\s+/i, ''))).map((m) => norm(m[1])));
    const secWarn = new Set();
    const blocks = extractBlocks(body, ctx, (w) => secWarn.add(w));
    const good = blocks.filter((b) => b.items.length >= 3);
    if (!good.length) continue;
    // a weak "Music" heading counts when most items name singers — or name the film/show each song comes from (a revue)
    if (!c.strong && !good.some((b) => b.titledTable) && good.every((b) => b.items.filter((x) => x.singersRaw).length < b.items.length / 2 && b.items.filter((x) => x.parenLinked === 'work').length < b.items.length / 2)) continue;
    const p = parentSection(ss, c.i);
    const parentTitle = p > 0 ? ss[p].title : '';
    const sig = good.map((b) => b.items.map((x) => x.title).join('|')).join('||');
    if (secs.some((x) => x.sig === sig)) continue; // (a weak "Music" heading around the "Musical numbers" list)
    secs.push({ c, body, good, parentTitle, secWarn, sig });
    if (album) break;
  }
  if (secs.length) {
    const showKey = norm(String(res.title ?? '').replace(/\s*\([^()]*\)$/, ''));
    const namesShow = (h) => Boolean(showKey) && norm(String(h).replace(/''+/g, '').replace(/\b(?:1[6-9]|20)\d\d\b/g, ' ')) === showKey;
    const mainSec = (x) => x.c.strong && !x.c.otherLanguage && !x.c.recording;
    const byTitle = secs.find((x) => mainSec(x) && namesShow(x.parentTitle));
    const sec = byTitle && !namesShow(secs[0].parentTitle) ? byTitle : secs[0];
    const { c, body, good } = sec;
    for (const w of sec.secWarn) warn(w);
    good.forEach((b) => { b.score = scoreBlock(b); });
    // a list labelled with the show's own title wins over lists of its earlier versions ("Road Show, 2008 Off-Broadway" over
    // "Bounce, 2003 …" and "Wise Guys, 1999 …")
    // (only where the other lists are named for other titles: "Bounce, 2003 …" — not Starlight Express's original list next
    // to its "Starlight Express (Wembley 2024)")
    const titled = good.filter((b) => showKey && norm(b.label ?? '').startsWith(showKey));
    const others = good.filter((b) => !titled.includes(b));
    if (titled.length && others.length && others.every((b) => b.label) && others.some((b) => /^\p{Lu}[\p{L}'’ ]{1,40},\s*(?:1[89]|20)\d\d\b/u.test(b.label))) titled.forEach((b) => { b.score += 250; });
    // a titles-only list never beats a list that names the singers, whatever its label says
    const named = (b) => !recordingList(b) && b.items.filter((i) => i.singers.length || i.ensemble).length >= b.items.length * 0.5;
    const pool = good.some(named) ? good.filter(named) : good;
    // an override names the list to use (overrides.json › preferList: Shrek's "US tour")
    const preferred = ctx.preferList ? good.find((b) => new RegExp(ctx.preferList, 'i').test(b.label || '')) : null;
    const best = preferred ?? pool.reduce((a, b) => (b.score > a.score ? b : a));
    res.section = ss[c.i].title; res.productionList = best.label ?? (secs.length > 1 && sec.parentTitle ? cleanInline(sec.parentTitle) : null);
    res.lists = secs.flatMap((x) => x.good.map((b) => ({ label: b.label ?? (secs.length > 1 && x.parentTitle ? cleanInline(x.parentTitle) : null), songs: b.items.length, score: scoreBlock(b), section: ss[x.c.i].title })));
    let actorToks = best.items.reduce((n, x) => n + x.actors.length, 0);
    const charToks = best.items.reduce((n, x) => n + x.singers.length, 0);
    // a revue without roles, or a list that says it gives the performers ("Songs are listed with performers in the original
    // Broadway version"): "singers" that are mostly full personal names are its performers (As Thousands Cheer, Your Arms
    // Too Short to Box with God) — not in a show that simply has no character list (A Time for Singing's "David Griffith")
    const performerNote = body.some((l) => !/^\s*[*#|!{]/.test(l) && /\b(?:with (?:the |their )?(?:original )?performers|performers (?:in|of|from) the original|(?:listed|given|shown) with (?:the )?(?:original )?(?:cast|performers))\b/i.test(l));
    if ((ctx.revue || performerNote) && !res.characters.length && charToks) {
      const personalName = (y) => /^\p{Lu}[\p{L}.'’-]+(?:\s+(?:\p{Lu}\.?|\p{Lu}[\p{L}'’-]+)){0,2}\s+\p{Lu}[\p{L}'’-]+(?:\s+(?:Jr\.?|Sr\.?|II|III))?$/u.test(y) &&
        !/^(?:the|a|an|les|la|le|el|los|las|mr|mrs|ms|miss|dr|sir|lady|lord|king|queen|prince|princess|young|old|little|mother|father|sister|brother|uncle|aunt|captain|general|count|countess|baron|duke|duchess|madame|monsieur)\b/i.test(y);
      const personal = best.items.reduce((n, x) => n + x.singers.filter(personalName).length, 0);
      if (personal >= charToks * 0.5) actorToks = Math.max(actorToks, charToks);
      else if (ctx.revue && personal) { // a revue's few named performers ("Monotonous – (Sung by Eartha Kitt)") are not roles either
        best.items.forEach((x) => { if (x.sungBy) x.singers = x.singers.filter((y) => !personalName(y)); });
        warn('some-actor-tokens-dropped');
      }
    }
    // numbers that only other production lists of the article have (Grease's revival lists: "Hopelessly Devoted to You")
    const added = album ? [] : addFromOtherLists(best, secs.flatMap((x) => x.good.map((b) => ({ b, parentTitle: secs.length > 1 ? x.parentTitle : '', otherLanguage: x.c.otherLanguage || x.c.recording }))), { revue: ctx.revue });
    const items = best.items.slice();
    for (const x of added) items.splice(items.indexOf(x.after) + 1, 0, x.item);
    // numbers the list's notes say productions add ("Many stage revivals have also included "I Have Confidence" and
    // "Something Good"" in The Sound of Music)
    const fromNotes = album ? [] : addFromNotes(best, items, ctx);
    for (const x of fromNotes) items.splice(x.after ? items.indexOf(x.after) + 1 : items.length, 0, x.item);
    res.addedFromOtherLists = [...added.map((x) => ({ title: x.item.title, list: x.from })), ...fromNotes.map((x) => ({ title: x.item.title, list: 'notes' }))];
    res.singersSource = 'characters';
    if (actorToks && (actorToks >= charToks || (res.characters.length === 0 && actorToks >= 2 && actorToks >= (actorToks + charToks) * 0.15))) {
      warn('singers-are-actors'); res.singersSource = 'actors-dropped';
      items.forEach((x) => { x.singers = []; });
    } else if (actorToks) warn('some-actor-tokens-dropped');
    if (album) {
      items.forEach((x) => { x.singers = []; x.singersRaw = ''; x.ensemble = false; });
      res.singersSource = 'none';
    }
    if (!items.some((x) => x.singers.length || x.ensemble)) res.singersSource = res.singersSource === 'actors-dropped' ? 'actors-dropped' : 'none';
    res.songs = finalizeSongs(items).map((x) => ({
      title: x.title, act: typeof x.act === 'number' ? x.act : null, position: x.position,
      singers: x.instrumental ? [] : x.singers, singersRaw: x.singersRaw, ensemble: x.instrumental ? false : x.ensemble,
      reprise: x.reprise, instrumental: x.instrumental,
    }));
  }
  if (!res.songs.length) {
    // no list in the article: look for a "Songs from …" / cast-album page linked from a song/music section
    const subs = [];
    ss.forEach((s, i) => {
      if (s.level < 2) return;
      const songish = songHeading(s.title) || /^(?:music|musical numbers|songs)\b/i.test(s.title);
      if (!songish || /recording|album|film|soundtrack/i.test(s.title)) return;
      for (const l of subpageLinks(sectionBody(ss, i))) if (!subs.some((x) => x.title === l.title)) subs.push(l);
      const p = parentSection(ss, i);
      if (p > 0 && /^(?:music|the music|score|musical numbers)$/i.test(ss[p].title)) {
        for (const l of subpageLinks(ss[p].lines)) if (!subs.some((x) => x.title === l.title)) subs.push(l);
      }
    });
    res.subpages = subs;
    if (!subs.length && !album) albumFallback(ss, ctx, res, warn);
  }
  res.warnings = [...warnSet].sort();
}

// ---------- numbers from other production lists ----------
// Lists never merged into the song list: films, recordings, workshops/readings/tryouts/concerts, cut-song lists, and a
// list whose songs a note says were removed from the licensed version (Chicago 1975)
const MERGE_SKIP = /film|movie|soundtrack|screen|\b(?:concept|complete works|recording|album|cd|demo|studio|highlights|workshop|reading|tryout|try-out|pre-broadway|out-of-town|concert|developmental|lab|cut|deleted|unused|replacements?|published|edition|vocal score)\b/i;
const LATER_WORD = /\b(?:revival|revised|revision|current|onwards|present|later|subsequent|new version|licen[cs])/i;
// two keys at most one letter apart (inserted, deleted or changed)
function oneLetterApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  const [x, y] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  return x.length === y.length ? x.slice(i + 1) === y.slice(i + 1) : x.slice(i) === y.slice(i + 1);
}
const labelYear = (l) => { const y = String(l || '').match(/\b(?:1[89]|20)\d\d\b/g); return y ? Math.min(...y.map(Number)) : null; };
const licensingNegative = (b) => (b.notes || []).some((n) => /\b(?:removed|cut|dropped|excluded|omitted|no longer)\b[^.]*\blicen[cs]|\bnot\b[^.]*\blicen[cs]/i.test(n));
// (a title with or without its subtitle is the same number: "Alma Mater (We Go Together)" = "Alma Mater")
// the keys a number is known by: the whole title, each part of a medley, the name before a colon ("Uranium Suite: Uranium /
// Minor Turn" is "The Uranium Suite")
const titleKeys = (t) => [...new Set([looseKey(t), ...t.split(/\s*\/\s*/).map(looseKey), looseKey(t.split(/\s*:\s*/)[0])])].filter(Boolean);
const looseKey = (t) => norm(String(t).replace(/\s*\([^()]*\)\s*/g, ' ').replace(/\s*#\s*\d+\s*$|\s+(?:no\.?\s*)?\d+\s*$|\s+(?:part|pt\.?)\s+\w+\s*$/i, '')).replace(/^the /, '');
/**
 * Numbers of the article's other production lists that the chosen list lacks — only from a later production (a revival, a
 * revised or current version: Grease's 1993–2022 revivals add "Hopelessly Devoted to You", "You're the One That I Want");
 * never from an earlier one (a number cut from the licensed version stays out: Shrek's "Donkey Pot Pie", Chicago 1975), never
 * in a revue (each production is its own selection). A list is used only when it shares at least 30% of its numbers with
 * the chosen one (so it is the same show in the same language). Each number goes after the number it follows in its own
 * list; reprises, instrumentals, generic numbers ("Finale") and curtain-call medleys ("Megamix") are not added.
 * → [{ item, after, from }] in insertion order (`after` is the item it follows in the chosen list, or undefined = first)
 */
export function addFromOtherLists(best, others, { revue = false } = {}) {
  if (revue) return [];
  const P = best; const pl = P.label ? P.label : '';
  const known = new Map(); // loose key → item of the result list
  // (a reprise is found among the reprises: "Look at Me, I'm Sandra Dee (Reprise)" anchors in Act 2, not at the Act 1 number)
  const keysOf = (it) => titleKeys(it.title).map((k) => (it.reprise ? `${k}|R` : k));
  for (const it of P.items) for (const k of keysOf(it)) if (!known.has(k)) known.set(k, it);
  const out = []; const order = P.items.slice();
  for (const o of others) {
    const B = o.b;
    if (B === P || o.otherLanguage) continue;
    const label = B.label ?? o.parentTitle ?? '';
    if (!label || MERGE_SKIP.test(label) || licensingNegative(B) || recordingList(B)) continue;
    const yb = labelYear(label); const yp = labelYear(pl);
    const later = yb && yp ? yb > yp : (LATER_WORD.test(label) && !LATER_WORD.test(pl));
    if (!later) continue;
    const base = B.items.filter((it) => !it.reprise);
    const shared = base.filter((it) => keysOf(it).some((k) => known.has(k))).length;
    if (!base.length || shared < base.length * 0.3 || shared < 2) continue;
    // a number B lists twice (Grease 1993: "Sandy" – Danny and Sandy, a prologue, then "Sandy" – Danny): the one with the
    // fewest singers is the number itself, the other a reprise of it
    const bNamed = B.items.filter((x) => x.singers.length || x.ensemble).length >= B.items.length * 0.5;
    const occ = new Map();
    for (const it of B.items) if (!it.reprise) { const k = looseKey(it.title); occ.set(k, [...(occ.get(k) ?? []), it]); }
    const knownAny = (it) => keysOf(it).some((k) => known.has(k) || known.has(k.replace(/\|R$/, '')));
    const main = new Set([...occ.values()].map((xs) => xs.reduce((a, b) => (b.singers.length < a.singers.length ? b : a))));
    let prev; // the last item of B found in the result list
    for (const it of B.items) {
      const hit = keysOf(it).map((k) => known.get(k)).find(Boolean);
      if (hit) { prev = hit; continue; }
      if (it.reprise || knownAny(it) || !main.has(it)) continue; // (a reprise of a number the list has: no anchor, not added)
      // (a list that names its singers: a number without any is music between scenes — "Earthquake Music", "Travel")
      if (bNamed && !it.singers.length && !it.ensemble) continue;
      // (a spelling variant or a longer name of a number the list has: "Three Little Lasdies" = "Three Little Ladies", "I Love A
      // Little Town" = "A Little Town")
      const within = (a, b) => a.split(' ').length >= 3 && ` ${b} `.includes(` ${a} `);
      if (keysOf(it).some((k) => k.length >= 8 && [...known.keys()].some((q) => q.length >= 8 && (oneLetterApart(q, k) || within(q, k) || within(k, q))))) continue;
      if (it.reprise || it.instrumental || GENERIC_TITLE.test(it.title) || /^(?:act\s+\S+\s+)?(?:finale|opening|prologue|epilogue|bows|curtain call|exit music|entr['’]?\s*acte|overture)\b/i.test(it.title) ||
          /\b(?:medley|megamix|mega-mix|mashup|bows|curtain call|play-?out|exit music|encore|reprise)\b/i.test(it.title)) continue;
      const item = { ...it, act: prev ? prev.act : it.act, addedFrom: label };
      out.push({ item, after: prev, from: label });
      order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, item);
      for (const k of keysOf(item)) if (!known.has(k)) known.set(k, item);
      prev = item;
    }
  }
  return out;
}

/**
 * Numbers named in the notes under a list as added to or substituted in productions: "† Sometimes replaced by "Something
 * Good"", "Many stage revivals have also included "I Have Confidence" and …" → [{ item, after }] (after = the list item that
 * carries the note's marker, else undefined = the end of the list). A note about a cut, dropped or film-only number adds nothing.
 */
export function addFromNotes(best, items, ctx) {
  const out = [];
  const known = new Set(items.flatMap((it) => titleKeys(it.title)));
  // (more than one production uses it: "Many stage revivals have also included …", "… the London and Broadway revivals",
  // "all productions onwards" — not one staging: "In the 2018 Seattle production, this song was replaced by …")
  const SEVERAL = /\b(?:(?:many|most|all|several|some|later|subsequent|current|recent)\s+(?:\w+\s+){0,2}(?:productions?|revivals?|versions?|stagings?|tours?)|\w+\s+(?:productions|revivals|stagings)|productions? onwards|licen[cs]ed version)\b/i;
  const ADDED = /\b(?:sometimes replaced by|replaced by|(?:also )?includ(?:ed|es|e)|added|interpolated|inserted|substituted by)\s+((?:"[^"]{2,80}"(?:\s*(?:,|and|&|or)\s*)*)+)/gi;
  const FEATURED = /"([^"]{2,80})"[^".]{0,80}?\b(?:is|are|was|were)\s+(?:also\s+)?(?:featured|included|used|sung|performed)\b/gi;
  for (const raw of best.legendLines || []) {
    const text = cleanInline(expandTemplates(stripRefs(raw.replace(/^\s*[*#:;]+\s*/, '')))).trim();
    const marker = raw.match(/^\s*[*#:;]*\s*([†‡§¶])/)?.[1];
    const after = marker ? items.filter((it) => (it.marks || []).includes(marker)).at(-1) : undefined;
    for (const sentence of text.split(/(?<=[.!?]|[.!?]["”])\s+(?=\p{Lu}|")/u)) {
      if (/\b(?:cut|dropped|removed|deleted|omitted|not included|film only|only in the film|never performed)\b/i.test(sentence)) continue;
      if (!(marker && after) && !SEVERAL.test(sentence)) continue;
      const titles = [
        ...[...sentence.matchAll(ADDED)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])),
        ...(SEVERAL.test(sentence) ? [...sentence.matchAll(FEATURED)].map((m) => m[1]) : []),
      ];
      for (const t of titles) {
        const title = t.trim().replace(/[,.;:]$/, '');
        if (!/^\p{Lu}/u.test(title) || title.split(/\s+/).length > 8 || known.has(looseKey(title))) continue;
        const item = parseItem(`"${title}"`, ctx);
        if (!item) continue;
        item.act = after ? after.act : null; item.addedFrom = 'notes';
        // ("† Sometimes replaced by "Something Good"": sung where the number it replaces is — by the same singers)
        if (after && /\breplaced by|\bsubstituted by/i.test(sentence)) Object.assign(item, { singers: after.singers, singersRaw: after.singersRaw, ensemble: after.ensemble });
        out.push({ item, after });
        known.add(looseKey(title));
      }
    }
  }
  return out;
}

// Last resort when the article has no song list and links no song-list page: the track listing of
// the show's cast recording in the article itself (titles only, like a linked cast-album page).
// Only "Track listing"/"Cast recording" sections, or {{Track listing}} templates inside "Recordings";
// never film soundtracks, never the bullet list of recordings itself.
const TRACK_HEAD = /^(?:track ?list(?:ing)?|tracks|tracklist|(?:the )?(?:original )?(?:[\p{L}-]+ )?(?:cast )?(?:album|recording)(?: track ?list(?:ing)?)?|musical ost|original (?:stage )?soundtrack|musical numbers ?\/ ?track ?list(?:ing)?)$/iu;
const BONUS = /\((?:[^()]*\b(?:bonus|demo|remix|radio edit|single version|karaoke|instrumental version|live version|acoustic)\b[^()]*)\)/i;
function albumFallback(ss, ctx, res, warn) {
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    if (s.level < 2 || /\bfilm\b|movie|tribute|mixtape|compilation|concept album/i.test(s.title)) continue;
    // (nor a "Track listing" under a film heading)
    let up = parentSection(ss, i); let under = false;
    for (; up > 0; up = parentSection(ss, up)) if (/\bfilm\b|movie|tribute|mixtape|compilation/i.test(ss[up].title)) under = true;
    if (under) continue;
    const bare = s.title.replace(/\s*\([^()]*\)\s*$/, '').replace(/\b(?:1[89]|20)\d\d\b/g, ' ').replace(/\s+/g, ' ').trim();
    const trackHead = TRACK_HEAD.test(bare);
    const recordings = /recording|album|discography/i.test(s.title);
    if (!trackHead && !recordings) continue;
    let body = sectionBody(ss, i);
    const explicit = /^(?:track ?list(?:ing)?|tracks|tracklist)$|track ?list/i.test(bare);
    if (!explicit) {
      // "Cast recording"/"Recordings": only {{Track listing}} templates, numbered lists and titled tables
      // (never plain bullet lists there — those are usually cast lists or lists of recordings)
      const keep = [];
      mapTemplates(stripComments(body.join('\n')), (name, params, raw) => { if (/^track ?listing$/.test(name)) keep.push(raw); return raw; });
      if (trackHead) {
        const bullets = body.filter((l) => /^\s*\*/.test(l));
        const numbered = bullets.filter((l) => /^\s*\*+\s*\d{1,2}[.)]\s/.test(l)).length >= Math.max(3, bullets.length * 0.7);
        for (let k = 0; k < body.length; k++) {
          if (/^\s*#/.test(body[k]) || (numbered && /^\s*\*/.test(body[k]))) keep.push(body[k]);
          else if (/^\s*\{\|/.test(body[k])) { const e = tableEnd(body, k); keep.push(...body.slice(k, e + 1)); k = e; }
        }
      }
      if (!keep.length) continue;
      body = keep.join('\n').split('\n');
    }
    ctx.setListTokens(new Set());
    ctx.album = true;
    let blocks;
    try { blocks = extractBlocks(body, ctx, warn).map((b) => ({ ...b, items: b.items.filter((x) => !BONUS.test(x.title)) })); } finally { ctx.album = false; }
    const showWords = res.title ? norm(res.title.replace(/\s*\(.*\)$/, '')) : '';
    const good = blocks.filter((b) => b.items.length >= 3 &&
      !(showWords && b.items.filter((x) => norm(x.title).includes(showWords)).length >= b.items.length / 2)); // a list of productions/albums, not songs
    if (!good.length) continue;
    const best = good[0];
    res.section = `${s.title} (track listing)`; res.productionList = best.label; res.singersSource = 'none';
    res.lists = good.map((b) => ({ label: b.label, songs: b.items.length, score: null }));
    best.items.forEach((x) => { x.singers = []; x.singersRaw = ''; x.ensemble = false; });
    res.songs = finalizeSongs(best.items).map((x) => ({
      title: x.title, act: typeof x.act === 'number' ? x.act : null, position: x.position,
      singers: [], singersRaw: '', ensemble: false, reprise: x.reprise, instrumental: x.instrumental,
    }));
    return;
  }
}

/**
 * Parse a musical's article.
 * @param {string} text wikitext
 * @param {{ title?: string, force?: boolean, lenient?: boolean, extraCharacters?: {name}[] }} opts
 *   force: skip the "is this a stage work?" gate; lenient: only reject clearly different subjects
 *   (person, film, TV …), not album/book infoboxes; extraCharacters: used when the article has none
 *   (e.g. Wikidata characters) for singer canonicalisation and output.
 */
export function parseArticle(text, { title = '', force = false, lenient = false, extraCharacters = [], year, kind, preferList = null } = {}) {
  const res = emptyResult(title);
  const t0 = stripComments(text);
  const first = firstInfobox(t0);
  const ib = stageInfobox(t0);
  res.infoboxType = first?.type ?? null;
  res.infobox = ib;
  if (!ib && first && (lenient ? REJECT_INFOBOX_LENIENT : REJECT_INFOBOX).test(first.type)) {
    res.isStageWork = false; res.rejectedReason = `infobox ${first.type}`;
    if (!force) return res;
  }
  if (/^\s*#redirect\b/i.test(t0)) { res.isStageWork = false; res.rejectedReason = 'redirect'; return res; }
  // a circus / ice / magic show in a stage-production infobox ("Love", Cirque du Soleil: genre "Contemporary circus")
  const ibGenre = plain(ib?.genre ?? '');
  const shortDesc = t0.match(/\{\{\s*short description\s*\|\s*([^}|]*)/i)?.[1] ?? '';
  if (ib && /circus|acrobat|ice[ -]?(?:show|skating)|magic show|aerial/i.test(ibGenre) && !/musical|opera|revue/i.test(ibGenre + ' ' + shortDesc)) { // (not "Paramour", a "Cirque du Soleil musical")
    res.isStageWork = false; res.rejectedReason = `genre ${ibGenre}`;
    if (!force) return res;
  }
  const ss = sections(t0);
  const parsed = parseCharacters(ss, t0, { revue: kind === 'revue' });
  let characters = parsed.characters;
  if (!characters.length && extraCharacters.length) characters = extraCharacters.map((c) => ({ name: c.name, voiceType: c.voiceType ?? null }));
  res.characters = characters;
  const showName = norm((ib?.name ? plain(ib.name) : title).replace(/\s*\(.*\)$/, ''));
  const writers = new Set();
  // first lines of lyrics may stand for a number's title only in public-domain works (first performed before 1930)
  const y = year === undefined ? infoboxYear(ib) : year;
  const ctx = buildContext(characters, parsed.actors, parsed.actorLinks, writerSurnamesOf(ib, writers), showName, writers, { publicDomain: y != null && y < 1930, aliases: parsed.aliases, actorRoles: parsed.actorRoles });
  ctx.revue = kind === 'revue';
  ctx.preferList = preferList;
  res._ctx = ctx;
  parseSongSections(ss, ctx, res);
  return res;
}

/**
 * Parse a linked subpage ("Songs from Les Misérables", a cast-recording article) for a show whose
 * article has no list. Characters/actors come from the parent article.
 * mode 'album' keeps titles only (album credit columns list performers, not characters).
 */
export function parseSubpage(text, parent, { title = '', mode = 'songs' } = {}) {
  const res = emptyResult(title);
  const t0 = stripComments(text);
  const ss = sections(t0);
  res.characters = parent.characters;
  const ctx = parent._ctx ?? buildContext(parent.characters, new Set(), new Set(), new Set(), norm(parent.title));
  parseSongSections(ss, ctx, res, { album: mode === 'album' });
  if (mode === 'album' && !res.songs.length) {
    // album with a bare {{Track listing}} outside any matching section
    const fake = [{ level: 1, title: '(lead)', lines: [] }, { level: 2, title: 'Track listing', lines: t0.split('\n') }];
    parseSongSections(fake, ctx, res, { album: true });
  }
  res.subpages = [];
  return res;
}
