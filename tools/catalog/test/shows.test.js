// Show selection rules and show-record assembly (titles, credits, years, genres, alt titles), and
// the output-format validator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, decideFallback, kindOf } from '../src/rules.js';
import {
  displayTitle, creditNames, joinNames, groupStatements, wikidataYear, categoryYear, genresOf, altTitlesOf,
} from '../src/shows.js';
import { validateCatalog } from '../src/format.js';
import { parsed } from './helpers.js';

const flags = {
  Q58483083: { isStage: true }, Q11424: { isFilm: true }, Q506240: { isFilm: true }, Q5398426: { isTV: true },
};

test('decide: stage works in, films/TV/songs/people/albums out, title rescue', () => {
  assert.deepEqual(decide({ enwiki: 'Hamilton (musical)', p31: 'Q58483083', forms: 'Q2743' }, flags), { include: true, kind: 'musical', reason: 'stage-class' });
  assert.equal(decide({ enwiki: 'The Pirates of Penzance', p31: 'Q58483083', forms: 'Q170384' }, flags).kind, 'operetta');
  assert.equal(decide({ enwiki: "Ain't Misbehavin' (musical)", p31: 'Q58483083', forms: 'Q918727' }, flags).kind, 'revue');
  assert.equal(decide({ enwiki: 'Katyar Kaljat Ghusali', p31: 'Q58483083 Q11424' }, flags).include, false); // also a film
  assert.equal(decide({ enwiki: 'Memory (song)', p31: 'Q7366' }, flags).include, false);
  assert.equal(decide({ enwiki: 'Tommy (album)', p31: 'Q58483083' }, flags).include, false);
  assert.equal(decide({ enwiki: 'Lin-Manuel Miranda', p31: 'Q5' }, flags).include, false);
  assert.equal(decide({ enwiki: 'Calendar Girls (musical)', p31: 'Q11424' }, flags).include, true); // strong title rescue
  assert.equal(decide({ enwiki: 'Lovestruck: The Musical', p31: 'Q506240' }, flags).include, false); // "the musical" but a TV film
  assert.equal(decide({ enwiki: 'Bring It On: The Musical', p31: '' }, flags).include, true);
  assert.equal(decide({ enwiki: 'List of musicals', p31: 'Q13406463' }, flags).include, false);
});

test('decideFallback: category-only articles', () => {
  assert.equal(decideFallback('The Grim Goblin', null, flags).include, true);
  assert.equal(decideFallback('Some Film (1936 film)', null, flags).include, false);
  assert.equal(decideFallback('X', { p31: 'Q11424', desc: '1936 film' }, flags).include, false);
  assert.equal(decideFallback('X', { p31: '', desc: '1936 musical film by Y' }, flags).include, false);
  assert.equal(decideFallback('X', { p31: '', desc: 'stage musical based on the film' }, flags).include, true);
  assert.equal(decideFallback('X', { p31: 'Q58483083', desc: 'opera' }, flags, { excludedByRules: true }).include, false);
  assert.equal(decideFallback('X (musical)', { p31: 'Q11424' }, flags, { excludedByRules: true }).include, true);
  assert.equal(decideFallback('List of Broadway musicals', null, flags).include, false);
  assert.equal(kindOf([], [], '1890 comic opera'), 'operetta');
});

test('displayTitle', () => {
  assert.equal(displayTitle('Aladdin (2011 musical)'), 'Aladdin');
  assert.equal(displayTitle('Les Misérables (musical)'), 'Les Misérables');
  assert.equal(displayTitle('Dédé (opérette)'), 'Dédé');
  assert.equal(displayTitle('Heathers: The Musical'), 'Heathers: The Musical');
  assert.equal(displayTitle('Antigone (Honegger)', 'Antigone'), 'Antigone');
  assert.equal(displayTitle('Two Strangers (Carry a Cake Across New York)', 'Two Strangers (Carry a Cake Across New York)'), 'Two Strangers (Carry a Cake Across New York)');
  assert.equal(displayTitle('(I Am) Nobody\'s Lunch'), "(I Am) Nobody's Lunch");
});

test('creditNames: English lyricist preferred, notes and roles dropped', () => {
  assert.deepEqual(creditNames('Alain Boublil (French)<br>Jean-Marc Natel (French)<br>[[Herbert Kretzmer]] (English)', { preferEnglish: true }), ['Herbert Kretzmer']);
  assert.deepEqual(creditNames('[[Benny Andersson]]<br>[[Björn Ulvaeus]]'), ['Benny Andersson', 'Björn Ulvaeus']);
  assert.deepEqual(creditNames('[[Bob Gaudio]] and [[Bob Crewe]]<ref group="Note">x</ref>'), ['Bob Gaudio', 'Bob Crewe']);
  assert.deepEqual(creditNames('{{Plainlist|\n* [[Toby Marlow]]\n* [[Lucy Moss]]\n}}'), ['Toby Marlow', 'Lucy Moss']);
  assert.deepEqual(creditNames('[[Murray Horwitz]] and [[Richard Maltby Jr.]]'), ['Murray Horwitz', 'Richard Maltby Jr.']);
  assert.deepEqual(creditNames('[[Harry Connick, Jr.]]'), ['Harry Connick, Jr.']);
  assert.deepEqual(creditNames('Max Martin<br>others<br>Arranged by: Bill Sherman'), ['Max Martin']); // (& Juliet: "Max Martin and others" → Max Martin)
  assert.deepEqual(creditNames('arrangements by Brett Foster'), []);
  assert.deepEqual(creditNames('Aurin Squire<br>Story by<br>Christopher Renshaw'), ['Aurin Squire', 'Christopher Renshaw']);
  assert.deepEqual(creditNames('[[Michael Kunze]] (German book, English book)<br>[[Christopher Hampton]]'), ['Michael Kunze', 'Christopher Hampton']);
  assert.deepEqual(creditNames('Lyrics: [[Tim Rice]]'), ['Tim Rice']);
  assert.deepEqual(creditNames('Jan Dargatz (with additional dialogue'), ['Jan Dargatz']);
  assert.equal(joinNames(['A', 'B']), 'A, B');
  assert.equal(joinNames(['A', 'and others']), 'A and others');
  assert.equal(joinNames(['A', 'B', 'C', 'D', 'E', 'F', 'G']), 'A, B, C, D, E, F and others');
  assert.equal(joinNames([]), null);
});

test('credits from real infoboxes', () => {
  const lm = parsed('Les Misérables (musical)').infobox;
  assert.deepEqual(creditNames(lm.lyrics, { preferEnglish: true }), ['Herbert Kretzmer']);
  assert.deepEqual(creditNames(parsed('Aladdin (2011 musical)').infobox.lyrics), ['Howard Ashman', 'Tim Rice', 'Chad Beguelin']);
  assert.deepEqual(creditNames(parsed('Guys and Dolls').infobox.book), ['Jo Swerling', 'Abe Burrows']);
});

test('Wikidata statements → years; categories → years', () => {
  const st = groupStatements([
    { item: 'Q1', prop: 'firstPerf', v: '1990-01-01T00:00:00Z', precision: '9', rank: 'http://wikiba.se/ontology#NormalRank' },
    { item: 'Q1', prop: 'firstPerf', v: '2004-01-01T00:00:00Z', precision: '11', rank: 'http://wikiba.se/ontology#NormalRank' },
    { item: 'Q1', prop: 'inception', v: '1985-00-00T00:00:00Z', precision: '8', rank: 'http://wikiba.se/ontology#NormalRank' }, // decade: ignored
    { item: 'Q1', prop: 'composer', v: 'Q20', vLabel: 'B', rank: 'x#NormalRank' },
    { item: 'Q1', prop: 'composer', v: 'Q3', vLabel: 'A', rank: 'x#NormalRank' },
  ]);
  assert.equal(wikidataYear(st), 1990);
  assert.deepEqual(st.composer.map((x) => x.label), ['A', 'B']); // QID order
  assert.equal(categoryYear(['2015 musicals', 'Broadway musicals', '2016 musicals']), 2015);
  assert.equal(categoryYear(['Broadway musicals']), null);
});

test('genresOf: useful Wikidata values + categories + kind', () => {
  const st = { form: [{ v: 'Q2743', label: 'musical' }, { v: 'Q643684', label: 'jukebox musical' }], genre: [{ v: 'Q1', label: 'drama film' }, { v: 'Q40831', label: 'comedy' }] };
  assert.deepEqual(genresOf({ st, kind: 'musical', categories: ['Sung-through musicals', 'Rock musicals', '2001 musicals'] }), ['comedy', 'jukebox musical', 'rock musical', 'sung-through']);
  assert.deepEqual(genresOf({ kind: 'operetta' }), ['operetta']);
});

test('altTitlesOf: Wikidata aliases, "the Musical" variant, filtered redirects', () => {
  assert.deepEqual(altTitlesOf({
    title: 'Les Misérables', wikiTitle: 'Les Misérables (musical)', wdLabels: ['Les Misérables'], wdAliases: ['Les Mis', 'Les Miz'],
    redirects: ['Les mis musical', 'Les Miserables (musical)', 'Bring Him Home (song)', 'Valjean', 'Jeb! The Musical', 'LM', 'On My Own'],
    songTitles: ['On My Own'], characterNames: ['Jean Valjean', 'Valjean'],
  }), ['Les Mis', 'Les Miz', 'LM']);
  assert.deepEqual(altTitlesOf({ title: 'Shrek the Musical', wikiTitle: 'Shrek the Musical', wdLabels: [], wdAliases: [], redirects: [] }), ['Shrek']);
  assert.deepEqual(altTitlesOf({ title: 'Wicked', wikiTitle: 'Wicked (musical)', redirects: ['Wicked play', 'Wicked the musical', 'Wicked (Broadway)'] }), []);
});

const goodDoc = () => ({
  version: '2026-09-27.1', generatedAt: '2026-09-27T10:00:00.000Z', sources: { wikidata: 'Wikidata', wikipedia: 'Wikipedia' },
  shows: [{
    key: 'Q1', title: 'T', altTitles: [], wikiTitle: 'T (musical)', wikidataId: 'Q1', composer: null, lyricist: null, bookWriter: null,
    year: 2000, genres: ['revue'], description: null, characters: [{ name: 'A', voiceType: null }],
    songs: [{ title: 'S', act: 1, position: 1, singers: ['A'], singersRaw: 'A', ensemble: false, reprise: false, instrumental: false }],
  }],
});

test('validateCatalog accepts the SPEC format and rejects violations', () => {
  assert.deepEqual(validateCatalog(goodDoc()), []);
  const bad = (f) => { const d = goodDoc(); f(d); return validateCatalog(d); };
  assert.ok(bad((d) => { d.version = '2026-09-27'; }).length);
  assert.ok(bad((d) => { d.shows[0].extra = 1; }).length);
  assert.ok(bad((d) => { d.shows[0].songs.push({ ...d.shows[0].songs[0], position: 2, title: 's' }); }).some((e) => /duplicate/.test(e)));
  assert.ok(bad((d) => { Object.assign(d.shows[0].songs[0], { instrumental: true }); }).some((e) => /instrumental/.test(e)));
  assert.ok(bad((d) => { d.shows[0].songs[0].position = 5; }).length);
  assert.ok(bad((d) => { d.shows[0].genres = ['Revue']; }).length);
  assert.ok(bad((d) => { d.shows[0].key = 'Q2'; }).length);
  assert.ok(bad((d) => { d.shows.push({ ...d.shows[0] }); }).some((e) => /duplicate key/.test(e)));
});
