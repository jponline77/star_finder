// Characters / roles of a musical from its English Wikipedia article (names + stated voice types),
// the actor names the article mentions (so actors listed as "singers" can be recognised), and the
// matcher that canonicalises singer tokens ("Valjean" → "Jean Valjean"). Pure functions.
import { parseTable, sectionBody, stripComments, stripRefs, expandTemplates, tableEnd, headingOf } from './wikitext.js';
import { cleanInline, norm, stripMarkers, isGroupName } from './normalize.js';

export const CHAR_HEAD = /^(?:characters?|roles?|(?:principal|main|major|leading|central|secondary|supporting|minor|other) (?:roles|characters|casts?)(?:,? (?:original |principal )?casts?| and .+)?|character list(?: and .+)?|characters? and descriptions?|(?:characters|roles) and .+|.+ and (?:characters|roles)|casts?|original casts?|notable casts?|stage casts?|casts of .+|.*production casts?|principal roles and .+|dramatis personae|secondary characters|supporting characters|minor characters|other characters|character list|characters and casts?|cast and characters|roles and casts?|original .*casts?|principal cast|cast list|cast members|roles and (?:original )?casts?|historical casts?|historical casting|casting history|casting|(?:(?:original|opening|first|world premiere|premiere)\s+)?(?:broadway|off-broadway|west end|london|new york|us|uk|touring|tour|chicago|australian)\s+casts?)$/i;
const LATE_CAST_HEAD = /^(?:historical casts?|historical casting|casting history|casting|(?:(?:original|opening|first|world premiere|premiere)\s+)?(?:broadway|off-broadway|west end|london|new york|us|uk|touring|tour|chicago|australian)\s+casts?)$/i;
const CHAR_HEAD_SKIP = /recording|album|replacement|film|\btv\b|television|award|nominat|crew|creative/i;
const SUBHEAD_SKIP = /members|replacement|performers|understud|swing|notable|standby|alumni|awards?|recording|album|film|crew|creative/i;
const NAME_PART = /^(?:the\s+)?[\p{Lu}\p{N}][\p{L}\p{N}.'’-]*(?:\s+(?:(?:of|the|de|la|le|von|van|du|des)\s+)*[\p{Lu}\p{N}"#][\p{L}\p{N}.'’"#-]*){0,4}$/u;
const NAME_START = /^[\p{Lu}\p{Lo}0-9"'¡¿]/u;
const VOICE_RE = /^(?:soprano|mezzo-soprano|mezzo|alto|contralto|tenor|baritenor|baritone|bass-baritone|bass|countertenor|treble|boy soprano|boy alto|belt|mezzo-belt|soprano belt|high baritone|lyric baritone|lyric soprano|lyric tenor)$/i;
// longest forms first ("mezzo-soprano" before "soprano", "bass-baritone" before "bass"); a voice word is never the
// second half of a hyphenated word (the lookbehind), so "(mezzo-soprano)" is a mezzo, not a soprano
const VOICE_WORD = String.raw`(?<![\p{L}-])(?:boy soprano|boy alto|bari-?tenor|mezzo-soprano|mezzo soprano|soprano|contralto|alto|baritenor|bass-baritone|baritone|countertenor|tenor|bass(?! guitar| player)|treble)(?![\p{L}-])`;
const VOICE_WORD_LC = String.raw`(?:boy soprano|mezzo-soprano|soprano|contralto|alto|baritenor|bass-baritone|baritone|countertenor|tenor|bass|treble)`;
const VOICE_LINK_AT_END = /\[\[\s*(boy soprano|soprano|mezzo-soprano|alto|contralto|tenor|baritone|bass-baritone|bass|baritenor|countertenor|treble)\s*(?:\([^)]*\))?\s*(?:\|[^\]]*)?\]\]\s*\.?\s*$/i;
const NOT_A_NAME = /^(?:character|characters|role|roles|replacement|replacements|notable replacements|understudy|understudies|swing|swings|ensemble|description|voice type|voice|vocal range|n\/a|—|-|tba|tbd|name|part|actor|actress|performer|notes?|title|position|others?|various|tbc)$/i;
const PRODUCTION_WORD = /\b(?:broadway|west end|revivals?|tours?|productions?|london|cast|premiere|workshop|concerts?|off-broadway)\b/i;
// rows of a creative-team table and cast-change labels are not roles
const CREW_OR_COVER = /^(?:alternates?|understud(?:y|ies)|standbys?|swings?|covers?|u\/s|replacements?|transfers?|dance captain|stage manager|lights|lighting|choreography|costumes?|hair|make-?up|set(?: and .+)?|stage carpenter|props?|wardrobe|musical staging|(?:principals|supporting roles?|other \S+|minor roles?|featured roles?|ensemble roles?)$)\b|^(?:(?:associate |assistant |resident )?(?:director|choreographer|musical director|music director|musical supervisor|music supervisor|conductor|producer|orchestrations?|orchestrator|arranger|dance arrangements?|vocal arrangements?)|(?:scenic|set|costume|lighting|sound|hair|wig|make-?up|mask|puppet|projection|video) design(?:er)?|book|music|lyrics|music and lyrics|casting)$|\b(?:alternate|understudy|u\/s|standby|cover)$/i;

/** Title-case a voice type ("mezzo-soprano" → "Mezzo-soprano"). */
export const voiceCase = (v) => {
  const x = v.toLowerCase().replace(/\s+/g, ' ').replace(/^mezzo$|^mezzo soprano$/, 'mezzo-soprano').replace(/^bari-tenor$/, 'baritenor');
  return x[0].toUpperCase() + x.slice(1);
};
/**
 * A voice type stated in a character line: "Frederic, the Pirate Apprentice ([[tenor]])", "'''vocal range:'''
 * [[soprano]]", "Voice type: [[Tenor]]", "Arnolphe - Lew Parker - Baritone" → "Tenor" / … or null.
 */
export function voiceIn(raw) {
  const t = cleanInline(expandTemplates(stripRefs(String(raw)))).replace(/\s+/g, ' ');
  // "(tenor)", "([[mezzo-soprano]])", "(lyric baritone)", "vocal range: soprano", "Arnolphe - Lew Parker - Baritone",
  // "Tommy, age 16–25, A young pinball genius. [[Tenor]]." / "… Rock [[Mezzo-soprano]]"
  const re = new RegExp(`^\\p{Lu}\\S*(?:\\s+\\p{Lu}\\S*){0,3}\\s+(${VOICE_WORD_LC})\\s*$|\\((${VOICE_WORD})\\s+or\\s+[^()]*\\)|\\((?:[^()]*?[\\s,;/])??(${VOICE_WORD})\\)|(?:vocal range|voice type|voice part|voice|range|vocal type)\\s*:\\s*(${VOICE_WORD})|\\s[–—-]\\s(?:comic |lyric |high |low |light |dramatic )?(${VOICE_WORD})\\s*$|(?:^|[.,;]\\s+)(?:(?:pop|rock|legit|lyric|comic|high|low|light|dramatic|belt|character)\\s+)?(${VOICE_WORD})\\s*\\.?\\s*$`, 'iu');
  const m = t.match(re);
  const v = m ? (m[1] || m[2] || m[3] || m[4] || m[5] || m[6]) : null; // ("(mezzo-soprano or soprano)": the first one; "Nini soprano")
  return v ? voiceCase(/^(?:boy |mezzo )/i.test(v) && !/mezzo soprano/i.test(v) ? v : v.replace(/\s+/, '-')) : null;
}

const PARTICLE = /^(?:of|the|de|la|le|von|van|du|des|y|and|zu|da|di|del|der|den|el|al|bin|ibn|st\.?)$/;
const hasOrdinaryWord = (t) => t.split(/\s+/).some((w) => /^\p{Ll}/u.test(w) && !PARTICLE.test(w));

// occupational / relational nouns that end a descriptive appositive: "Harold Bride, Radioman", "Hadji Tanton, Private Secretary"
const DESCRIPTOR_NOUN = /^(?:secretary|advocate|steward|stewardess|radioman|lookout|stoker|quartermaster|officer|engineer|maid|servant|daughter|son|wife|husband|widow|mother|father|sister|brother|niece|nephew|cousin|aunt|uncle|friend|lover|fiancée?|owner|proprietor|keeper|manager|clerk|assistant|nurse|doctor|lawyer|attorney|teacher|tutor|student|pupil|soldier|sailor|captain|colonel|sergeant|lieutenant|corporal|private|judge|detective|inspector|constable|policeman|reporter|journalist|photographer|landlord|landlady|innkeeper|bartender|barman|barmaid|waiter|waitress|butler|valet|footman|housekeeper|cook|chef|gardener|governess|nanny|chauffeur|driver|pilot|guard|jailer|gaoler|warden|priest|pastor|vicar|abbess|nun|monk|chaplain|merchant|peddler|pedlar|shopkeeper|salesman|saleswoman|farmer|shepherd|shepherdess|fisherman|miner|agent|spy|thief|smuggler|pirate|bandit|gambler|dancer|singer|actor|actress|star|diva|impresario|producer|director|conductor|composer|writer|poet|painter|artist|model|heiress|heir|orphan|foundling|ward|companion|confidant|confidante|chaperone|chaperon|matron|patron|protégée?|apprentice|page|squire|herald|courtier|attendant|messenger|bellboy|bellhop|porter|operator|mechanic|scientist|professor|dean|principal|headmaster|headmistress|mayor|governor|senator|ambassador|consul|minister|chancellor|treasurer|banker|millionaire|tycoon|mogul|magnate)$/i;
const ALL_CAPS = /^[^\p{Ll}]*\p{Lu}[^\p{Ll}]*\p{Lu}[^\p{Ll}]*$/u;
const titleCase = (x) => x.toLowerCase().replace(/(^|[\s"'(\-/.])(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());

function cleanName(s, actorsOut, aliasOut, { parenAlias = false } = {}) {
  // Ruddigore: "Richard Dauntless ''His Foster-Brother – A Man-o'-war's-man'' ([[tenor]])", "Sir Ruthven Murgatroyd ''Disguised as
  // Robin Oakapple, a Young Farmer''": an italic description after the name (a disguise names an alias)
  const itd = String(s).match(/^([^'\n]*?[^\s',])\s*,?\s*''(?!')((?:(?!'').)+)''(?=\s*(?:\(|<|$))/);
  if (itd && /\p{L}/u.test(itd[1]) && !/\[\[[^\]]*$/.test(itd[1])) {
    const al = cleanInline(itd[2]).match(/^(?:disguised as|posing as|in disguise as|alias|a\.?k\.?a\.?|also known as)\s+(?:the\s+)?([^,;]+)/i);
    if (al) aliasOut?.push(al[1].trim());
    s = itd[1] + String(s).slice(itd[0].length);
  }
  let x = cleanInline(expandTemplates(stripRefs(String(s).split(/<hr\s*\/?>/i)[0])), null).replace(/\s*(?:&|and)\s+others$/i, '');
  x = stripMarkers(x);
  x = x.replace(/\s*(?:vocal range|voice type|voice part|vocal type|singing voice|voice)\s*:.*$/i, ''); // Jekyll & Hyde: "… vocal range: baritone/tenor"
  if (new RegExp(String.raw`^\p{Lu}\S*(?:\s+\p{Lu}\S*){0,3}\s+(?:${VOICE_WORD})$`, 'u').test(x) && new RegExp(String.raw`(?:\[\[[^\]]*\]\]|\s(?:${VOICE_WORD_LC}))\s*$`, 'u').test(String(s).replace(/<[^>]*>|\{\{[^}]*\}\}/g, '').trim())) {
    x = x.replace(new RegExp(String.raw`\s+(?:${VOICE_WORD})$`, 'iu'), ''); // (not "Italian Tenor", a role)
  }
  x = x.replace(/,?\s*\bage[sd]?\s*:?\s*\d{1,2}(?:\s*(?:[–—-]|to)\s*\d{1,2})?\+?(?=[\s,.:;]|$)/i, ''); // "Captain Walker age: 25–35", "Tommy, age 16–25"
  // "Mary Elizabeth Mastrantonio ..... Dora Spenlow" (actor ..... role)
  const dots = x.match(/^(.+?)\s*(?:\.{3,}|…+)\s*(.+)$/);
  if (dots) { actorsOut?.push(dots[1]); x = dots[2]; }
  // "Jonathan Biggins as Sir Joseph Banks" (actor as role)
  const as = x.match(/^(\p{Lu}[\p{L}.'-]+(?:\s+\p{Lu}[\p{L}.'-]+){1,3})\s+as\s+"?(\p{Lu}[^"]*)"?$/u);
  if (as) { actorsOut?.push(as[1]); x = as[2]; }
  // "Frank Butler—the Wild West show's star", "Annabelle Gray– Cousin to the Woodlawns", "Carrie the Luggage Car- A peppy …"
  const dash = x.match(/^(.+?)\s*(?:—|[–—]\s+|\s[–-]\s|\s--\s|(?<=\p{L})-\s+(?=\p{Lu}))(.+)$/u);
  // (also "Wildcat Jackson—Lucille Ball": a performer's name glued to the role with an em dash)
  const gluedActor = dash && /^\p{Lu}[\p{L}'’.-]*(?:\s+(?:\p{Lu}[\p{L}'’.-]*|\p{Lu}\.)){1,3}$/u.test(dash[2].trim()) && !/^(?:the|mr|mrs|ms|miss|dr|sir|lady|lord)\b/i.test(dash[2]);
  if (dash && (hasOrdinaryWord(dash[2]) || /^\s/.test(x.slice(dash[1].length)) || /-\s/.test(x.slice(dash[1].length, dash[1].length + 3)) || gluedActor)) {
    if (gluedActor) actorsOut?.push(dash[2].trim());
    x = dash[1];
  }
  // "Inez Alvarez (Mamita)" in a character table: the name the role goes by in the song list (in a bullet list the name in
  // brackets is as often the role an actor plays: "Joseph Spiotta (Benny Lomansky)")
  const nick = parenAlias && x.match(/^(\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){1,3})\s*\((\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?)\)\s*$/u);
  if (nick && !new RegExp(String.raw`^(?:${VOICE_WORD})$`, 'iu').test(nick[2]) && !/^(?:Speaking|Silent|Non-singing|Dancer|Adult|Child|Young|Old)$/i.test(nick[2]) && !isGroupName(nick[2])) aliasOut?.push(nick[2]);
  x = x.replace(/[\s:,–—-]+$/, '').replace(/\s*\((?:[^()]*)\)\s*$/, '').replace(/[:,–—-]+$/, '').replace(/\s+(?:and|or|&)$/i, '').trim();
  // "Death, posing as Prince Nikolai Sirki": the name the role goes by is an alias
  const alias = x.match(/^(.+?),?\s+(?:posing as|disguised as|in disguise as|masquerading as|alias|a\.?k\.?a\.?|also known as|known as|later known as)\s+(?:the\s+)?(\p{Lu}.*)$/iu);
  if (alias) { aliasOut?.push(alias[2].replace(/[\s,;:.]+$/, '')); x = alias[1].trim(); }
  // "Laura Nowalska, Palmatica's daughter" (an appositive with ordinary words), "Ki-Ram, The Sultan of Sulu", "Henry Etches,
  // 1st Class Steward", "Hadji Tanton, Private Secretary" → the name (but "Raoul, Vicomte de Chagny" is one role)
  const masked = x.replace(/\([^()]*\)/g, (m) => m.replace(/,/g, '\u0001'));
  const comma = masked.match(/^([^,]+),\s+(.+)$/)?.map((y) => y.replace(/\u0001/g, ','));
  const single = comma && !/,/.test(comma[2].replace(/\([^()]*\)/g, '')); // one appositive, not a list of roles
  if (comma && (hasOrdinaryWord(comma[2]) || (single && (/^(?:the|a|an|his|her|their)\s/i.test(comma[2]) || /\d/.test(comma[2]) ||
      (/^(?:\p{Lu}[\p{L}'’-]*\s+){1,3}(?:of|to|for)\s+(?:the\s+)?\p{Lu}/u.test(comma[2]) && !(/^(?:king|queen|emperor|empress|tsar|czar|pharaoh|sultan)\s/i.test(comma[2]) && !/\s/.test(comma[1].trim()))) || // "Ex-King of the Emerald City" (not "Mary, Queen of Scots")
      /\p{L}['’]s\s/u.test(comma[2]) || // "Dorothy's Cow"
      /^(?:poet laureate|laureate)$/i.test(comma[2]) ||
      DESCRIPTOR_NOUN.test(comma[2].split(/\s+/).pop().replace(/[^\p{L}é]/gu, '')))))) {
    // the full form, as lists may write it ("His Most Royal Majesty, The King of France") — matched only in full ("=")
    if (single && !hasOrdinaryWord(comma[2]) && x.length <= 60 && comma[2].split(/\s+/).length <= 6 && !/[.:;!?]/.test(comma[2])) aliasOut?.push(`=${x}`);
    x = comma[1].trim().replace(/\s*\((?:[^()]*)\)\s*$/, '');
  }
  return x.replace(/[\s,;:]+$/, '').replace(/(?<=\p{Ll}{3})\.$/u, '').replace(/^(Mr|Mrs|Ms|Miss|Dr)\.\.?(?=\s)/, (m, h) => (h === 'Miss' ? 'Miss' : `${h}.`)); // ("The Plumed Knights.")
}

function voiceFromCell(raw) {
  const links = [];
  const txt = cleanInline(expandTemplates(stripRefs(raw)), links);
  // the first voice type written in the cell, whole: "[[Bass (voice type)|bass]]-[[baritone]]" is a bass-baritone
  const first = txt.match(new RegExp(VOICE_WORD, 'iu'))?.[0];
  if (first) return voiceCase(/^(?:boy |mezzo )/i.test(first) && !/mezzo soprano/i.test(first) ? first : first.replace(/\s+/, '-').replace(/^bari-tenor$/i, 'baritenor'));
  const v = links.map((l) => l.label).find((x) => VOICE_RE.test(x)) ||
    txt.split(/[\s(,/;]+/).find((x) => VOICE_RE.test(x)) ||
    txt.match(/^(mezzo-soprano|soprano|alto|contralto|tenor|baritone|bass-baritone|bass|baritenor|countertenor)/i)?.[1];
  return v ? voiceCase(v) : null;
}

/** "Mr. and Mrs. Jefferson" → ["Mr. Jefferson", "Mrs. Jefferson"]; "Sisters Berthe, Margaretta and Sophia" → three sisters. */
function splitCompound(name) {
  const hc = name.match(/^(Mr|Mrs|Ms|Miss|Dr|Lord|Lady|Sir|King|Queen)\.?\s+(?:and|&)\s+(Mr|Mrs|Ms|Miss|Dr|Lord|Lady|King|Queen)\.?\s+(\p{Lu}.*)$/u);
  if (hc) return [hc[1], hc[2]].map((h) => `${h}${/^(?:Mr|Mrs|Ms|Dr)$/.test(h) ? '.' : ''} ${hc[3]}`);
  const pl = name.match(/^(Sisters|Brothers|Misses|Messrs\.?|Aunts|Uncles|Drs\.?)\s+(\p{Lu}.*)$/u);
  if (pl) {
    const one = { sisters: 'Sister', brothers: 'Brother', misses: 'Miss', 'messrs.': 'Mr.', messrs: 'Mr.', aunts: 'Aunt', uncles: 'Uncle', 'drs.': 'Dr.', drs: 'Dr.' }[pl[1].toLowerCase()];
    return pl[2].split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).filter(Boolean).map((n) => `${one} ${n.trim()}`);
  }
  // "Coricopat and Tantomile": two single-word names
  const two = name.match(/^(\p{Lu}[\p{L}'’-]+)\s+(?:and|&)\s+(\p{Lu}[\p{L}'’-]+)$/u);
  if (two) return [two[1], two[2]];
  return [name];
}

// "[[Maurice Lauchner]] as Stewart Peterson", "Ellie Cox/Alice Boagey as Princess Diana": actor(s), then the role
const ACTOR_NAME_SRC = String.raw`(?:\[\[[^\]]+\]\]|\p{Lu}[\p{L}.'-]+(?:\s+\p{Lu}[\p{L}.'-]*){1,2})`;
const ACTORS_SRC = String.raw`${ACTOR_NAME_SRC}(?:\s*(?:\/|&|\band\b)\s*${ACTOR_NAME_SRC})*`;
const AS_ROLE = new RegExp(String.raw`^\s*(${ACTORS_SRC})\s+(?:(?:starred|starring|appeared|was cast|is cast|plays|played)\s+)?as\s+((?:the\s+)?(?:(?:de|da|di|du|van|von|der|del|la|le|ben|al|el)\s+)?\p{Lu}.*)$`, 'u');

/** A dashed cast line "Role – [[Actor]]" / "Actor – Role, Role" / "Role—[[Actor]]" / "Role ... Actor" → [left, right] (raw), or null. */
export function pairOf(item) {
  const t = String(item).replace(/&ndash;|&#8211;/g, '–').replace(/&mdash;|&#8212;/g, '—').replace(/&nbsp;|&#160;/g, ' ');
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const two = t.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; i++; continue; }
    if ((two === ']]' || two === '}}') && depth) { depth--; i++; continue; }
    if (depth) continue;
    const m = t.slice(i).match(/^(?:\s[–—-]{1,2}\s|\s*—\s*|(?<=[\p{L}\]])–(?=[\p{Lu}[])|\s*\.{3,}\s*|\s*…\s*)/u);
    if (m && i > 0) {
      const left = t.slice(0, i).trim(); const right = t.slice(i + m[0].length).trim();
      return left && right ? [left, right] : null;
    }
  }
  return null;
}
// a link to a character article ("[[Tik-Tok (Oz)|Tik-Tok]]", "[[Belle (Disney)|Belle]]"), not a performer
const CHARACTER_TARGET = /\((?:[^)]*\s)?(?:character|characters|oz|disney|comics|marvel|dc comics|mythology|opera|musical|novel|film|play|bible|biblical figure|legend|folklore|shakespeare)\)\s*$/i;
const PERSON_TARGET = /\((?:[^)]*\s)?(?:actor|actress|singer|entertainer|comedian|performer|dancer|musician|born \d{4}|politician|broadcaster|presenter)\)\s*$/i;
const ROLE_NOUN = /^(?:general|sergeant|soldier|captain|chaplain|judge|reporter|senator|recruit|attorney|congressman|congresswoman|prosecutor|clergyman|priest|narrator|waiter|waitress|doctor|nurse|policeman|officer|lieutenant|colonel|major|private|corporal|admiral|king|queen|prince|princess|duke|duchess|lord|lady|sir|mother|father|sister|brother|aunt|uncle|grandmother|grandfather|wife|husband|son|daughter|boy|girl|man|woman|kid|child|baby|mayor|governor|president|secretary|maid|butler|cook|servant|guard|sentry|messenger|herald|page|jailer|gaoler|warden|teacher|student|professor|pianist|lawyer|agent|manager|announcer|newscaster|singer|dancer|drunk|beggar|thief|witch|wizard|ghost|spirit|angel|devil|god|goddess|fairy|elf|dwarf|giant|monster)$/i;
/** Which side of a list of dashed cast lines names the performers: 'left', 'right' or null (can't tell). */
export function actorSideOf(lines) {
  const pairs = lines.map((l) => pairOf(l.replace(/^\s*:*[*#]+\s*/, ''))).filter(Boolean);
  const n = pairs.length;
  if (n < 3 || n < lines.length * 0.6) return null;
  const linked = (x) => { const m = x.replace(/<ref[\s\S]*$|\([^()]*\)\s*$|\{\{[^}]*\}\}/g, '').trim().match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\](?:\s*(?:\/|,|and|&)\s*\[\[[^\]]+\]\])*$/); return m ? (CHARACTER_TARGET.test(m[1]) ? 'role' : 'person') : null; };
  const txt = (x) => cleanInline(expandTemplates(stripRefs(x))).replace(/\s*\([^()]*\)\s*/g, ' ').trim();
  const personLike = (x) => /^(?:\p{Lu}[\p{L}'’.-]*|"[^"]+"|\p{Lu}\.)(?:\s+(?:\p{Lu}[\p{L}'’.-]*|"[^"]+"|\p{Lu}\.|de|van|von|la|le|di|da|del|der)){1,4}$/u.test(x) &&
    !/^(?:the|a|an|mr|mrs|ms|miss|dr|sir|lady|lord|king|queen|prince|princess|captain|general|sergeant|first|second|third|young|old|little|big|aunt|uncle|mother|father|sister|brother|new)\b/i.test(x) &&
    !x.split(/\s+/).some((w) => ROLE_NOUN.test(w) || DESCRIPTOR_NOUN.test(w));
  const roleish = (x) => hasOrdinaryWord(x) || /,|\sand\s|&/.test(x) || /^(?:the|a|an)\s/i.test(x) || x.split(/\s+/).some((w) => ROLE_NOUN.test(w) || DESCRIPTOR_NOUN.test(w));
  // a list of short role names ("Judge, OCS Sergeant", "Soldier in "C" Company") — not a description ("An intelligent schoolboy
  // who …", "Wendla's mother")
  const roleList = (x) => roleish(x) && x.split(/\s*(?:,|;|\band\b|&)\s*/).filter(Boolean).every((p) => p.split(/\s+/).length <= 4 &&
    !/^(?:a|an|the|his|her|their)\s+\p{Ll}/iu.test(p) && !/\p{L}['’]s\s/u.test(p) && !/\b(?:who|which|whose|is|was|are|has|had|with|of the)\b/i.test(p));
  const c = { lp: 0, rp: 0, lr: 0, rr: 0, pl: 0, pr: 0, rl: 0, rrr: 0 };
  for (const [l, r] of pairs) {
    const ll = linked(l); const rl = linked(r);
    if (ll === 'person') c.lp++; if (ll === 'role') c.lr++;
    if (rl === 'person') c.rp++; if (rl === 'role') c.rr++;
    const lt = txt(l); const rt = txt(r);
    if (personLike(lt) || /^\[\[[^\]]*\((?:[^)]*\s)?(?:actor|actress|singer)\)/.test(l)) c.pl++;
    if (personLike(rt)) c.pr++;
    if (roleish(lt)) c.rl++;
    if (roleList(rt)) c.rrr++;
  }
  if (pairs.some(([l]) => PERSON_TARGET.test(l.match(/^\[\[([^\]|]+)/)?.[1] ?? '')) && c.lp >= n * 0.4 && c.rp === 0) return 'left';
  if (c.lp >= n * 0.5 && c.rp <= n * 0.15 && c.rl <= n * 0.2) return 'left'; // Here's Love: "[[Janis Paige]] – Doris Walker"
  if (c.pl >= n * 0.75 && c.rrr >= n * 0.6 && c.rl <= n * 0.15 && c.rp <= n * 0.15) return 'left'; // The Lieutenant: "Gene Curty – Judge, OCS Sergeant"
  if (c.rp >= n * 0.8 && c.lp <= n * 0.5) return 'right'; // The Tik-Tok Man of Oz: "[[Tik-Tok (Oz)|Tik-Tok]]—[[James C. Morton]]"
  if (c.rp >= 2 && c.lp === 0 && c.pr >= n * 0.7) return 'right'; // The Midnight Sons: "Merri Murray ... [[Lotta Faust]]"
  return null;
}

/**
 * Parse characters from the "Characters"/"Roles"/"Cast" sections.
 * @param {Array} ss sections() of the comment-stripped article
 * @param {string} text the comment-stripped article
 * @returns {{ characters: {name, voiceType}[], aliases: Object<string, string[]>, actors: Set<string>, actorLinks: Set<string> }}
 */
export function parseCharacters(ss, text, { revue = false } = {}) {
  // a revue whose article lists no roles: its "Cast" section names performers
  if (revue && ss.some((s) => CHAR_HEAD.test(s.title) && /character|role|personae/i.test(s.title))) revue = false;
  const chars = new Map(); const actors = new Set(); const actorLinks = new Set(); const actorRoles = new Map();
  const addActorLinks = (raw) => {
    const links = []; cleanInline(expandTemplates(stripRefs(raw)), links);
    for (const l of links) { actors.add(norm(l.label)); actorLinks.add(norm(l.target)); }
  };
  const add = (name, voice, { cast = false, described = false, aliases = [] } = {}) => {
    name = name.trim();
    if (!name || name.split(/\s*\/\s*/).some((x) => x.length > 60) || NOT_A_NAME.test(name) || CREW_OR_COVER.test(name)) return;
    if (!NAME_START.test(name) || /^"[^"]*"$/.test(name)) return; // Godspell's roles labelled by their solo: '"Day by Day"'
    if (/^(?:in|on|at|from|for|with|by|during|after|before|as|when|while|although|since)\s/i.test(name)) return; // "In Larson's script, …"
    // (three lowercase words in a row is prose — "Woman with pears" is not: whole words only)
    if (PRODUCTION_WORD.test(name) || /^\d/.test(name) || /(?<!\p{L})\p{Ll}+\s+\p{Ll}+\s+\p{Ll}+/u.test(name.replace(/\b(?:of|the|de|la|le|von|van|du|des|and)\b/g, '')) || /\b(?:preceded|replaced|followed|succeeded|understudy|alternating)\b|\s(?:or)\s/i.test(name)) return;
    for (const part of splitCompound(name)) {
      const k = norm(part);
      if (!k) continue;
      const prev = chars.get(k);
      if (!prev) chars.set(k, { name: part, voiceType: voice || null, cast, described, aliases: [...aliases] }); else { if (voice && !prev.voiceType) prev.voiceType = voice; prev.cast ||= cast; prev.described ||= described; prev.aliases.push(...aliases); }
    }
  };

  // "[[Actor]]: [[Role]]" / "[[Actor]] – Role, Role" cast lines vs "Role: [[Actor]]" / "Role – [[Actor]]": the side
  // whose values repeat across the cast lists of several productions is the role (Notre-Dame de Paris)
  const pairLines = [];
  ss.forEach((s, i) => {
    if (!CHAR_HEAD.test(s.title) || CHAR_HEAD_SKIP.test(s.title)) return;
    for (const l of sectionBody(ss, i)) {
      const m = l.match(/^\s*[*#]+\s*(.+?)\s*(?::|\s[–—-]\s)\s*(.+)$/);
      if (m && !/^'''/.test(m[1])) pairLines.push([cleanInline(expandTemplates(stripRefs(m[1]))), cleanInline(expandTemplates(stripRefs(m[2])))]);
    }
  });
  // actors named by "Actor as Role" lines anywhere in the character/cast sections: listed bare in another
  // production's "Cast" section they are still actors (Shock's yearly casts)
  const asActors = new Set();
  ss.forEach((s, i) => {
    if (!CHAR_HEAD.test(s.title) || CHAR_HEAD_SKIP.test(s.title)) return;
    for (const l of sectionBody(ss, i)) {
      const m = cleanInline(expandTemplates(stripRefs(l.replace(/^\s*:*[*#]+\s*/, '')))).match(/^(\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){1,2})\s+(?:as\s|\((?:as\s+)?(?:the\s+)?\p{L})/u);
      if (m && /^\s*:*[*#]/.test(l)) asActors.add(norm(m[1]));
    }
  });
  const distinct = (k) => new Set(pairLines.map((p) => norm(p[k]))).size;
  const roleOnRight = pairLines.length >= 8 && distinct(1) <= distinct(0) * 0.5;

  ss.forEach((s, i) => {
    if (!CHAR_HEAD.test(s.title) || CHAR_HEAD_SKIP.test(s.title)) return;
    // a casting history / production cast table only when no character list came before it (The Goodbye Girl's "Historical
    // casting"); after one, its rows add only variants of the same roles
    if (LATE_CAST_HEAD.test(s.title) && chars.size >= 3) return;
    // a revue's "Cast" section lists performers, not roles
    if (revue && !/character|role|personae/i.test(s.title)) {
      for (const l of sectionBody(ss, i)) {
        addActorLinks(l);
        const m = l.match(/^\s*[*#]+\s*(.+)$/);
        if (m) for (const n of cleanInline(expandTemplates(stripRefs(m[1]))).split(/\s*(?:,|;|\band\b|&)\s*/)) if (/^\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){1,3}$/u.test(n.trim())) actors.add(norm(n));
      }
      return;
    }
    // skip nested subsections that aren't parts of the character list
    const body = []; let skipLevel = 99;
    for (const line of sectionBody(ss, i)) {
      const h = headingOf(line);
      if (h) {
        if (h.level <= skipLevel) skipLevel = 99;
        if (SUBHEAD_SKIP.test(h.title)) skipLevel = h.level;
        body.push('\u0000heading' + h.title);
        continue;
      }
      if (skipLevel === 99) body.push(line);
    }
    // "* Koichi Domoto as Koichi … * Eisuke Sasai": in a cast list written "Actor as Role", a bare name is an actor
    // with no role given, and "Akira Akasaka as rival" describes a part rather than naming one
    const ACTOR_AS = new RegExp(`^\\s*:*[*#]+\\s*${ACTORS_SRC}\\s+as\\s`, 'u');
    // judged per subsection: "Characters" then "Original cast" under it are different kinds of list
    const segOf = []; const segs = [{ title: s.title, lines: [] }];
    for (const l of body) {
      if (l.startsWith('\u0000heading')) segs.push({ title: l.slice(8), lines: [] });
      segs[segs.length - 1].lines.push(l); segOf.push(segs.length - 1);
    }
    const plainOf = (l) => cleanInline(expandTemplates(stripRefs(l.replace(/^\s*:*[*#]+\s*/, '')))).trim();
    for (const g of segs) {
      const bulletLines = g.lines.filter((l) => /^\s*:*[*#]/.test(l));
      const asCount = bulletLines.filter((l) => ACTOR_AS.test(l)).length;
      g.castTitle = (/\bcast\b/i.test(g.title) || /\bcast\b/i.test(s.title)) && !/character|role|personae/i.test(g.title);
      const bareNames = bulletLines.map(plainOf).filter((x) => /^\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){1,3}$/u.test(x));
      const knownBare = bareNames.filter((x) => asActors.has(norm(x))).length;
      // "* Koichi Domoto (Koichi)": actor, role in brackets
      const parenCount = g.castTitle ? bulletLines.filter((l) => /^\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]+){0,2}\s*\((?:as\s+)?(?:the\s+)?\p{L}[^()]*\)(?:\s*\([^()]*\))*$/u.test(plainOf(l))).length : 0;
      g.castAsList = (asCount >= 3 && asCount >= bulletLines.length * 0.2) ||
        (g.castTitle && ((knownBare >= 2 && knownBare >= bareNames.length * 0.3) || (parenCount >= 3 && knownBare >= 1)));
      // "Role – [[Actor]]" / "Actor – Role, Role": which side names the performers (null when the list doesn't say)
      g.actorSide = roleOnRight ? null : actorSideOf(bulletLines.filter((l) => !/^\s*:*[*#]+\s*'''[^']+'''\s*:?\s*$/.test(l)));
    }
    let doubling = false; // "The usual doubling is as follows:" — the lines after it list ensemble tracks, not roles
    for (let k = 0; k < body.length; k++) {
      if (body[k].startsWith('\u0000heading')) { doubling = false; continue; }
      if (!/^\s*[*#;:|!{]/.test(body[k]) && body[k].trim()) { doubling = /\bdoubl(?:ing|ed|es)\b|\btracks?\b[^.]*\bensemble\b|\bensemble\b[^.]*\btracks?\b/i.test(body[k]); continue; }
      if (doubling && /^\s*[*#]/.test(body[k])) continue;
      if (/^\s*\{\|/.test(body[k])) {
        const e = tableEnd(body, k);
        tableCharacters(parseTable(body.slice(k, e + 1)), add, addActorLinks, (n) => actors.add(norm(n)));
        k = e; continue;
      }
      const l = body[k];
      const m = l.match(/^\s*:*[*#]+\s*(.*)$/) || l.match(/^\s*;\s*(.*)$/);
      if (!m) continue;
      let item = stripRefs(m[1]); // ("[[Eddie Mekka]] starred as The Lieutenant.<ref …>")
      // "; Principals", "; Supporting roles", "; Other Tommys": a label over the list, not a role
      if (/^\s*;/.test(l) && /^\p{Lu}\p{Ll}+s$/u.test(cleanInline(expandTemplates(stripRefs(item))).replace(/[:.]\s*$/, '').trim()) && !chars.has(norm(cleanInline(item)))) continue; // "; Mortals", "; Ghosts"
      if (/^\s*;/.test(l) && /^(?:principals?|(?:main|major|minor|supporting|secondary|other|featured|leading|principal|ensemble|additional)\b.*|.*\b(?:roles|characters|cast|parts)|.*\bs)$/i.test(cleanInline(expandTemplates(stripRefs(item))).replace(/[:.]\s*$/, '').replace(/\s*\([^()]*\)\s*$/, '').trim())) continue;
      if (/\((?:19|20)\d\d\s*[–-]/.test(item)) { addActorLinks(item); continue; } // "[[Actor]] (2015–2016, …)"
      const voice = voiceIn(item);
      if (roleOnRight) {
        const pm = item.match(/^(.+?)\s*(?::|\s[–—-]\s)\s*(.+)$/);
        if (pm) {
          addActorLinks(pm[1]); for (const a of cleanInline(expandTemplates(stripRefs(pm[1]))).split(/\s*,\s*/)) actors.add(norm(a));
          for (const r of cleanInline(expandTemplates(stripRefs(pm[2]))).split(/\s*(?:,|\/)\s*/)) if (r.split(' ').length <= 5) add(cleanName(r), voice);
          continue;
        }
      }
      // "[[Jennifer Damiano]] – Anna, Thea, Martha and Ilse": a replacement actor and the roles they covered
      const actorFirst = item.match(/^\s*\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\s*(?:[–—:-]|\s-\s)\s*(.+)$/);
      const roleList = actorFirst ? cleanInline(expandTemplates(stripRefs(actorFirst[3]))).split(/\s*(?:,|\band\b|&)\s*/).filter(Boolean) : [];
      if (actorFirst && roleList.length >= 2 && roleList.every((r) => /^\p{Lu}/u.test(r) && r.split(' ').length <= 3) && !/character\)$/i.test(actorFirst[1].trim()) && !/'''/.test(item)) {
        addActorLinks(item.slice(0, item.indexOf(']]') + 2)); continue;
      }
      // "Daniel Zimmer as a 'villager'": an extra, not a role
      if (/^\s*(?:\[\[[^\]]+\]\]|\p{Lu}[\p{L}.'-]+(?:\s+\p{Lu}[\p{L}.'-]*){1,2})\s+as\s+(?:an?|one of the|some)\s/u.test(item)) { addActorLinks(item); continue; }
      const seg = segs[segOf[k]];
      const pair = seg.actorSide && /^\s*:*[*#]/.test(l) ? pairOf(item) : null;
      if (pair) {
        const [actorRaw, roleRaw] = seg.actorSide === 'left' ? pair : [pair[1], pair[0]];
        addActorLinks(actorRaw);
        const actorNames = cleanInline(expandTemplates(stripRefs(actorRaw))).replace(/\([^()]*\)/g, ' ').split(/\s*(?:,|\/|&|\band\b)\s*/).map((a) => a.trim()).filter(Boolean);
        for (const a of actorNames) actors.add(norm(a));
        if (seg.actorSide === 'right') {
          // "Role—[[Actor]]", "Role ... Actor": the role part is read like any character line
          item = roleRaw;
        } else {
          // "Gene Curty – Judge, OCS Sergeant": several roles; "[[Laurence Naismith]] – Kris Kringle\Santa Claus": two names of one
          const roleText = cleanInline(expandTemplates(stripRefs(roleRaw.replace(/\\/g, ' / '))));
          for (const r of roleText.split(/\s*(?:,|;|\band\b|&)\s*/)) {
            const aliases = [];
            let nm = cleanName(r, null, aliases);
            if (/\s\/\s/.test(nm)) { const [a, ...b] = nm.split(/\s*\/\s*/); nm = a; aliases.push(...b); }
            if (!nm || hasOrdinaryWord(nm.replace(/\b(?:in|at|on|to|for|with|from)\b/g, ' '))) continue; // "Sole female"
            add(nm, voiceIn(r), { aliases });
            for (const a of actorNames) actorRoles.set(norm(a), nm);
          }
          continue;
        }
      }
      if (seg.castAsList && /^\s*:*[*#]/.test(l)) {
        const plain = plainOf(item);
        // "* Koichi Domoto (Koichi)", "* RiRiKA (Rika)", "* Hiroki Uchi (the rival) (September performances)"
        const pr = seg.castTitle && plain.match(/^(\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]+){0,2})\s*\((?:as\s+)?([^()]*)\)(?:\s*\([^()]*\))*$/u);
        if (pr) {
          addActorLinks(item); actors.add(norm(pr[1]));
          const r = pr[2].trim().replace(/^the\s/, 'The ');
          if (/^(?:The\s+)?\p{Lu}/u.test(r) && !/^The\s+\p{Ll}/u.test(r) && r.split(' ').length <= 4 && !/'s\s|\d|\b(?:performances?|productions?|shows?|tour|run|replacement|cover|understudy|alternate|swing|January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(r)) { const nm = cleanName(r); if (nm) { add(nm, voice); actorRoles.set(norm(pr[1]), nm); } }
          continue;
        }
        // "*Koichi Domoto: a young entertainer …", "*Kaho Shimada (May 7 - 31): Owner": led by a known actor
        const lead = plain.match(/^(\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]+){0,3})\s*[:(]/u);
        if (lead && asActors.has(norm(lead[1]))) { addActorLinks(item); actors.add(norm(lead[1])); continue; }
        // not a role: a bare actor's name, "A / B (double cast as the rival)", "Jun Akiyama as the owner"
        if (/^\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){1,3}$/u.test(plain)) { addActorLinks(item); actors.add(norm(plain)); continue; }
        if (!/\sas\s|[:()–—]|\s-\s|,/.test(plain)) { addActorLinks(item); continue; } // "* [[Mie (singer)|Mie]]", "* [[KAT-TUN]]"
        if (/\(double cast\b/i.test(plain) || (ACTOR_AS.test(l) && /^\S+(?:\s+\S+){0,3}?\s+as\s+(?:the\s+)?(?!(?:de|da|di|du|van|von|der|del|la|le|ben|al|el)\s+\p{Lu})\p{Ll}/u.test(plain.replace(/\s+as\s+the\s+(?=\p{Lu})/u, ' as ')))) { addActorLinks(item); continue; }
      }
      const bold = item.match(/^'''(.+?)'''/);
      // "[[Maurice Lauchner]] as Stewart Peterson" (a cast line): the role is after "as"
      const asRole = !bold && item.match(AS_ROLE);
      if (asRole) addActorLinks(asRole[1]);
      const extraActors = [];
      // "[[Yvette Cason]] as Dahlia in the original production, [[Tina Cross]] in the 1998 run" → Dahlia
      const role = asRole ? asRole[2].replace(/&nbsp;|&#160;/g, ' ').trim().replace(/\s+(?:in|at|for|during|from|until|since)\s+(?:the\s+)?(?:original|\d{4}|first|second|revival|production|run|tour|broadway|london|west end)\b[\s\S]*$/i, '').replace(/,[\s\S]*$/, '').replace(/\s+(?:and|&)\s+(?:[Tt]he\s+)?\p{Lu}[\s\S]*$/u, '').replace(/[;.]\s*$/, '') : null; // "Richard Smith as Buster and The Giant Squid;" → Buster
      const aliases = [];
      let name = cleanName(asRole ? role.replace(/^the\s/, 'The ') : bold ? bold[1] : item, extraActors, aliases);
      if (asRole && name) for (const a of cleanInline(expandTemplates(asRole[1])).split(/\s*(?:\/|&|\band\b)\s*/)) actorRoles.set(norm(a), name); // "[[Lee Kernaghan]] as the Balladeer"
      for (const a of extraActors) actors.add(norm(a));
      if (!/^(?:Mr|Mrs|Ms|Dr|Lord|Lady|Sir|King|Queen|Sisters|Brothers)\.?\s+(?:and|&)\s/.test(name) && !/^(?:Sisters|Brothers|Misses)\s/.test(name)) {
        const cut = name.search(/\s*(?::|\s[–—-]\s|,|\bis\b|\bwho\b|\(|\bplayed by\b|\bportrayed by\b)/);
        if (cut > 0) name = name.slice(0, cut).trim();
      }
      // "[[Mulan (Disney character)|Mulan]] - A young woman who …": a described role, even if the name is also linked elsewhere
      const plainItem = cleanInline(expandTemplates(stripRefs(item)));
      const at = plainItem.indexOf(name);
      const dm = at >= 0 ? plainItem.slice(at + name.length).match(/^\s*(?:\([^()]*\)\s*)?(?:[–—:]|\s-|-\s)\s*(.+)$/u) : null;
      const described = Boolean(dm && hasOrdinaryWord(dm[1]) && dm[1].split(/\s+/).length >= 3) || /\[\[[^\]|]*\bcharacter\)/i.test(item);
      if (name.split(/\s*\/\s*/).every((x) => x.split(' ').length <= 6)) add(name, voice, { described, aliases });
      const colon = item.indexOf(':');
      if (colon > 0) addActorLinks(item.slice(colon + 1)); // "Character: [[Actor]], [[Actor]]"
    }
  });

  // actor links anywhere in the article's wikitables (cast tables, awards "Nominee" columns …)
  const t2 = stripComments(text);
  const lines = t2.split('\n');
  for (let k = 0; k < lines.length; k++) {
    if (!/^\s*\{\|/.test(lines[k])) continue;
    const e = tableEnd(lines, k);
    const tbl = parseTable(lines.slice(k, e + 1));
    for (const r of tbl.grid) {
      r.cells.forEach((c, ci) => {
        if (!c || ci === 0) return;
        for (const lm of c.raw.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/g)) { actorLinks.add(norm(lm[1])); actors.add(norm(lm[2] || lm[1])); }
      });
    }
    k = e;
  }
  // prose: "starring [[X]]", "played by [[X]]", "cast of [[X]]" (the link right after); "It featured in the cast [[A]],
  // [[B]], [[C]] …" / "The cast included [[A]] as Woodhull, [[B]] …" (every link of that sentence, except roles after "as")
  for (const pm of t2.matchAll(/(?:starring|starred|played by|portrayed by|cast (?:included|of))\s*\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/g)) {
    actorLinks.add(norm(pm[1])); actors.add(norm(pm[2] || pm[1]));
  }
  for (const pm of stripRefs(t2).matchAll(/(?:featured in the cast|cast (?:included|featured|comprised|consisted of)|in the cast were|with a cast (?:of|that included))\s*([^\n]{0,400})/gi)) {
    const sentence = pm[1].split(/(?<=[\p{Ll}\]'")]{2})\.(?:\s|$|\{)/u)[0];
    for (const lm of sentence.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/g)) {
      if (/\bas\s+(?:the\s+)?(?:[^,;[\]]{0,40}\/\s*(?:the\s+)?)?(?:''+)?$/i.test(sentence.slice(0, lm.index))) continue; // "[[Hugh Jackman]] as [[Peter Allen]]", "as Zeke/the [[Cowardly Lion]]": a role
      if (chars.has(norm(lm[2] || lm[1])) || chars.has(norm(lm[1]))) continue; // a role of the Characters list
      actorLinks.add(norm(lm[1])); actors.add(norm(lm[2] || lm[1]));
    }
  }

  // dual roles "A/B" → A and B; drop names that are actors; a group-looking row of a cast table is a
  // principal role played by named actors (Hadestown's "The Fates"), other group names are not roles
  let list = [];
  for (const c of chars.values()) {
    const ampersand = /\s&\s/.test(c.name) && c.name.split(/\s&\s/).every((x) => x.trim().split(/\s+/).length <= 2);
    if (/\//.test(c.name.replace(/\([^()]*\)/g, '')) || ampersand) {
      const parts = c.name.replace(/\([^()]*\)/g, (m) => m.replace(/\//g, '\u0001')).split(ampersand ? /\/|\s&\s/ : /\//).map((x) => x.replace(/\u0001/g, '/')).map((x) => x.replace(/\s*\([^()]*\)\s*$/, '').trim()).filter(Boolean);
      // "Louis Blore/His Most Royal Majesty, The King of France": the full form belongs to the last role
      parts.forEach((part, pi) => list.push({ name: part, voiceType: c.voiceType, cast: c.cast, described: c.described,
        aliases: pi === parts.length - 1 ? (c.aliases || []).filter((a) => a.startsWith('=') && a.includes(part)).map((a) => `=${a.slice(a.indexOf(part))}`) : [] }));
    } else list.push(c);
  }
  const seen = new Map();
  for (const c of list) {
    const k = norm(c.name);
    if (!k || (actors.has(k) && !c.described && !c.cast)) continue;
    if (!NAME_START.test(c.name) || CREW_OR_COVER.test(c.name) || NOT_A_NAME.test(c.name) || /^"[^"]*"\)?$/.test(c.name)) continue;
    if (isGroupName(c.name) && !(c.cast && !/\b(?:ensemble|chorus|company|swings?|understud\w*|standbys?|dancers|singers|cast)\b/i.test(c.name))) continue;
    if (!seen.has(k)) seen.set(k, { name: c.name, voiceType: c.voiceType, aliases: [...(c.aliases || [])] });
    else { if (c.voiceType && !seen.get(k).voiceType) seen.get(k).voiceType = c.voiceType; seen.get(k).aliases.push(...(c.aliases || [])); }
  }
  // a cast table written in capitals ("STEVE MORGAN", "CONNIE KROESSER"): title case, but not a lone acronym ("SBF")
  const vals = [...seen.values()];
  if (vals.filter((c) => ALL_CAPS.test(c.name) && /\p{Lu}{3}/u.test(c.name)).length >= Math.max(3, vals.length * 0.5)) {
    for (const c of vals) if (ALL_CAPS.test(c.name)) c.name = titleCase(c.name);
  }
  const merged = mergeVariants(vals);
  const aliases = {}; // canonical name → other names it goes by (used by the singer matcher, not output)
  for (const c of merged) if (c.aliases?.length) aliases[c.name] = [...new Set(c.aliases)];
  return { characters: merged.map((c) => ({ name: c.name, voiceType: c.voiceType })), aliases, actors, actorLinks, actorRoles };
}

function tableCharacters(tbl, add, addActorLinks, addActorName) {
  const g = tbl.grid;
  if (!g.length) return;
  // a first row made only of bold cells acts as a header row
  if (g[0].cells.every((c) => c && /^'''[^']+'''$/.test(c.raw.trim()))) g[0].allHeader = true;
  const headerRows = g.filter((r) => r.allHeader && !r.cells.some((c) => c && c.scopeRow));
  const hdr = (headerRows[0]?.cells || []).map((c) => (c ? cleanInline(stripRefs(expandTemplates(c.raw))) : ''));
  if (hdr.some((h) => /\bcrew\b|creative team|^(?:title|position|job)$/i.test(h)) && !hdr.some((h) => /^(?:character|role)s?$/i.test(h))) return; // a creative-team table
  let charCol = hdr.findIndex((h) => /^(?:character|characters|role|roles|part|parts|character\(s\)|role\(s\)|name)$/i.test(h));
  if (charCol < 0) charCol = 0;
  const voiceCol = hdr.findIndex((h) => /voice|vocal range|^range$/i.test(h));
  const descCol = hdr.findIndex((h) => /description/i.test(h));
  for (const r of g) {
    if ((r.allHeader && !r.cells.some((c) => c && c.scopeRow)) || r.fullWidth) {
      // a header row that is a character row of a cast table ("! [[Moirai|The Fates]]" + actor cells)
      if (!(r.cells[0]?.isHeader && r.cells.length > 1 && r.cells.slice(1).some((c) => c && !c.isHeader))) continue;
    }
    const cells = r.cells;
    const c0 = cells[charCol];
    if (!c0 || c0.spanned) continue;
    // first line of the cell: "Porgy, a disabled beggar" / "Name – description" → the name only;
    // "Mrs. Greer, Mrs. Pugh, Cecile, and Annette" → four characters
    const cellActors = []; const aliases = [];
    // "Scholle, ''Gutsbesitzer'' (Landowner)": an italic descriptor after the name is not another role
    let first = c0.raw.split(/<br\s*\/?>|<hr\s*\/?>|\n/i)[0].replace(/,\s*''(?!')[^']+''(?:\s*\([^()]*\))?\s*$/, '');
    // "[[Anya (Anastasia)|Anya]] / [[Grand Duchess Anastasia …|Anastasia]]": two names of one role (the link says so)
    const two = first.replace(/'''/g, '').match(/^\s*\[\[([^|\]]+)(?:\|([^\]]+))?\]\]\s*\/\s*\[\[([^|\]]+)(?:\|([^\]]+))?\]\]\s*$/);
    if (two) {
      const [t1, l1, t2, l2] = [two[1], two[2] ?? two[1], two[3], two[4] ?? two[3]].map((x) => x.trim());
      if (t1 === t2 || norm(t1).includes(norm(l2)) || norm(t2).includes(norm(l1))) { aliases.push(cleanInline(l2)); first = `[[${t1}|${l1}]]`; }
    }
    const cell = cleanName(first, cellActors, aliases, { parenAlias: true });
    for (const a of cellActors) addActorName(a);
    const parts = cell.split(/\s*,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean);
    // "Raoul, Vicomte de Chagny" is one role; "Chiron, Poseidon" / "Mrs. Greer, Mrs. Pugh, Cecile, and Annette" are several
    const listy = parts.length > 2 || /\sand\s/.test(cell) || parts.every((x) => /^\p{Lu}[\p{L}'’-]+$/u.test(x));
    const names = listy && parts.length > 1 && parts.every((x) => NAME_PART.test(x)) &&
      !parts.some((x) => /^(?:jr|sr|ii|iii|iv|mr|mrs|ms|dr|miss)\.?$/i.test(x))
      ? parts : [cell.replace(/,\s+(?=\p{Ll})[\s\S]*$|\s[–—]\s[\s\S]*$/u, '').trim()];
    let voice = null;
    if (voiceCol >= 0 && cells[voiceCol]) voice = voiceFromCell(cells[voiceCol].raw);
    else if (descCol >= 0 && cells[descCol]) {
      const m = cells[descCol].raw.match(VOICE_LINK_AT_END);
      voice = m ? voiceCase(m[1]) : voiceIn(cells[descCol].raw);
    } else {
      for (const c of cells) { // voice-type link at the end of a description cell (Chicago)
        if (!c || c === c0) continue;
        const m = c.raw.match(/\]\]?[^[]*\[\[\s*(soprano|mezzo-soprano|alto|contralto|tenor|baritone|bass|baritenor|bass-baritone|countertenor)\s*(?:\|[^\]]*)?\]\]\s*\.?\s*$/i);
        if (m && c.raw.length > 40) voice = voiceCase(m[1]);
      }
    }
    voice ??= voiceIn(c0.raw);
    // a cast table (other columns name actors): its rows are roles even when they look like groups
    const cast = cells.some((c, ci) => c && ci !== charCol && ci !== voiceCol && ci !== descCol && /\[\[/.test(c.raw));
    for (const name of names) add(name, voice, { cast, aliases: names.length === 1 ? aliases : [] });
    cells.forEach((c, ci) => { // other columns: actors (unless a description / voice column)
      if (!c || ci === charCol || ci === voiceCol || ci === descCol || c.spanned) return;
      const txt = cleanInline(expandTemplates(stripRefs(c.raw)));
      if (txt.length > 120 || /\b(?:is|are|was|who|whose|the|his|her)\b/.test(txt)) return;
      addActorLinks(c.raw);
    });
  }
}

// canonical form for comparing names: Doctor = Dr., Mister = Mr., leading The/Prof./Captain ignored
export const canonName = (n) => norm(n).replace(/^the /, '').replace(/\bmme\b|\bmadam\b/g, 'madame').replace(/\bmlle\b/g, 'mademoiselle')
  .replace(/^(?:prof|professor|dr|doctor|mr|mrs|ms|miss|sir|captain|capt|lieutenant|lt|general|madame|monsieur|elder|sister|brother|father|mother|aunt|uncle|count|countess|prince|princess|duke|duchess|baron|baroness|lord|lady|dame|king|queen|tsar|czar|emperor|empress|grand duke|grand duchess|vice principal|principal|headmaster|headmistress|coach|nurse|officer|detective|reverend) (?!of |de |von |van |la |le |the |di |da )(?=\S+ \S+)/, '')
  .replace(/\bdoctor\b/g, 'dr').replace(/\bmister\b/g, 'mr').replace(/\bprofessor\b/g, 'prof').replace(/\bsaint\b/g, 'st');

// a trailing numeral / generation marker makes a different role: "Audrey" ≠ "Audrey II", "Harry" ≠ "Harry Jr."
const NUMERAL_TAIL = /^(?:i{1,3}|iv|v|vi{0,3}|ix|x|\d+|jr|sr|junior|senior|the (?:younger|elder|second|third))$/;
// age / size prefixes make a different role: "Young Ben" ≠ "Ben", "Little Ti Moune" ≠ "Ti Moune"
const AGE_PREFIX = /^(?:young|younger|old|older|little|lil|big|baby|small|medium|adult|teen|teenage|child|kid|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)-year-old)$/;

/**
 * Merge name variants: "Diana" → "Diana Goodman" (unique longer name starting with it), "Eliza Hamilton"
 * → "Eliza Schuyler Hamilton" (same first + last word), "Dr. X" = "Doctor X", "Engineer" = "The Engineer".
 * Prefix variants that are different roles ("Little Ti Moune" / "Ti Moune", "Young Cosette" / "Cosette")
 * and numbered roles ("Audrey" / "Audrey II") are never merged.
 */
export function mergeVariants(list) {
  const words = (n) => canonName(n).split(' ');
  const into = new Map();
  for (const c of list) {
    const w = words(c.name);
    const rw = norm(c.name).split(' ');
    const tgt = list.filter((d) => {
      const dw = words(d.name);
      if (d === c) return false;
      // "General Cartwright" = "General Matilda B. Cartwright" (the same rank and surname)
      const drw = norm(d.name).split(' ');
      if (rw.length === 2 && HONORIFIC_WORD.test(rw[0]) && drw.length > 2 && drw[0] === rw[0] && drw.at(-1) === rw[1]) return true;
      // "Cee Cee Bloom" = 'Cecelia Carol "Cee Cee" Bloom' (the quoted nickname and the surname)
      const dn = norm(d.name.match(/"([^"]+)"/)?.[1] ?? '');
      if (dn && (norm(c.name) === `${dn} ${drw.at(-1)}` || norm(c.name) === dn)) return true;
      // "Soliquisto" = "The Great Soliquisto" (a name and its epithet form)
      if (rw.length === 1 && drw.length === 3 && drw[0] === 'the' && drw[2] === rw[0] &&
        /^(?:great|magnificent|mighty|amazing|incredible|fabulous|famous|wonderful|marvell?ous|terrible|infamous|notorious|celebrated|renowned|glorious|splendid|fantastic|remarkable)$/.test(drw[1])) return true;
      if (dw.length <= w.length) return false;
      const prefix = dw.slice(0, w.length).join(' ') === w.join(' ');
      if ((prefix && dw.slice(w.length).every((x) => NUMERAL_TAIL.test(x))) || (AGE_PREFIX.test(dw[0]) && dw[0] !== w[0])) return false;
      return (w.length === 1 && dw[0] === w[0]) || (w.length >= 2 && dw[0] === w[0] && (dw.at(-1) === w.at(-1) || prefix));
    });
    if (tgt.length === 1) into.set(c, tgt[0]);
  }
  const byCanon = new Map();
  const absorb = (t, c) => { if (c.voiceType && !t.voiceType) t.voiceType = c.voiceType; if (c.aliases?.length) t.aliases = [...(t.aliases || []), ...c.aliases]; };
  for (const c of list) {
    if (into.has(c)) { absorb(into.get(c), c); continue; }
    const k = canonName(c.name).replace(/ /g, ''); // "Mayzie La Bird" = "Mayzie LaBird"
    if (byCanon.has(k)) { absorb(byCanon.get(k), c); continue; }
    byCanon.set(k, c);
  }
  return [...byCanon.values()];
}

const SKIP_SINGLE = new Set(['the', 'mr', 'mrs', 'ms', 'miss', 'dr', 'young', 'old', 'little', 'lady', 'lord', 'sir', 'de', 'von', 'van', 'la', 'le', 'du', 'des', 'di', 'da', 'del', 'of', 'and', 'st']);
const HONORIFIC_WORD = /^(?:mr|mrs|ms|miss|dr|doctor|sir|lady|lord|madame|madam|mme|monsieur|mademoiselle|mlle|prof|professor|captain|capt|father|mother|sister|brother|aunt|uncle|elder|officer|detective|sergeant|judge|reverend|rev|count|countess|baron|baroness|duke|duchess|king|queen|prince|princess|general|colonel|major|lieutenant|lt|nurse|coach|principal|dean|senator|governor|mayor|herr|frau|fraulein|signor|signora|senor|senora|don|dona)$/;
// forms of address (not titles of rank, which are part of a role's name: "Lord Capulet", "King Arthur")
const NEUTRAL_HON = /^(?:mr|mrs|ms|miss|dr|doctor|prof|professor|coach|principal|officer|detective|sergeant|judge|reverend|rev|nurse|dean|mayor|senator|governor|herr|frau|fraulein|monsieur|madame|madam|mme|mademoiselle|mlle|signor|signora|senor|senora)$/;
const MALE_HON = /^(?:mr|sir|lord|monsieur|father|brother|uncle|count|baron|duke|king|prince|herr|signor|senor|don)$/;
const FEMALE_HON = /^(?:mrs|ms|miss|lady|madame|madam|mme|mademoiselle|mlle|mother|sister|aunt|countess|baroness|duchess|queen|princess|frau|fraulein|signora|senora|dona)$/;
// words of a name without quoted nicknames and middle initials: 'Buckley J. "Buck" Thomas' → buckley thomas
const coreWords = (name) => norm(String(name).replace(/"[^"]*"/g, ' ').replace(/\b\p{Lu}\.(?=\s)/gu, ' ')).split(' ').filter(Boolean).filter((w, i) => i > 0 || w !== 'the');
// one letter inserted or deleted ("Darryl"/"Daryl", "Crissy"/"Chrissy") — spelling variants of one name
function oneEdit(a, b) {
  if (a === b || Math.abs(a.length - b.length) !== 1) return false;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0; while (i < s.length && s[i] === l[i]) i++;
  return i < s.length - 1 && i > 0 && s.slice(i) === l.slice(i + 1); // not at either end ("Louis" ≠ "Louise", "Ella" ≠ "Bella")
}
// at most one letter inserted, deleted or changed, anywhere
function editDistance1(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0; while (i < s.length && s[i] === l[i]) i++;
  return s.length === l.length ? s.slice(i + 1) === l.slice(i + 1) : s.slice(i) === l.slice(i + 1);
}
const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * Build the singer-token → character matcher for one show.
 * matchCharacter(token, exactOnly) returns the canonical character name or null. Rules, in order:
 * exact/canonical-equal; initial + surname ("H. Chandler"); quoted nickname ("J.D."); first + last name
 * ignoring middle names, initials and nicknames ("Alonzo P. Goodhue" → Alonzo "Stinky" Goodhue); honorific
 * + surname ("Mr. Hawkins" → Tom Hawkins, "Mrs. Bogen" → Mrs. Ida Bogen, "Dr. Jim Pomatter" → Dr. Pomatter);
 * first name + surname initial ("Kevin G" → Kevin Gnapoor); a single word that belongs to exactly one
 * character (preferring a first-word match: Curly → Curly McLain; never a "Young …"/"Little …" variant
 * or a numbered role: Ben → Benjamin Stone, not Young Ben; Audrey ≠ Audrey II); a short form of one
 * first name ("Cliff" → Clifford Bradshaw); the candidate contained in all others (Sarah Brown vs
 * Sister Sarah Brown); a bare surname shared by several characters → the first-listed protagonist,
 * unless the protagonist's first name is also used in the same list (Evita's "Eva and Perón"); a name
 * used in full elsewhere in the same list ("Lee" → "Charles Lee", "Darcy" → "Mr. Darcy").
 * setListTokens(tokens, names) tells it the single-word tokens and the multi-word names of the list.
 */
export function createCharacterMatcher(characters) {
  // aliases ("Death, posing as Prince Nikolai Sirki") are matched like names and resolve to the character
  // ("=Name, appositive" full forms only match in full)
  const aliasOf = new Map(); const fullForm = new Map();
  const all = [...characters];
  for (const c of characters) {
    for (const a of c.aliases || []) {
      if (!a || characters.some((d) => norm(d.name) === norm(a.replace(/^=/, '')))) continue;
      if (a.startsWith('=')) { fullForm.set(norm(a.slice(1)), c.name); continue; }
      aliasOf.set(a, c.name); all.push({ name: a });
    }
  }
  const idx = all.map((c) => {
    const words = norm(c.name).split(' ');
    const core = coreWords(c.name);
    const hon = core.length > 1 && HONORIFIC_WORD.test(core[0]) ? core[0] : null;
    const nick = norm(c.name.match(/"([^"]+)"/)?.[1] || '');
    return { c, n: norm(c.name), cn: canonName(c.name), words, core, hon, nick, bare: hon ? core.slice(1) : core, aged: AGE_PREFIX.test(words[0]) || /^(?:the\s+)?\S+-year-old\b/i.test(c.name) };
  });
  let listTokens = new Set(); let listNames = [];
  const cache = new Map();
  const cn = (v) => v.replace(/^the /, '').replace(/\bdoctor\b/g, 'dr').replace(/\bmister\b/g, 'mr').replace(/\bmme\b/g, 'madame');
  const one = (arr) => (arr.length === 1 ? arr[0].c.name : null);
  function match(tok, exactOnly = false, viaList = false) {
    tok = String(tok).replace(/\bMadam\b/g, 'Madame'); // ("Madam Armfeldt" = Madame Leonora Armfeldt)
    const n = norm(tok).replace(/^the /, '');
    if (!n) return null;
    const hit = idx.find((x) => x.n === n || cn(x.n) === cn(n) || x.cn === canonName(tok)) ??
      idx.find((x) => x.cn.replace(/ /g, '') === canonName(tok).replace(/ /g, '')); // "Mayzie LaBird" = "Mayzie La Bird"
    if (hit) return hit.c.name;
    if (fullForm.has(norm(tok))) return fullForm.get(norm(tok));
    if (exactOnly) return null;
    // "Mark's Mother" → Mrs. Cohen, "Roger's Mother" → Mrs. Davis (Rent): a parent addressed by the child's surname
    const rel = !viaList && tok.match(/^(.+?)['’]s\s+(mother|mom|mum|father|dad)$/i);
    if (rel) {
      const child = match(rel[1], false, true);
      const sur = child && coreWords(child).at(-1);
      const hon = /^(?:mother|mom|mum)$/i.test(rel[2]) ? /^(?:mrs|madame|frau|signora|senora)$/ : /^(?:mr|monsieur|herr|signor|senor)$/;
      const parent = sur && coreWords(child).length >= 2 ? idx.filter((x) => x.hon && hon.test(x.hon) && x.bare.at(-1) === sur) : [];
      if (parent.length === 1) return parent[0].c.name;
    }
    // "The Mayor" → "The Mayor of Whoville": a title noun completed by "of …"
    const ofName = idx.filter((x) => x.n.replace(/^the /, '').startsWith(`${n} of `));
    if (ofName.length === 1 && (/^the\s/i.test(tok) || n.split(' ').length > 1 || !idx.some((x) => x !== ofName[0] && x.words.includes(n)))) return ofName[0].c.name;
    const w = n.split(' ');
    const ini = tok.match(/^([A-Z])\.\s*(\S.*)$/);
    if (ini) {
      const c2 = idx.filter((x) => x.words[0]?.startsWith(ini[1].toLowerCase()) && x.n.endsWith(' ' + norm(ini[2])));
      if (c2.length === 1) return c2[0].c.name;
    }
    const bareTok = tok.replace(/\W/g, '').toLowerCase();
    const nick = idx.filter((x) => (x.c.name.match(/"([^"]+)"/)?.[1] || '').replace(/\W/g, '').toLowerCase() === bareTok);
    if (bareTok && nick.length === 1) return nick[0].c.name;
    const core = coreWords(tok);
    const tHon = core.length > 1 && HONORIFIC_WORD.test(core[0]) ? core[0] : null;
    const tBare = tHon ? core.slice(1) : core;
    if (tBare.length >= 2) { // first + last, ignoring middle names / initials / nicknames / honorifics
      const fl = idx.filter((x) => x.bare.length >= 2 && (x.bare[0] === tBare[0] || (x.nick && x.nick === tBare[0])) && x.bare.at(-1) === tBare.at(-1));
      if (fl.length === 1) return fl[0].c.name;
      const fl2 = idx.filter((x) => x.bare.length >= 2 && x.bare[0] === tBare[0] && tBare.at(-1).length >= 5 && editDistance1(x.bare.at(-1), tBare.at(-1)));
      if (fl2.length === 1 && !fl.length) return fl2[0].c.name; // "Cecil B. DeMile" (a typo) → Cecil B. DeMille
      // the first names of a longer name: "Carl-Magnus" → Count Carl-Magnus Malcolm
      const pre = idx.filter((x) => !x.aged && x.bare.length > tBare.length && tBare.every((w, k) => x.bare[k] === w));
      if (pre.length === 1 && !fl.length) return pre[0].c.name;
    }
    if (tHon && tBare.length >= 1) { // the same rank or title + surname: "Major Fenton" → Major Eric Fenton, "General Cartwright"
      const same = idx.filter((x) => !x.aged && x.hon === tHon && x.bare.length >= 1 && x.bare.at(-1) === tBare.at(-1));
      if (same.length === 1) return same[0].c.name;
    }
    if (tHon && tBare.length >= 1 && NEUTRAL_HON.test(tHon)) { // honorific + surname ("Mr. Hawkins"; not "Lord Capulet" ≠ Juliet Capulet)
      const compatible = (x) => !x.hon || x.hon === tHon || (MALE_HON.test(tHon) && !FEMALE_HON.test(x.hon)) || (FEMALE_HON.test(tHon) && !MALE_HON.test(x.hon));
      const sur = idx.filter((x) => !x.aged && x.bare.length >= 1 && x.bare.at(-1) === tBare.at(-1) && compatible(x) && (tBare.length === 1 || x.bare.length === 1 || x.bare[0] === tBare[0]));
      if (sur.length === 1) return sur[0].c.name;
      const same = sur.filter((x) => x.hon === tHon);
      if (same.length === 1) return same[0].c.name;
    }
    const fi = tok.match(/^(\p{Lu}[\p{L}'’-]+)\s+(\p{Lu})\.?$/u); // "Kevin G" → Kevin Gnapoor
    if (fi) {
      const c2 = idx.filter((x) => x.bare.length >= 2 && x.bare[0] === norm(fi[1]) && x.bare.at(-1).startsWith(fi[2].toLowerCase()));
      if (c2.length === 1) return c2[0].c.name;
    }
    // a word used as a possessive in a name doesn't identify that character ("Moses" ≠ "Moses' Son")
    const possessive = (x) => new RegExp(`(?:^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s|s'|’s|')(?:\\s|$)`, 'i').test(x.c.name.normalize('NFKD').replace(/[̀-ͯ]/g, ''));
    const cands = idx.filter((x) => (w.length === 1
      ? x.words.includes(n) && !SKIP_SINGLE.has(n) && !possessive(x)
      : x.n.endsWith(' ' + n) || x.n.startsWith(n + ' ')));
    if (w.length === 1) {
      const plain = cands.filter((x) => !x.aged);
      const r = one(plain);
      if (r) return r;
      if (AGE_PREFIX.test(n)) { const ag = cands.filter((x) => x.words[0] === n); if (ag.length === 1) return ag[0].c.name; } // "Baby" → Baby Frances Gumm
      const firstWord = plain.filter((x) => x.words[0] === n);
      if (firstWord.length === 1) return firstWord[0].c.name;
      // a bare surname shared by several: the first-listed protagonist ("Pinglet" → Joseph Pinglet) …
      if (plain.length > 1 && plain[0] === idx[0] && plain.every((x) => x.words.at(-1) === n) && !listTokens.has(idx[0].words[0])) return plain[0].c.name;
      // … else the one addressed by honorific + surname only ("Giry" → Madame Giry, not Meg Giry)
      const first = plain.filter((x) => x.bare[0] === n);
      if (first.length === 1) return first[0].c.name;
      if (!plain.length && n.length >= 3 && !AGE_PREFIX.test(n)) { // "Cliff" → Clifford Bradshaw; "Ben" → Benjamin Stone, never Young Ben; "Polly" → Pollyanna
        const pre = idx.filter((x) => !x.aged && x.bare.length >= 1 && x.bare[0].length > n.length + 1 && x.bare[0].startsWith(n) && !/['’]s\b/.test(x.c.name));
        if (pre.length === 1) return pre[0].c.name;
      }
      if (!plain.length && n.length >= 5) { // one letter apart from a unique first name: "Darryl" → Daryl Van Horne, "Crissy" → Chrissy
        const near = idx.filter((x) => !x.aged && x.bare.length >= 1 && oneEdit(x.bare[0], n));
        if (near.length === 1 && !idx.some((x) => x.words.includes(n))) return near[0].c.name;
      }
    } else if (cands.length === 1) return cands[0].c.name;
    if (cands.length > 1) {
      const inner = cands.filter((a) => cands.every((b) => (' ' + b.n + ' ').includes(' ' + a.n + ' ')));
      if (inner.length === 1) return inner[0].c.name;
      if (w.length === 1 && cands[0] === idx[0] && cands.every((x) => x.words[x.words.length - 1] === n) && !listTokens.has(idx[0].words[0])) return cands[0].c.name;
    }
    // "Mr. Mayor" → the one character called "The Mayor …" (a title used as a surname)
    if (tHon && tBare.length === 1 && NEUTRAL_HON.test(tHon) && !viaList) {
      const r = match(`The ${tBare[0]}`, false, true);
      const rc = r && idx.find((x) => x.c.name === r && x.n.startsWith(`the ${tBare[0]}`));
      if (rc && !(MALE_HON.test(tHon) && FEMALE_HON.test(rc.hon || '')) && !(FEMALE_HON.test(tHon) && MALE_HON.test(rc.hon || ''))) return r;
    }
    // "Elma the Electrifying Elver", "The Cat Jose the Pool Boy": a long phrase that starts with a character's name
    if (w.length >= 4 && !viaList) {
      for (let k = Math.min(3, w.length - 1); k >= 1; k--) {
        const head = tok.split(/\s+/).slice(0, k + (/^the\s/i.test(tok) ? 1 : 0)).join(' ');
        const r = match(head, false, true);
        if (r) return r;
      }
    }
    // a name written in full elsewhere in the same list: "Lee" → "Charles Lee", "Darcy" → "Mr. Darcy"
    if (w.length === 1 && !cands.length && !AGE_PREFIX.test(n) && !viaList) {
      // (not "Maria Baron" when "Maria" and "Baron" are both names in the list: a missing comma)
      const full = listNames.filter((x) => { const cw = coreWords(x).filter((y) => y !== 'the'); return cw.length >= 2 && cw.at(-1) === n && !AGE_PREFIX.test(cw[0]) && !cw.every((y) => listTokens.has(y)); });
      if (full.length === 1) return match(full[0], false, true) ?? full[0];
    }
    // last resort, spelling variants of a single word (never a group: "The Shirelles" ≠ Shirelle)
    if (w.length === 1 && !cands.length && n.length >= 5 && !/^the\s/i.test(tok) && !viaList) {
      // … from a unique surname ("Jamerson" → J. Jonah Jameson)
      const nearLast = idx.filter((x) => !x.aged && x.bare.length >= 2 && oneEdit(x.bare.at(-1), n));
      if (nearLast.length === 1) return nearLast[0].c.name;
      // an English form of a foreign / classical name: "Helen" → Hélène, "Menelaus" → Ménélas, "Orestes" → Oreste
      // (only for a name written with accents, or a Latin/Greek "-es/-us/-as" ending — never "Louis" → Louise)
      const variant = idx.filter((x) => !x.aged && x.bare.length === 1 && x.bare[0].length >= 4 && x.bare[0].slice(0, 3) === n.slice(0, 3) &&
        editDistance1(x.bare[0], n) && (/[^\u0000-\u007f]/.test(x.c.name) || /(?:es|us|as)$/.test(n)));
      if (variant.length === 1) return variant[0].c.name;
    }
    return null;
  }
  const matchCharacter = (tok, exactOnly = false) => {
    const key = `${exactOnly ? 1 : 0}|${tok}`;
    if (!cache.has(key)) { const r = match(tok, exactOnly); cache.set(key, r && (aliasOf.get(r) ?? r)); }
    return cache.get(key);
  };
  /** "The Three Kates" → the three characters whose first name is Kate (only when the count matches). */
  const expandGroup = (tok) => {
    const m = String(tok).match(/^(?:the\s+)?(two|three|four|five|six|seven|eight|nine|ten|\d)\s+(\p{Lu}[\p{L}'’-]+?)(?:e?s)$/iu);
    if (!m) return null;
    const count = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    const stem = norm(m[2]);
    const hits = characters.filter((c) => { const cw = coreWords(c.name); return cw.length >= 2 && (cw[0] === stem || cw[0] === `${stem}e`); });
    return hits.length === count ? hits.map((c) => c.name) : null;
  };
  /** Single-word singer tokens and multi-word names of the list being parsed (the last rules look at them). */
  const setListTokens = (tokens, names = []) => { listTokens = new Set(tokens); listNames = [...new Set(names)]; cache.clear(); };
  return { matchCharacter, setListTokens, expandGroup };
}
