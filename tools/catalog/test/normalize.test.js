// Normaliser units: separators, titles (medleys, reprises, notes), footnote markers, singers, dedupe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  norm, fold, cleanInline, stripMarkers, findSeparator, parseTitle, parseSingers, finalizeSongs, songKey, isGroupName,
} from '../src/normalize.js';
import { fakeCtx } from './helpers.js';

const sepText = (s) => { const m = findSeparator(s); return m ? [s.slice(0, m.start).trim(), s.slice(m.end).trim()] : null; };

test('norm / fold', () => {
  assert.equal(norm('Do You Hear the People Sing?'), 'do you hear the people sing');
  assert.equal(norm('Les Misérables'), 'les miserables');
  assert.equal(norm("Don't Rain on My Parade"), 'dont rain on my parade');
  assert.equal(norm('Sun & Moon'), 'sun and moon');
  assert.equal(fold('Ōkami — 大神'), 'okami 大神');
});

test('cleanInline: links, formatting, entities, curly quotes, <sup> markers', () => {
  const links = [];
  assert.equal(cleanInline("''[[Il Muto (opera)|Il Muto]]''&nbsp;– [[Carlotta]]<sup>†</sup>", links), 'Il Muto – Carlotta');
  assert.deepEqual(links.map((l) => l.target), ['Il Muto (opera)', 'Carlotta']);
  assert.equal(cleanInline('“Maybe”'), '"Maybe"');
  assert.equal(cleanInline('A<br/>B'), 'A / B');
  assert.equal(cleanInline('[[File:X.svg|20px]]Song'), 'Song');
});

test('stripMarkers keeps "#" and removes daggers / asterisks next to words', () => {
  assert.equal(stripMarkers('"Fearless"* – Witch**'), '"Fearless" – Witch');
  assert.equal(stripMarkers('Cabinet Battle #1 †'), 'Cabinet Battle #1');
  assert.equal(stripMarkers('Song (*) – A'), 'Song – A');
});

test('findSeparator: dash kinds, quotes and parentheses', () => {
  assert.deepEqual(sepText('"Maybe" – Annie'), ['"Maybe"', 'Annie']);
  assert.deepEqual(sepText('"Maybe" - Annie'), ['"Maybe"', 'Annie']);
  assert.deepEqual(sepText('"Maybe" -- Annie'), ['"Maybe"', 'Annie']);
  assert.deepEqual(sepText('"Maybe" — Annie'), ['"Maybe"', 'Annie']);
  assert.deepEqual(sepText('"St. Bridget" − Young Patrick'), ['"St. Bridget"', 'Young Patrick']);
  assert.deepEqual(sepText('"Kim & Engineer"– Kim'), ['"Kim & Engineer"', 'Kim']);
  assert.equal(findSeparator('"Ces soirées-là (Oh What a Night) - Paris, 2000"'), null);
  assert.equal(findSeparator('"Tick-Tock"'), null);
  assert.equal(findSeparator('Mother-in-law'), null);
  assert.deepEqual(sepText('"Entr\'acte – Orchestra'), ['"Entr\'acte', 'Orchestra']); // odd quote count: no quote tracking
  assert.deepEqual(sepText('"Song (A – B)" – C'), ['"Song (A – B)"', 'C']);
});

test('parseTitle: quoted titles, medleys and reprises', () => {
  const ctx = fakeCtx();
  assert.equal(parseTitle('"Maybe"', ctx).title, 'Maybe');
  const med = parseTitle('"Tonight" / "Jet Song"', ctx);
  assert.equal(med.title, 'Tonight / Jet Song'); assert.equal(med.medley, true); assert.equal(med.reprise, false);
  const r1 = parseTitle('"Maybe" (Reprise)', ctx);
  assert.equal(r1.title, 'Maybe'); assert.equal(r1.reprise, true);
  const r2 = parseTitle('"Waving Through a Window (Reprise #2)"', ctx);
  assert.equal(r2.title, 'Waving Through a Window'); assert.equal(r2.reprise, true);
  const r3 = parseTitle('"Prince Ali (Jafar Reprise)"', ctx);
  assert.equal(r3.title, 'Prince Ali (Jafar Reprise)'); assert.equal(r3.reprise, true);
  const r4 = parseTitle('"Changing Lives (Mini-Reprise)"', ctx); // a qualified reprise keeps the source wording
  assert.equal(r4.title, 'Changing Lives (Mini-Reprise)'); assert.equal(r4.reprise, true);
  assert.equal(r2.repriseNo, 2); // the source's reprise number is kept for naming
  assert.equal(parseTitle('"Carrying the Banner" (reprise II)', ctx).repriseNo, 2);
  assert.equal(parseTitle('"Maybe" (second reprise)', ctx).repriseNo, 2);
  const r5 = parseTitle('"Spilsbury Reprise"', ctx);
  assert.equal(r5.title, 'Spilsbury Reprise'); assert.equal(r5.reprise, true);
  const half = parseTitle('"Jump in the Line" / "Dead Mom" (Reprise)', ctx);
  assert.equal(half.title, 'Jump in the Line / Dead Mom (Reprise)'); assert.equal(half.reprise, false);
  const all = parseTitle('"A" (Reprise) / "B" (Reprise)', ctx);
  assert.equal(all.title, 'A / B'); assert.equal(all.reprise, true);
  assert.equal(parseTitle('"Old Friends" (Part I)', ctx).title, 'Old Friends (Part I)');
  assert.equal(parseTitle('"Merrily We Roll Along,"', ctx).title, 'Merrily We Roll Along');
});

test('parseTitle: unquoted and prefixed forms keep their text', () => {
  const ctx = fakeCtx();
  assert.equal(parseTitle('Prologue: "Into the Woods"', ctx).title, 'Prologue: Into the Woods');
  assert.equal(parseTitle('Finale: Nowadays/R.S.V.P/Keep It Hot', ctx).title, 'Finale: Nowadays/R.S.V.P/Keep It Hot'); // the source's spacing is kept
  assert.equal(parseTitle('Entrance of Ensemble (I Cain\'t Say No and Oh What a Beautiful Mornin\')', ctx).title, "Entrance of Ensemble (I Cain't Say No and Oh What a Beautiful Mornin')");
});

test('parseTitle: credit, version, film-only and writer-surname notes', () => {
  const ctx = { ...fakeCtx(), writerSurnames: new Set(['ashman', 'rice', 'beguelin']) };
  assert.equal(parseTitle('"Arabian Nights" (Ashman/Rice)', ctx).title, 'Arabian Nights');
  assert.equal(parseTitle('"Proud of Your Boy" (Beguelin)', ctx).title, 'Proud of Your Boy');
  assert.equal(parseTitle('"I\'ll Make a Man of You" (music and lyrics by Arthur Wimperis)', ctx).title, "I'll Make a Man of You");
  assert.equal(parseTitle('"Blow, Gabriel, Blow" (added in 1987, 2011)', ctx).title, 'Blow, Gabriel, Blow');
  assert.equal(parseTitle('"Movie in My Mind" (Original Production)', ctx).title, 'Movie in My Mind');
  assert.equal(parseTitle('"Suddenly" (2012 film only)', ctx).filmOnly, true);
  const i = parseTitle('"Ländler" (instrumental)', ctx);
  assert.equal(i.title, 'Ländler'); assert.equal(i.instrumental, true);
  assert.equal(parseTitle('Tempo di Menuetto (including an authentic harmonization of To Anacreon in Heav\'n)', ctx).title, 'Tempo di Menuetto');
  assert.equal(parseTitle('I\'m Gonna Tell God All My Troubles (Vocal Arrangement by Chapman Roberts)', ctx).title, "I'm Gonna Tell God All My Troubles");
});

test('parseTitle: prose between quoted titles is flagged', () => {
  assert.equal(parseTitle('"Who I\'d Be" or "Morning Person" replaced "Build a Wall" following the Seattle run', fakeCtx()).prose, true);
});

test('parseSingers: characters, groups, ensemble words, instrumentals', () => {
  const ctx = fakeCtx(['Jean Valjean', 'Enjolras', 'Marius Pontmercy', 'Kim']);
  const a = parseSingers('Enjolras, Marius, Students', ctx);
  assert.deepEqual(a.singers, ['Enjolras', 'Marius Pontmercy']); assert.equal(a.ensemble, true);
  const b = parseSingers('Orchestra', ctx);
  assert.deepEqual(b.singers, []); assert.equal(b.instrumentalToken, true);
  const c = parseSingers('Kim (Instrumental)', ctx);
  assert.equal(c.instrumental, true);
  const d = parseSingers('Boys and Girls (except Ilse)', ctx);
  assert.deepEqual(d.singers, []); assert.equal(d.ensemble, true);
  const e = parseSingers('Valjean, danced by Company', ctx);
  assert.deepEqual(e.singers, ['Jean Valjean']); assert.equal(e.ensemble, false);
  const f = parseSingers('Farmer, Bishop and the townspeople', ctx);
  assert.deepEqual(f.singers, ['Farmer', 'Bishop']); assert.equal(f.ensemble, true);
  const g = parseSingers('Ladies of River City', ctx);
  assert.equal(g.ensemble, true); assert.deepEqual(g.singers, []);
  const h = parseSingers('Hustlers, The Rays, Bowery Beauties, Lionesses, Year 11', ctx);
  assert.deepEqual(h.singers, []); assert.equal(h.ensemble, true);
  const i = parseSingers('Mr. Peters, Other Father', ctx); // surnames / roles that look plural are people
  assert.deepEqual(i.singers, ['Mr. Peters', 'Other Father']);
  const j = parseSingers('Dallas, Greasers, Socs, Clerks, League of Nations, English and German Priests', fakeCtx(['Dallas']));
  assert.deepEqual(j.singers, ['Dallas']); assert.equal(j.ensemble, true);
  assert.deepEqual(parseSingers('Ballade', ctx).singers, []); // a number type, not a singer
  assert.deepEqual(parseSingers('Race, Specs, Henry', ctx).singers, ['Race', 'Specs', 'Henry']); // nicknames stay
  assert.deepEqual(parseSingers('Couplet Final', ctx).singers, []);
  assert.deepEqual(parseSingers('Scene 1', ctx).singers, []);
  const k = parseSingers('Hungarian Crowds, Americans, Demetrius and the Fairy Band', fakeCtx(['Demetrius']));
  assert.deepEqual(k.singers, ['Demetrius']); assert.equal(k.ensemble, true);
  assert.deepEqual(parseSingers('Maria, the Captain and the children', fakeCtx(['Maria Rainer', 'Captain Georg von Trapp'])).singers, ['Maria Rainer', 'Captain Georg von Trapp']);
});

test('parseSingers: honorific repair, protected compound names, actors', () => {
  const ctx = fakeCtx(['Mr. Jefferson', 'Mrs. Jefferson', 'Lady', 'Lucille Ball']);
  assert.deepEqual(parseSingers('Mr. and Mrs. Jefferson', ctx).singers, ['Mr. Jefferson', 'Mrs. Jefferson']);
  assert.deepEqual(parseSingers('Lady and Lucille Ball', ctx).singers, ['Lady', 'Lucille Ball']);
  const ctx2 = fakeCtx(['Mr. and Mrs. Jefferson']);
  assert.deepEqual(parseSingers('Mr. and Mrs. Jefferson', ctx2).singers, ['Mr. and Mrs. Jefferson']);
  const ctx3 = fakeCtx([], { actors: ['Barbara Windsor'] });
  const a = parseSingers('Barbara Windsor', ctx3);
  assert.deepEqual(a.singers, []); assert.deepEqual(a.actors, ['Barbara Windsor']);
});

test('parseSingers drops punctuation-only tokens', () => {
  assert.deepEqual(parseSingers('Cecily, "Patrick," and Harry', fakeCtx()).singers, ['Cecily', 'Patrick', 'Harry']);
  assert.deepEqual(parseSingers('Lord Palmerston and [?]', fakeCtx()).singers, ['Lord Palmerston']);
});

test('isGroupName', () => {
  for (const g of ['Company', 'Ensemble', 'Hot Box Girls', 'Ladies of River City', 'Townspeople', 'The Children', 'Adult Women', 'Three Blind Mice']) assert.equal(isGroupName(g), true, g);
  for (const n of ['Jean Valjean', 'Other Mother', 'Mrs. Squires', 'The Engineer', 'Mother']) assert.equal(isGroupName(n), false, n);
});

test('finalizeSongs: never merges; repeated songs become reprises; source reprise numbers kept; generic numbers numbered', () => {
  const it = (title, singers, reprise = false, extra = {}) => ({ title, singers, singersRaw: singers.join(', '), ensemble: false, reprise, instrumental: false, act: 1, ...extra });
  const out = finalizeSongs([
    it('Table Talk', ['Frank']), it('Maybe', ['Annie']), it('Table Talk', ['Cathy']),
    it('Maybe', ['Annie'], true), it('Maybe', ['Annie'], true), it('Maybe', ['Warbucks'], true),
    it('Tomorrow', ['Annie']), it('Tomorrow (Finale)', ['Company']),
    it('Carrying the Banner', ['Newsies'], true, { repriseNo: 1 }), it('Carrying the Banner', ['Newsies'], true, { repriseNo: 2 }),
    it('The Ballad of Sweeney Todd', ['Company'], true, { repriseNo: 6 }),
    it('Dance', ['Night'], false, { act: 1 }), it('Dance', ['Strephon'], false, { act: 2 }), it('Dance', [], false, { act: 2 }),
  ]);
  assert.deepEqual(out.map((s) => [s.title, s.reprise, s.singers, s.position]), [
    ['Table Talk', false, ['Frank'], 1],
    ['Maybe', false, ['Annie'], 2],
    ['Table Talk', true, ['Cathy'], 3], // listed again: a reprise, not a merged "duet"
    ['Maybe', true, ['Annie'], 4],
    ['Maybe (Reprise 2)', true, ['Annie'], 5], // identical reprises at different places stay apart (Newsies)
    ['Maybe (Reprise 3)', true, ['Warbucks'], 6],
    ['Tomorrow', false, ['Annie'], 7],
    ['Tomorrow (Finale)', true, ['Company'], 8],
    ['Carrying the Banner', true, ['Newsies'], 9],
    ['Carrying the Banner (Reprise 2)', true, ['Newsies'], 10],
    ['The Ballad of Sweeney Todd (Reprise 6)', true, ['Company'], 11],
    ['Dance', false, ['Night'], 12],
    ['Dance (Act 2)', false, ['Strephon'], 13],
    ['Dance (3)', false, [], 14],
  ]);
  assert.equal(out[0].singersRaw, 'Frank');
});

test('songKey is accent/case/punctuation-insensitive', () => {
  assert.equal(songKey('Do You Hear the People Sing?', false), songKey('do you hear the people sing', false));
  assert.notEqual(songKey('Maybe', false), songKey('Maybe', true));
});
