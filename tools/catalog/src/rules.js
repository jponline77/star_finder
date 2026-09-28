// Which Wikidata items / Wikipedia articles are stage musicals (incl. operettas and revues).
// Pure functions over query rows + class flags; see README "Selection rules".
import { stageInfobox, firstInfobox, stripComments } from './wikitext.js';

// P31 classes that mean "a staged work"
export const STAGE_OK = new Set(['Q58483083', 'Q2743', 'Q170384', 'Q918727', 'Q30935481', 'Q7777570', 'Q59163902', 'Q43099500',
  'Q7725634', 'Q47461344', 'Q25379', 'Q1349065', 'Q3566051', 'Q2422679', 'Q15116915', 'Q141168576', 'Q17537576', 'Q2910675',
  'Q838948', 'Q35140', 'Q217117', 'Q15079786', 'Q1370345']);
// P31 classes that are never a stage show (songs, albums, people, groups, organisations, TV episodes …)
export const HARD_BLOCK = new Set(['Q7366', 'Q134556', 'Q7302866', 'Q482994', 'Q207393', 'Q5', 'Q215380', 'Q2088357', 'Q5741069',
  'Q131186', 'Q61653556', 'Q1820625', 'Q18127', 'Q24354', 'Q24856', 'Q196600', 'Q846662', 'Q24634210', 'Q934744', 'Q4290',
  'Q43229', 'Q163740', 'Q327333', 'Q11812394', 'Q7168296', 'Q36834', 'Q753110', 'Q822146', 'Q42998', 'Q193977', 'Q112620847',
  'Q12360944', 'Q109288825', 'Q125258836', 'Q101430687', 'Q43136500', 'Q109429068', 'Q1141470', 'Q123146758', 'Q18510489',
  'Q19314966', 'Q16017119', 'Q54982412', 'Q28107590', 'Q2393314', 'Q64606659', 'Q35718073', 'Q460730', 'Q908349', 'Q1027114',
  'Q29430681', 'Q862597', 'Q15275719', 'Q11183017', 'Q24992028', 'Q7725310', 'Q21191270', 'Q1259759', 'Q431102', 'Q13406463']);
// extra classes that rule out a category-only article (novels, books, musical compositions, generic "work", TV specials …)
const FALLBACK_BLOCK = new Set(['Q105543609', 'Q386724', 'Q8261', 'Q571', 'Q1261214', 'Q24862', 'Q202866', 'Q506240', 'Q5398426',
  'Q15416', 'Q11424', 'Q110879246', 'Q24634210']);
export const MUSICAL_FORMS = new Set(['Q2743', 'Q1954953', 'Q1548170', 'Q643684', 'Q7354827', 'Q253137', 'Q5158398', 'Q31884180',
  'Q55622691', 'Q55841026', 'Q107177810', 'Q135112830', 'Q135112891', 'Q30935481', 'Q3684598', 'Q6027927', 'Q1370345']);
export const OPERETTA_FORMS = new Set(['Q170384', 'Q2569052', 'Q24678689', 'Q901296', 'Q19947604', 'Q21643627', 'Q2260479', 'Q13220650']);
export const REVUE_FORMS = new Set(['Q918727', 'Q134962417']);

const DISAMBIG_STAGE = /\((?:[^)]*\s)?(?:musical|revue|operetta)\)$/i; // "Calendar Girls (musical)"
const TITLE_STAGE = /\bthe musical\b|: a (?:new )?musical\b/i; // "Bring It On: The Musical"
const DISAMBIG_NONSTAGE = /\((?:[^)]*\s)?(?:song|single|album|film|soundtrack|ballet|dance|TV series|television film|band|novel|book|miniseries|TV special|television special|television musical|TV musical|TV program|TV programme|television program|television programme|video game|podcast|web series|EP)\)$/i;
// lists and umbrella articles ("Theme park live adaptations of The Lion King")
const LIST_TITLE = /^(?:lists? of|index of|outline of|timeline of)\b|\badaptations of\b/i;
const NONSTAGE_DESC = /\b(?:film|album|television|TV series|novel|book|song|single|band|singer|podcast|video game|radio|comic(?! opera)|manga|anime|square|street|company|organization|group|Wikimedia list article|disambiguation page|genre|theme park)\b|^(?:a |the )?term\b/i;
// candidates found only through opera categories: comic operas / operettas / opéras bouffes only
const OPERA_CAT = /^(?:Operas by .+|English comic operas|Opéras bouffes|Savoy operas|Operettas by .+)$/;
const COMIC_CAT = /^(?:Operas by Gilbert and Sullivan|Savoy operas|English comic operas|Opéras bouffes|Operettas by .+)$/;
const COMIC_DESC = /comic|bouff|operett|opérette|light opera|burlesque|opéra[- ]comique|opera comique|zarzuela|singspiel|savoy|gilbert/i;
const SERIOUS_DESC = /grand opera|romantic opera|opéra fantastique|tragic|tragedy|\bgenre\b/i;
const STAGE_DESC = /\bstage (?:musical|show|production|adaptation|version)\b|\bmusical (?:play|comedy|revue)\b/i;

const split = (s) => String(s || '').split(' ').filter(Boolean);

/** Stage kind from forms/genres/P31 (and the description as a fallback). */
export function kindOf(forms, p31, desc = '') {
  const all = [...forms, ...p31];
  if (all.some((f) => MUSICAL_FORMS.has(f))) return 'musical';
  if (all.some((f) => OPERETTA_FORMS.has(f))) return 'operetta';
  if (all.some((f) => REVUE_FORMS.has(f))) return 'revue';
  if (/operetta|comic opera/i.test(desc)) return 'operetta';
  if (/\brevue\b/i.test(desc)) return 'revue';
  return 'musical';
}

/**
 * Include/exclude one query-A row ({ item, enwiki, desc, p31, forms }).
 * flags: { [classQid]: { isFilm, isTV, isStage } } from query C.
 * → { include, kind, reason }
 */
export function decide(row, flags) {
  const p31 = split(row.p31); const forms = split(row.forms);
  const flag = (c) => flags[c] || {};
  const filmTv = p31.some((c) => flag(c).isFilm || flag(c).isTV);
  const blocked = p31.some((c) => HARD_BLOCK.has(c));
  const song = p31.includes('Q7366') || p31.includes('Q134556');
  const stage = p31.some((c) => STAGE_OK.has(c) || flag(c).isStage);
  const title = row.enwiki || '';
  const kind = kindOf(forms, p31, row.desc);
  if (LIST_TITLE.test(title)) return { include: false, kind, reason: 'list-article' };
  if (song) return { include: false, kind, reason: 'song' };
  if (DISAMBIG_NONSTAGE.test(title)) return { include: false, kind, reason: 'non-stage-disambiguator' };
  if (stage && !filmTv && !blocked) return { include: true, kind, reason: 'stage-class' };
  if (DISAMBIG_STAGE.test(title) || (TITLE_STAGE.test(title) && !filmTv)) return { include: true, kind, reason: 'title-rescue' };
  return { include: false, kind, reason: filmTv ? 'film/tv' : blocked ? 'blocked-class' : 'not-stage-class' };
}

/**
 * Include/exclude an article found only through the Wikipedia musical categories.
 * info: query-E row for its QID ({ p31, forms, desc }) or null (no QID / no data);
 * excludedByRules: the QID was in query A but rejected by decide().
 */
export function decideFallback(title, info, flags, { excludedByRules = false, cats = [] } = {}) {
  const p31 = split(info?.p31); const forms = split(info?.forms); const desc = info?.desc || '';
  let kind = kindOf(forms, p31, desc);
  if (cats.length && cats.every((c) => OPERA_CAT.test(c))) {
    if (!(cats.some((c) => COMIC_CAT.test(c)) || COMIC_DESC.test(desc)) || SERIOUS_DESC.test(desc)) return { include: false, kind, reason: 'opera-not-comic' };
    kind = 'operetta';
  }
  const strong = DISAMBIG_STAGE.test(title) || TITLE_STAGE.test(title);
  if (LIST_TITLE.test(title) || /Wikimedia list article|disambiguation page/i.test(desc)) return { include: false, kind, reason: 'list-article' };
  if (DISAMBIG_NONSTAGE.test(title) || /\((?:\d{4} )?(?:film|album|song|novel|TV series)\)$/i.test(title)) return { include: false, kind, reason: 'non-stage-disambiguator' };
  if (excludedByRules && !strong) return { include: false, kind, reason: 'excluded-by-wikidata-rules' };
  const flag = (c) => flags[c] || {};
  const filmTv = p31.some((c) => flag(c).isFilm || flag(c).isTV);
  const blocked = p31.some((c) => HARD_BLOCK.has(c) || FALLBACK_BLOCK.has(c));
  if (!strong && (filmTv || blocked)) return { include: false, kind, reason: filmTv ? 'film/tv' : 'blocked-class' };
  if (!strong && NONSTAGE_DESC.test(desc) && !STAGE_DESC.test(desc)) return { include: false, kind, reason: 'non-stage-description' };
  return { include: true, kind, reason: strong ? 'category+title' : 'category' };
}

/**
 * An article excluded only for its Wikidata class (film/TV/album/…) that is a stage musical after all (Get Up, Stand
 * Up!, Mr. Cinders — the article also covers the film or the cast album). → the reason to keep it, or null.
 * - its first infobox is {{Infobox musical}} with a dated premiere or productions line, or
 * - it has no infobox, sits in a "YYYY musicals/operettas/revues" category and its opening calls it a musical;
 * never when the opening calls it something else that happens to be musical ("a 2017 musical podcast").
 */
export function rescueStageArticle(title, content, cats = []) {
  const t = stripComments(content ?? '');
  const lead = t.replace(/\{\{[^{}]*\}\}/g, '').split(/\n==/)[0].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');
  const head = (lead.replace(/'''+/g, '').match(/\b(?:is|was) an?\s+([^.]{0,160})/i)?.[1] ?? '').split(/\s(?:by|with|written|composed|based|about|that|which|who|from|for|in which)\s/)[0];
  if (/\b(?:podcast|audio (?:drama|play|musical|series)|radio (?:play|musical|drama|series)|web ?series|film|movie|television|tv|concept album|video game|album)\b/i.test(head) &&
    !/\bstage\b|\btheat(?:re|er)\b/i.test(head)) return null; // "a Czech stage musical play and film" is kept
  const ib = stageInfobox(t);
  if (firstInfobox(t)?.type === 'musical' && ib && ['premiere_date', 'premiere', 'first_performance', 'productions'].some((k) => ib[k] && /\d{4}/.test(ib[k]))) return '{{Infobox musical}}';
  const plainStage = !firstInfobox(t) && !/\((?:[^)]*\s)?(?:TV|television|film|album|radio|song)\b[^)]*\)$/i.test(title) &&
    cats.some((c) => /^\d{4} (?:musicals|operettas|revues)$/.test(c)) &&
    /'''[^']+'''[^.]{0,200}\b(?:is|was) an?\s+(?:[\w-]+\s+){0,4}(?:musical|operetta|revue|musical comedy)\b/i.test(lead);
  return plainStage ? 'no infobox; a "YYYY musicals" category and "… is a musical"' : null;
}
