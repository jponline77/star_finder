// Vandalism gate + readable diff between the catalog being replaced and the new build.
//
// Everything in the catalog comes from live Wikipedia/Wikidata pages that anyone can edit, and the site shows
// catalog text to students. A build right after someone vandalised a song list would ship that text to every
// server on its next restart. So before the seed file is overwritten, the build compares the new content with the
// file it replaces and
//   - writes a readable diff (shows added/removed, credits changed, songs added/removed/renamed, singers changed)
//     to tools/catalog/.cache/diff-<version>.txt, so a maintainer can review a rebuild instead of a gzip blob;
//   - flags NEW or CHANGED text that looks like vandalism: profanity or slurs, links/e-mail/handles, "x sucks"
//     style insults, keyboard mashing, very long runs of one letter, emoji — and song lists that were mostly
//     blanked (a show that loses most of its songs) or a catalog that shrinks a lot.
// Flags only look at what changed, so a show whose real song titles contain a swear word (the text was already in
// the previous catalog) is not flagged again. With flags, the build stops without writing the catalog (exit 2);
// a maintainer checks each flagged line against the article (review.json has the revision ids) and runs the build
// again with --accept-review.
import { fold } from './normalize.js';

// Whole words only (after folding accents/case). Deliberately narrow and high-signal: stage titles and credits are
// full of words a naive filter would trip on ("Glitter and Be Gay", Noel Gay, Dick Vosburgh, Nanki-Poo, "Cock
// Robin", Avenue Q's "It Sucks to Be Me", Spring Awakening's "Totally Fucked"), and existing text is never flagged
// again anyway — the gate is a tripwire for obvious vandalism in what changed, not a content rating.
const PROFANITY = [
  'fuck', 'fucks', 'fucking', 'fucked', 'fucker', 'fuckers', 'motherfucker', 'motherfucking', 'shit', 'shits', 'shitty',
  'bullshit', 'cunt', 'cunts', 'twat', 'wanker', 'jizz', 'penis', 'penises', 'vagina', 'dildo', 'blowjob', 'handjob',
  'poop', 'poopy', 'poops', 'lol', 'lmao', 'lmfao', 'rofl', 'stfu', 'noob', 'skibidi', 'rizz', 'sigma', 'gyatt',
  'nigger', 'niggers', 'nigga', 'niggas', 'faggot', 'faggots', 'fag', 'fags', 'retard', 'retarded', 'retards',
  'kike', 'kikes', 'tranny',
];
// Typical vandal phrases ("Mr Smith is gay", "hacked by …"; not "was here" or "I love you" — real song titles).
const PHRASES = ['is gay', 'are gay', 'so gay', 'hacked by', 'your mom', 'ur mom', 'yo mama', 'suck my',
  'sucks balls', 'is a loser', 'is stupid', 'is an idiot', 'is dumb', 'is fat', 'smells bad'];
const PROFANITY_RE = new RegExp(`(^|[^a-z0-9])(${[...PROFANITY, ...PHRASES.map((p) => p.replace(/ /g, '\\s+'))].join('|')})(?=$|[^a-z0-9])`);
const LINK_RE = /(https?:\/\/|www\.|\.(com|net|org|io|gg|ly|tk|xyz|ru|cn)\b|(^|\s)@[a-z0-9_]{3,}|discord\.gg|tiktok\.|onlyfans|t\.me\/|bit\.ly)/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const REPEAT_RE = /([a-z])\1{7,}|\b(ha){4,}\b|\b(lo){3,}l\b/i; // "aaaaaaaa", "hahahaha", "lololol"
const MASH_RE = /\b(asdf|qwert|zxcv|hjkl|jkjk|lkjh|ghjk|sdfg|dfgh)/i;
const EMOJI_RE = /\p{Emoji_Presentation}/u;
const SHOUT_RE = /\b[A-Z]{4,}(\s+[A-Z]{4,}){3,}\b/; // 4+ words of 4+ capitals in a row (not "HMS", "USA", "No. IV")

/** Reasons a piece of catalog text looks like vandalism ([] if none). */
export function suspiciousText(text, { long = true } = {}) {
  const s = String(text ?? '');
  if (!s) return [];
  const out = [];
  const f = fold(s);
  const m = f.match(PROFANITY_RE);
  if (m) out.push(`word "${m[2]}"`);
  if (LINK_RE.test(s) || EMAIL_RE.test(s)) out.push('link / e-mail / handle');
  if (REPEAT_RE.test(s)) out.push('run of one letter');
  if (MASH_RE.test(f)) out.push('keyboard mashing');
  if (EMOJI_RE.test(s)) out.push('emoji');
  if (SHOUT_RE.test(s)) out.push('shouting');
  if (long && s.length > 200) out.push('very long');
  return out;
}

const songKey = (g) => `${fold(g.title)}|${g.reprise ? 1 : 0}`;
const SHOW_FIELDS = ['title', 'composer', 'lyricist', 'bookWriter', 'year', 'description'];
const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : String(v));

/**
 * Compare two catalog documents ({ shows }) → { summary, shows: [...per-show changes], flags: [...] }.
 * `prev` may be null (first build): then nothing is compared and nothing is flagged.
 * @param {{ shows: object[], version?: string } | null} prev
 * @param {{ shows: object[], version?: string }} next
 */
export function compareCatalogs(prev, next) {
  const result = {
    from: prev?.version ?? null,
    to: next.version ?? null,
    summary: { showsAdded: 0, showsRemoved: 0, showsChanged: 0, songsAdded: 0, songsRemoved: 0, songsChanged: 0 },
    shows: [],
    flags: [],
  };
  if (!prev) return result;
  const flag = (show, what, text, reasons) => result.flags.push({ key: show.key, show: show.title, wikiTitle: show.wikiTitle ?? null, what, text, reasons });
  const checkText = (show, what, text, opts) => {
    const reasons = suspiciousText(text, opts);
    if (reasons.length) flag(show, what, text, reasons);
  };
  const prevByKey = new Map(prev.shows.map((s) => [s.key, s]));
  const nextKeys = new Set(next.shows.map((s) => s.key));

  for (const show of next.shows) {
    const old = prevByKey.get(show.key);
    if (!old) {
      result.summary.showsAdded++;
      result.shows.push({ key: show.key, title: show.title, change: 'added', songs: show.songs.length });
      for (const f of ['title', 'composer', 'lyricist', 'bookWriter', 'description']) checkText(show, f, show[f]);
      for (const t of show.altTitles ?? []) checkText(show, 'alt title', t);
      for (const c of show.characters ?? []) checkText(show, 'character', c.name);
      for (const g of show.songs) {
        checkText(show, 'song title', g.title);
        checkText(show, `singers of “${g.title}”`, g.singersRaw, { long: false });
      }
      continue;
    }
    const entry = { key: show.key, title: show.title, change: 'changed', fields: [], added: [], removed: [], singers: [] };
    for (const f of SHOW_FIELDS) {
      if (fmt(old[f]) !== fmt(show[f])) {
        entry.fields.push({ field: f, from: fmt(old[f]), to: fmt(show[f]) });
        if (typeof show[f] === 'string') checkText(show, f, show[f]);
      }
    }
    const oldAlt = new Set((old.altTitles ?? []).map(fold));
    for (const t of show.altTitles ?? []) if (!oldAlt.has(fold(t))) { entry.fields.push({ field: 'alt title', from: '—', to: t }); checkText(show, 'alt title', t); }
    const oldChars = new Set((old.characters ?? []).map((c) => fold(c.name)));
    for (const c of show.characters ?? []) if (!oldChars.has(fold(c.name))) checkText(show, 'character', c.name);

    const oldSongs = new Map(old.songs.map((g) => [songKey(g), g]));
    const newSongs = new Map(show.songs.map((g) => [songKey(g), g]));
    for (const [k, g] of newSongs) {
      const o = oldSongs.get(k);
      if (!o) {
        entry.added.push(g.title + (g.reprise ? ' (reprise)' : ''));
        checkText(show, 'song title', g.title);
        checkText(show, `singers of “${g.title}”`, g.singersRaw, { long: false });
      } else if (fmt(o.singers) !== fmt(g.singers)) {
        entry.singers.push({ title: g.title, from: fmt(o.singers), to: fmt(g.singers) });
        if (fold(o.singersRaw ?? '') !== fold(g.singersRaw ?? '')) checkText(show, `singers of “${g.title}”`, g.singersRaw, { long: false });
      }
    }
    for (const [k, g] of oldSongs) if (!newSongs.has(k)) entry.removed.push(g.title + (g.reprise ? ' (reprise)' : ''));
    // A song list that was mostly blanked (page-blanking vandalism, or a section someone deleted).
    const kept = old.songs.filter((g) => newSongs.has(songKey(g))).length;
    if (old.songs.length >= 6 && show.songs.length < old.songs.length / 2 && kept < old.songs.length / 2) {
      flag(show, 'song list', `${old.songs.length} songs → ${show.songs.length}`, ['song list mostly removed']);
    }
    if (entry.fields.length || entry.added.length || entry.removed.length || entry.singers.length) {
      result.summary.showsChanged++;
      result.summary.songsAdded += entry.added.length;
      result.summary.songsRemoved += entry.removed.length;
      result.summary.songsChanged += entry.singers.length;
      result.shows.push(entry);
    }
  }
  for (const old of prev.shows) {
    if (nextKeys.has(old.key)) continue;
    result.summary.showsRemoved++;
    result.shows.push({ key: old.key, title: old.title, change: 'removed', songs: old.songs.length });
  }
  const prevSongs = prev.shows.reduce((n, s) => n + s.songs.length, 0);
  const nextSongs = next.shows.reduce((n, s) => n + s.songs.length, 0);
  if (prev.shows.length >= 100 && (next.shows.length < prev.shows.length * 0.9 || nextSongs < prevSongs * 0.9)) {
    result.flags.push({ key: null, show: '(whole catalog)', wikiTitle: null, what: 'size', text: `${prev.shows.length} shows / ${prevSongs} songs → ${next.shows.length} / ${nextSongs}`, reasons: ['catalog shrank by more than 10%'] });
  }
  return result;
}

/** The comparison as plain text (for .cache/diff-<version>.txt and the console). */
export function renderDiff(cmp, { maxShows = Infinity } = {}) {
  const s = cmp.summary;
  const lines = [
    `Catalog ${cmp.from ?? '(none)'} → ${cmp.to ?? '(new)'}`,
    `Shows: +${s.showsAdded} added, -${s.showsRemoved} removed, ${s.showsChanged} changed. Songs: +${s.songsAdded} added, -${s.songsRemoved} removed, ${s.songsChanged} with different singers.`,
    '',
  ];
  if (cmp.flags.length) {
    lines.push(`NEEDS REVIEW — ${cmp.flags.length} change(s) look like possible vandalism:`);
    for (const f of cmp.flags) lines.push(`  ! ${f.show}${f.wikiTitle && f.wikiTitle !== f.show ? ` [${f.wikiTitle}]` : ''} — ${f.what}: “${f.text}” (${f.reasons.join(', ')})`);
    lines.push('');
  }
  const order = { removed: 0, added: 1, changed: 2 };
  const shows = [...cmp.shows].sort((a, b) => order[a.change] - order[b.change] || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  let n = 0;
  for (const e of shows) {
    if (n++ >= maxShows) { lines.push(`  … and ${shows.length - maxShows} more show(s)`); break; }
    if (e.change === 'added') { lines.push(`+ ${e.title} (${e.key}) — new show, ${e.songs} song(s)`); continue; }
    if (e.change === 'removed') { lines.push(`- ${e.title} (${e.key}) — removed (had ${e.songs} song(s))`); continue; }
    lines.push(`~ ${e.title} (${e.key})`);
    for (const f of e.fields) lines.push(`    ${f.field}: ${f.from} → ${f.to}`);
    for (const t of e.added) lines.push(`    + ${t}`);
    for (const t of e.removed) lines.push(`    - ${t}`);
    for (const x of e.singers) lines.push(`    ~ ${x.title}: sung by ${x.from} → ${x.to}`);
  }
  return lines.join('\n') + '\n';
}
