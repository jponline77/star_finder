// Vandalism gate + readable diff (src/review-gate.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCatalogs, renderDiff, suspiciousText } from '../src/review-gate.js';

const song = (title, singers = [], extra = {}) => ({
  title, act: 1, position: 1, singers, singersRaw: singers.join(' and '), ensemble: false, reprise: false, instrumental: false, ...extra,
});
const show = (key, title, songs, extra = {}) => ({
  key, title, altTitles: [], wikiTitle: title, wikidataId: key, composer: 'A Composer', lyricist: null, bookWriter: null, year: 2000,
  genres: [], description: 'musical', characters: [], songs, ...extra,
});
const doc = (version, shows) => ({ version, shows });

test('suspiciousText: obvious vandalism is flagged', () => {
  assert.deepEqual(suspiciousText('Defying Gravity'), []);
  assert.match(suspiciousText('Mr Jones is gay lol').join(), /word/);
  assert.match(suspiciousText('Bring Him Home shit').join(), /word "shit"/);
  assert.match(suspiciousText('Visit www.example.com').join(), /link/);
  assert.match(suspiciousText('write me at kid@example.org').join(), /link/);
  assert.match(suspiciousText('Tomorrow aaaaaaaaaaa').join(), /run of one letter/);
  assert.match(suspiciousText('Tomorrow hahahahaha').join(), /run of one letter/);
  assert.match(suspiciousText('asdfgh').join(), /keyboard/);
  assert.match(suspiciousText('Memory 💩').join(), /emoji/);
  assert.match(suspiciousText('THIS SHOW TOTALLY STINKS').join(), /shouting/);
  const long = 'Ab cd '.repeat(40);
  assert.match(suspiciousText(long).join(), /very long/);
  assert.deepEqual(suspiciousText(long, { long: false }), []);
});

test('suspiciousText: real titles and credits that a naive filter would trip on pass', () => {
  for (const t of ['Glitter and Be Gay', 'Noel Gay', 'Dick Vosburgh', 'Nanki-Poo', 'Who killed Cock Robin?', 'It Sucks to Be Me',
    'Prelude in G♯ minor, op. 32 no. 12', 'HMS Pinafore', 'Ooooooh Bop', 'I Love You', 'If You Were Here', 'Holy Musical B@man!',
    'Harmony, Not Discord', 'Stupid with Love', 'American Idiot', 'Springtime for Hitler']) {
    assert.deepEqual(suspiciousText(t), [], t);
  }
});

test('compareCatalogs: no previous catalog → nothing compared or flagged', () => {
  const r = compareCatalogs(null, doc('2026-01-01.1', [show('Q1', 'A', [song('Shit Happens')])]));
  assert.equal(r.flags.length, 0);
  assert.equal(r.shows.length, 0);
});

test('compareCatalogs: text already in the previous catalog is not flagged again; new or changed text is', () => {
  const prev = doc('2026-01-01.1', [
    show('Q1', 'Spring Awakening', [song('Totally Fucked', ['Melchior'])]),
    show('Q2', 'Wicked', [song('Popular', ['Glinda']), song('Defying Gravity', ['Elphaba'])]),
  ]);
  const next = doc('2026-01-01.2', [
    show('Q1', 'Spring Awakening', [song('Totally Fucked', ['Melchior'])]),
    show('Q2', 'Wicked', [song('Popular', ['Glinda']), song('Defying Gravity', ['Elphaba']), song('Glinda is gay lol', ['Glinda'])],
      { composer: 'Stephen Schwartz www.spam.example.com' }),
  ]);
  const r = compareCatalogs(prev, next);
  assert.equal(r.flags.length, 2);
  assert.deepEqual(r.flags.map((f) => f.what).sort(), ['composer', 'song title']);
  assert.ok(r.flags.every((f) => f.key === 'Q2'));
  assert.deepEqual(r.summary, { showsAdded: 0, showsRemoved: 0, showsChanged: 1, songsAdded: 1, songsRemoved: 0, songsChanged: 0 });
});

test('compareCatalogs: changed singers are listed and checked', () => {
  const prev = doc('a', [show('Q1', 'Hadestown', [song('Wait for Me', ['Orpheus', 'Hermes'])])]);
  const next = doc('b', [show('Q1', 'Hadestown', [song('Wait for Me', ['Orpheus', 'Poopy Pants'])])]);
  const r = compareCatalogs(prev, next);
  assert.equal(r.summary.songsChanged, 1);
  assert.equal(r.flags.length, 1);
  assert.match(r.flags[0].what, /singers of “Wait for Me”/);
  assert.match(renderDiff(r), /~ Wait for Me: sung by Orpheus, Hermes → Orpheus, Poopy Pants/);
});

test('compareCatalogs: a mostly blanked song list and a shrinking catalog are flagged', () => {
  const many = Array.from({ length: 10 }, (_, i) => song(`Song ${i + 1}`));
  const prev = doc('a', [show('Q1', 'Les Misérables', many)]);
  const next = doc('b', [show('Q1', 'Les Misérables', many.slice(0, 2))]);
  const r = compareCatalogs(prev, next);
  assert.equal(r.flags.length, 1);
  assert.deepEqual(r.flags[0].reasons, ['song list mostly removed']);
  assert.equal(r.summary.songsRemoved, 8);

  // an ordinary edit (a couple of songs renamed) is not a blanking
  const edited = [...many.slice(0, 8), song('Song 9 (Reprise)'), song('New Song')];
  assert.equal(compareCatalogs(prev, doc('c', [show('Q1', 'Les Misérables', edited)])).flags.length, 0);

  const big = Array.from({ length: 200 }, (_, i) => show(`Q${i}`, `Show ${i}`, [song('A')]));
  const shrunk = compareCatalogs(doc('a', big), doc('b', big.slice(0, 150)));
  assert.ok(shrunk.flags.some((f) => f.what === 'size'));
  assert.equal(shrunk.summary.showsRemoved, 50);
});

test('renderDiff: readable summary with added, removed and changed shows', () => {
  const prev = doc('2026-01-01.1', [show('Q1', 'Old Show', [song('Gone')]), show('Q2', 'Kept', [song('One'), song('Two')])]);
  const next = doc('2026-01-01.2', [show('Q2', 'Kept', [song('One'), song('Three')], { year: 2001 }), show('Q3', 'New Show', [song('Hello')])]);
  const text = renderDiff(compareCatalogs(prev, next));
  assert.match(text, /^Catalog 2026-01-01\.1 → 2026-01-01\.2/);
  assert.match(text, /- Old Show \(Q1\) — removed \(had 1 song\(s\)\)/);
  assert.match(text, /\+ New Show \(Q3\) — new show, 1 song\(s\)/);
  assert.match(text, /~ Kept \(Q2\)\n {4}year: 2000 → 2001\n {4}\+ Three\n {4}- Two/);
  assert.doesNotMatch(text, /NEEDS REVIEW/);
});
