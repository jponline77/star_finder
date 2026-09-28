// Low-level wikitext helpers: comments, refs, templates, links, formatting, sections, infoboxes and
// wikitables. Pure functions, no network, no dependencies.

const NAMED_ENTITIES = {
  nbsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ', ndash: '–', mdash: '—', minus: '−', hellip: '…',
  quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  dagger: '†', Dagger: '‡', middot: '·', times: '×', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó',
  iacute: 'í', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß',
  shy: '', zwj: '', zwnj: '', lrm: '', rlm: '',
};

/** Decode HTML entities (named subset + numeric) and turn non-breaking spaces into plain spaces. */
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => safeCodePoint(parseInt(h, 16), m))
    .replace(/&#(\d{1,7});/g, (m, d) => safeCodePoint(Number(d), m))
    .replace(/&([a-z]{2,8});/gi, (m, n) => (n in NAMED_ENTITIES ? NAMED_ENTITIES[n] : m))
    .replace(/[    ]/g, ' ');
}
function safeCodePoint(n, fallback) {
  if (n === 160) return ' ';
  try { return String.fromCodePoint(n); } catch { return fallback; }
}

/** Remove HTML comments (an unterminated comment runs to the end, as in MediaWiki). */
export const stripComments = (s) => s.replace(/<!--[\s\S]*?(?:-->|$)/g, '');

/** Remove <ref …/> and <ref …>…</ref> footnotes. */
export const stripRefs = (s) => s
  .replace(/<ref\b[^>]*\/>/gi, '')
  .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, '')
  .replace(/<references\b[^>]*\/>/gi, '')
  .replace(/<references\b[^>]*>[\s\S]*?<\/references\s*>/gi, '');

/** Split a template/link body at top-level pipes (pipes inside nested {{ }} / [[ ]] are kept). */
export function splitParams(body) {
  const out = [];
  let depthT = 0; let depthL = 0; let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c2 = body.slice(i, i + 2);
    if (c2 === '{{') { depthT++; cur += c2; i++; continue; }
    if (c2 === '}}' && depthT > 0) { depthT--; cur += c2; i++; continue; }
    if (c2 === '[[') { depthL++; cur += c2; i++; continue; }
    if (c2 === ']]' && depthL > 0) { depthL--; cur += c2; i++; continue; }
    if (body[i] === '|' && depthT === 0 && depthL === 0) { out.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  out.push(cur);
  return out;
}

/** Index of the "}}" closing the template that starts at `start` ("{{"), or -1 if unbalanced. */
export function findTemplateEnd(s, start) {
  let depth = 0;
  for (let j = start; j < s.length - 1; j++) {
    if (s[j] === '{' && s[j + 1] === '{') { depth++; j++; continue; }
    if (s[j] === '}' && s[j + 1] === '}') { depth--; j++; if (depth === 0) return j + 1; continue; }
  }
  return -1;
}

/** Normalised template name: "Track_Listing " → "track listing". */
export const templateName = (raw) => raw.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();

/**
 * Replace every top-level {{template}} with fn(name, params, raw). Nested templates are passed to fn
 * inside `params` untouched; callers that want them expanded call this recursively.
 * Parser functions ({{#if: …}}) and magic words are handed over the same way (name starts with "#").
 */
export function mapTemplates(s, fn) {
  let out = ''; let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{{', i);
    if (start < 0) { out += s.slice(i); break; }
    out += s.slice(i, start);
    const end = findTemplateEnd(s, start);
    if (end < 0) { out += s.slice(start); break; } // unbalanced: keep the rest verbatim
    const raw = s.slice(start, end);
    const params = splitParams(raw.slice(2, -2));
    let first = params.shift();
    // parser functions / magic words: {{#if:x|…}}, {{DEFAULTSORT:Foo}} → name "#if" / "defaultsort"
    const pf = first.match(/^\s*(#[a-z]+|[A-Z]{4,})\s*:([\s\S]*)$/);
    if (pf) { first = pf[1]; params.unshift(pf[2]); }
    out += fn(templateName(first), params, raw);
    i = end;
  }
  return out;
}

/** Parse "k = v" template parameters into an object (keys lowercased); positional ones in `_`. */
export function templateFields(params) {
  const fields = { _: [] };
  for (const p of params) {
    const m = p.match(/^\s*([^=|{}[\]]+?)\s*=([\s\S]*)$/);
    if (m) fields[m[1].trim().toLowerCase()] = m[2].trim();
    else fields._.push(p.trim());
  }
  return fields;
}

// Templates whose output never matters for song lists / characters / credits.
const DROP = new RegExp('^(?:' + [
  'efn(?:[- ][a-z]+)*', 'refn', 'sfnp?[a-z]*', 'r', 'rp', 'ref label', 'note label', 'cn', 'citation needed', 'fact',
  'clarify', 'clarification needed', 'dubious', 'when', 'who', 'by whom', 'which', 'according to whom', 'vague',
  'notelist(?:-[a-z]+)?', 'reflist', 'notes', 'refbegin', 'refend', 'col-[a-z0-9 ]+', 'colbegin', 'colend',
  'columns-list', 'div col(?: end)?', 'main', 'main article', 'see also', 'further', 'further information', 'details',
  'redirect[a-z0-9 -]*', 'distinguish', 'about', 'for', 'other uses', 'listen', 'multi-listen [a-z]+', 'anchors?',
  'clear', 'clr', '-', 'webarchive', 'cite[a-z ]*', 'citation', 'harvnb', 'harvtxt', 'poemquote', 'poem quote',
  'quote', 'blockquote', 'quote box', 'cquote', 'rquote', 'poem', 'verse translation', 'lyrics', 'use [a-z ]+',
  'short description', 'good article', 'featured article', 'toc[a-z ]*', 'pp[a-z-]*', 'update', 'more citations needed',
  'unreferenced(?: section)?', 'expand section', 'dead link', 'self-published inline', 'failed verification',
  'original research inline', 'image', 'multiple image', 'wide image', 'portal', 'commons category', 'wikiquote',
  'music ratings', 'album ratings', 'infobox[a-z0-9 ]*', 'navbox[a-z ]*', 'authority control', 'defaultsort',
  'wiktionary', 'hidden begin', 'hidden end', 'break', 'nbsp;', 'stack', '#tag', '#invoke', '#if', '#ifeq', '#switch',
  'ref', 'note', 'efn-ua', 'flagicon', 'flag icon', 'isbn', 'aka', 'col-float(?:-[a-z]+)?', 'disambiguation needed', 'dn',
  'page needed', 'year needed', 'full citation needed', 'better source needed', 'which\\?', 'sup', 'refname',
].join('|') + ')$');

/** Expand the small set of inline templates that carry text; drop the rest (reported via warn). */
export function expandTemplates(s, warn = () => {}) {
  for (let pass = 0; pass < 6 && s.includes('{{'); pass++) {
    s = mapTemplates(s, (name, params) => expandOne(name, params, warn));
  }
  return s;
}

function expandOne(name, params, warn) {
  const pos = params.filter((x) => !/^\s*[a-z0-9_ -]+\s*=/i.test(x)).map((x) => x.trim());
  const named = templateFields(params);
  if (DROP.test(name)) return '';
  if (/^lang-[a-z-]+$/.test(name)) return pos[0] ?? ''; // {{lang-fr|texte}}
  switch (name) {
    case 'nbsp': case 'spaces': case 'sp': case 'space': return ' ';
    case '!': return '|';
    case "'\"": return "'\"";
    case "\"'": return "\"'";
    case "'": case "'-": case "-'": case '`': case '" \'': case "'s": return name === "'s" ? "'s" : "'";
    case 'citation needed span': case 'citation needed-span': case 'cn span': case 'dubious span': case 'clarify span': case 'korean': case 'chinese': case 'japanese': return pos[0] ?? named.hangul ?? '';
    case 'n/a': case 'n/a2': case 'na': case 'no': case 'n': case 'cross': case 'x mark': case 'xmark': return name.startsWith('n/a') ? '' : '✗';
    case '=': return '=';
    case 'ndash': case 'en dash': case '–': return '–';
    case 'mdash': case 'em dash': case '—': return '—';
    case 'snd': case 'spaced ndash': case 'spnd': case 'spaced en dash': case 'dash': return ' – ';
    case 'spaced mdash': case 'spd': return ' — ';
    case 'dagger': case '†': return '†';
    case 'double-dagger': case 'double dagger': case '‡': return '‡';
    case '•': case 'dot': case 'middot': case '·': return ' · ';
    case 'flat': return '♭';
    case 'sharp': return '♯';
    case 'ya': case 'yes': case 'y': case 'tick': case 'check': case 'aye': case 'checkmark': return '✓';
    case 'lang': case 'langx': case 'lang-x': return pos[1] ?? '';
    case 'transl': case 'transliteration': return pos[pos.length - 1] ?? '';
    case 'nihongo': return pos[0] ?? '';
    case 'nowrap': case 'nobr': case 'small': case 'smaller': case 'larger': case 'big': case 'nobold': case 'noitalic':
    case 'center': case 'script': case 'ill': case 'interlanguage link': case 'illm': case 'visible anchor':
    case 'abbr': case 'sic': case 'nohyphens': case 'plain link': case 'no italic': case 'not a typo': case 'as written':
    case 'proper name': case 'var': case 'em': case 'strong': case 'nowrap begin': case 'sup': case 'sub': case 'underline':
    case 'u': case 'serif': case 'resize': case 'font': case 'font color': case 'color': case 'colored text': case 'mono':
    case 'bold': case 'b': case 'italic': case 'i': case 'noitalics': case 'keep together': case 'title case': case 'sc':
    case 'small caps': case 'smallcaps': case 'uc': case 'lc': case 'shy': case 'wbr': case 'hide': case 'plain': {
      if (name === 'resize' || name === 'font color' || name === 'color' || name === 'colored text') return pos[pos.length - 1] ?? '';
      if (name === 'font') return named.text ?? pos[0] ?? '';
      if (/^(?:ill|interlanguage link|illm)$/.test(name)) return named.lt ?? pos[0] ?? ''; // {{ill|Broadway Baby (song)|lt=Broadway Baby|de|…}}
      return pos[0] ?? '';
    }
    case 'hlist': case 'flatlist': case 'plainlist': case 'ubl': case 'unbulleted list': case 'bulleted list':
    case 'plain list': case 'ublist': case 'bulleted': case 'endflatlist': case 'startflatlist': case 'hidden':
    case 'collapsible list': case 'plain unbulleted list': {
      const items = (name === 'hidden' || name === 'collapsible list') ? pos.slice(1) : pos;
      return items.flatMap((x) => x.split(/\n\s*\*+\s*/)).map((x) => x.replace(/^\s*\*+\s*/, '').trim()).filter(Boolean).join(', ');
    }
    case 'based on': return pos.join(' by ');
    case 'music': case 'audio': return '';
    default:
      warn(`template:${name}`);
      return '';
  }
}

/**
 * [[Target|Label]] → Label, [[Target]] → Target (fragment dropped), files/categories dropped,
 * [url label] → label. onLink(target, label) is called for every wikilink.
 */
export function stripLinks(s, onLink) {
  s = s.replace(/\s*\[(?:sic|sic!|\?|citation needed)\]/gi, ''); // editorial brackets inside link labels
  // files/images/categories may contain nested links in their captions
  for (let pass = 0; pass < 3; pass++) {
    s = s.replace(/\[\[\s*(?:file|image|category|media)\s*:[^[\]]*(?:\[\[[^\]]*\]\][^[\]]*)*\]\]/gi, '');
  }
  s = s.replace(/\[\[\s*:?\s*([^[\]|]*)\|([^[\]]*)\]\]/g, (m, t, l) => { onLink?.(t.trim(), l.trim()); return l; });
  s = s.replace(/\[\[\s*:?\s*([^[\]|]*)\]\]/g, (m, t) => { onLink?.(t.trim(), t.trim()); return t.replace(/#.*$/, ''); });
  s = s.replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]*)\]/g, '$1').replace(/\[(?:https?:)?\/\/[^\s\]]+\]/g, '');
  return s;
}

/** Drop bold/italic quotes and presentational tags; <br> becomes " / ". */
export const stripFormatting = (s) => s
  .replace(/'''''|'''|''/g, '')
  .replace(/<nowiki>([\s\S]*?)<\/nowiki>/gi, '$1')
  .replace(/<nowiki\s*\/>/gi, '')
  .replace(/<br\s*\/?>|<\/br>/gi, ' / ')
  .replace(/<\/?(?:small|big|span|div|center|font|u|i|b|em|strong|s|del|ins|abbr|nowiki|poem|onlyinclude|includeonly|noinclude|sub|p|code|tt|var|mark|bdi|q|cite|li|ul|ol|hr)\b[^>]*>/gi, '');

const HEADING = /^(={2,6})\s*(.*?)\s*\1\s*$/;
/** Is this line a section heading? → { level, title } */
export function headingOf(line) {
  const m = line.match(HEADING);
  return m ? { level: m[1].length, title: m[2] } : null;
}

/**
 * Split an article into sections: [{ level, title, lines, idx }]; the lead is level 1 "(lead)".
 * Input should already be comment-stripped. Headings' own markup is cleaned for matching.
 */
export function sections(text) {
  const out = [];
  let cur = { level: 1, title: '(lead)', rawTitle: '', lines: [] };
  out.push(cur);
  for (const line of text.split('\n')) {
    const h = headingOf(line);
    if (h) {
      cur = { level: h.level, title: cleanHeading(h.title), rawTitle: h.title, lines: [] };
      out.push(cur);
    } else cur.lines.push(line);
  }
  out.forEach((s, i) => { s.idx = i; });
  return out;
}
export const cleanHeading = (t) => decodeEntities(stripFormatting(stripLinks(expandTemplates(stripRefs(t))))).replace(/\s+/g, ' ').trim();

/** Body of section i including its subsections; sub-headings are kept as heading lines. */
export function sectionBody(ss, i) {
  const s = ss[i]; const body = [...s.lines];
  for (let j = i + 1; j < ss.length && ss[j].level > s.level; j++) {
    const eq = '='.repeat(ss[j].level);
    body.push(`${eq} ${ss[j].title} ${eq}`, ...ss[j].lines);
  }
  return body;
}

/** Index of the nearest ancestor section (lower level) of section i, or -1. */
export function parentSection(ss, i) {
  for (let j = i - 1; j >= 0; j--) if (ss[j].level < ss[i].level) return j;
  return -1;
}

/** First {{Infobox …}} of the text → { type, fields } (fields keyed lowercase), or null. */
export function firstInfobox(text) {
  const re = /\{\{\s*infobox[ _]+([^\n|}]*)/gi;
  const m = re.exec(text);
  if (!m) return null;
  const end = findTemplateEnd(text, m.index);
  const raw = end > 0 ? text.slice(m.index, end) : text.slice(m.index);
  const params = splitParams(raw.slice(2, end > 0 ? -2 : undefined));
  params.shift();
  const fields = templateFields(params);
  return { type: m[1].trim().replace(/_/g, ' ').toLowerCase(), fields };
}

/** The {{Infobox musical}} (or play/opera) anywhere in the text → fields, or null. */
export function stageInfobox(text) {
  const re = /\{\{\s*infobox[ _]+(musical|play|opera|stage production|theatre production)\s*(?=[|\n}])/gi;
  const m = re.exec(text);
  if (!m) return null;
  const end = findTemplateEnd(text, m.index);
  if (end < 0) return null;
  const params = splitParams(text.slice(m.index + 2, end - 2));
  params.shift();
  return templateFields(params);
}

// ---------------------------------------------------------------------------------------------
// Wikitables
// ---------------------------------------------------------------------------------------------

const CELL_ATTR = /^\s*(?:style|class|rowspan|colspan|align|valign|width|height|scope|bgcolor|data-sort-value|data-sort-type|id|nowrap|abbr|headers|lang|dir|title)\b/i;
function cellContent(s) {
  const parts = splitParams(s);
  if (parts.length > 1 && (CELL_ATTR.test(parts[0]) || /^\s*[a-z-]+\s*=\s*["']?[^"'[\]{}]*["']?\s*$/i.test(parts[0]))) {
    return { attrs: parts[0], text: parts.slice(1).join('|') };
  }
  return { attrs: '', text: s };
}

/** Find the end line index of a table that starts at lines[k] ("{|"), honouring nesting. */
export function tableEnd(lines, k) {
  let depth = 0;
  for (let e = k; e < lines.length; e++) {
    if (/^\s*\{\|/.test(lines[e])) depth++;
    if (/^\s*\|\}/.test(lines[e])) { depth--; if (depth === 0) return e; }
  }
  return lines.length - 1;
}

/**
 * Parse a wikitable (lines from "{|" to "|}") into a grid honouring rowspan/colspan.
 * → { caption, grid: [{ cells: [{ raw, isHeader, rowspan, colspan, scopeRow, spanned }], allHeader, fullWidth }] }
 */
export function parseTable(lines) {
  const rows = []; let cur = null; let caption = '';
  const push = () => { if (cur && cur.cells.length) rows.push(cur); };
  let nested = 0;
  for (let k = 1; k < lines.length; k++) {
    const l = lines[k];
    if (nested > 0) { // nested table: keep inside the current cell
      if (/^\s*\{\|/.test(l)) nested++;
      if (/^\s*\|\}/.test(l)) nested--;
      if (cur?.cells.length) cur.cells[cur.cells.length - 1].raw += '\n' + l;
      continue;
    }
    if (/^\s*\{\|/.test(l)) { nested = 1; if (cur?.cells.length) cur.cells[cur.cells.length - 1].raw += '\n' + l; continue; }
    if (/^\s*\|\}/.test(l)) break;
    if (/^\s*\|\+/.test(l)) { caption = l.replace(/^\s*\|\+/, '').trim(); continue; }
    if (/^\s*\|-/.test(l)) { push(); cur = { cells: [] }; continue; }
    if (!cur) cur = { cells: [] };
    const m = l.match(/^\s*([!|])(.*)$/);
    if (!m) { if (cur.cells.length) cur.cells[cur.cells.length - 1].raw += '\n' + l; continue; }
    const isHeader = m[1] === '!';
    const pieces = []; let depth = 0; let buf = ''; const body = m[2];
    for (let i = 0; i < body.length; i++) {
      const c2 = body.slice(i, i + 2);
      if (c2 === '{{' || c2 === '[[') { depth++; buf += c2; i++; continue; }
      if ((c2 === '}}' || c2 === ']]') && depth > 0) { depth--; buf += c2; i++; continue; }
      if (depth === 0 && (c2 === '||' || (isHeader && c2 === '!!'))) { pieces.push(buf); buf = ''; i++; continue; }
      buf += body[i];
    }
    pieces.push(buf);
    for (const p of pieces) {
      const { attrs, text } = cellContent(p);
      cur.cells.push({
        raw: text.trim(), isHeader,
        rowspan: Math.min(+(attrs.match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] || 1), 200),
        colspan: Math.min(+(attrs.match(/colspan\s*=\s*["']?(\d+)/i)?.[1] || 1), 50),
        scopeRow: /scope\s*=\s*["']?row/i.test(attrs),
      });
    }
  }
  push();
  const grid = []; const pending = [];
  for (const r of rows) {
    const out = []; let col = 0; const cells = [...r.cells];
    while (cells.length || pending.slice(col).some((p) => p && p.left > 0)) {
      if (pending[col] && pending[col].left > 0) { out[col] = { ...pending[col].cell, spanned: true }; pending[col].left--; col++; continue; }
      const c = cells.shift();
      if (!c) { col++; if (col > 60) break; continue; }
      for (let s = 0; s < c.colspan; s++) {
        out[col + s] = { ...c, spanned: s > 0 };
        pending[col + s] = c.rowspan > 1 ? { cell: c, left: c.rowspan - 1 } : null;
      }
      col += c.colspan;
    }
    grid.push({
      cells: out,
      allHeader: r.cells.every((c) => c.isHeader),
      fullWidth: r.cells.length === 1 && r.cells[0].colspan > 1,
    });
  }
  return { caption, grid };
}
