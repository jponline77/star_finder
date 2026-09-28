// Characters / voice types / actor detection / singer-token matching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsed } from './helpers.js';
import { parseCharacters, createCharacterMatcher, mergeVariants, canonName } from '../src/parse-characters.js';
import { sections } from '../src/wikitext.js';

const chars = (t) => parsed(t).characters;
const names = (t) => chars(t).map((c) => c.name);
const voice = (t, n) => chars(t).find((c) => c.name === n)?.voiceType;
const parseChars = (text) => parseCharacters(sections(text), text);

test('voice types from a "Voice type" column (Jesus Christ Superstar, Legally Blonde, Little Mermaid, Miss Saigon)', () => {
  assert.equal(voice('Jesus Christ Superstar', 'Jesus Christ'), 'Baritenor'); // "[[baritenor]] (A♭2–C5, falsetto to G5)" — range dropped
  assert.ok(chars('Jesus Christ Superstar').filter((c) => c.voiceType).length >= 5);
  assert.ok(chars('Legally Blonde (musical)').some((c) => c.voiceType));
  assert.ok(chars('The Little Mermaid (musical)').some((c) => c.voiceType));
  assert.ok(chars('Miss Saigon').some((c) => c.voiceType));
});

test('voice types from a trailing [[Mezzo-soprano]] link in a description cell (Chicago)', () => {
  assert.equal(voice('Chicago (musical)', 'Roxie Hart'), 'Mezzo-soprano');
  assert.equal(voice('Chicago (musical)', 'Velma Kelly'), 'Alto');
  assert.equal(voice('Chicago (musical)', 'Billy Flynn'), 'Baritone');
});

test('articles without voice information give null voice types', () => {
  assert.ok(chars('Hamilton (musical)').every((c) => c.voiceType === null));
});

test('Hamilton: notable ensemble members (actors) are not characters', () => {
  const n = names('Hamilton (musical)');
  assert.ok(n.includes('Alexander Hamilton') && n.includes('Eliza Schuyler Hamilton'));
  assert.equal(n.length, 14);
});

test('Next to Normal: "Diana" merges into "Diana Goodman"; Book of Mormon: "Character: [[Actor]]" actors excluded', () => {
  assert.ok(names('Next to Normal').includes('Diana Goodman'));
  assert.ok(!names('Next to Normal').includes('Diana'));
  assert.ok(names('The Book of Mormon (musical)').includes('Elder Price'));
});

test('dual roles split; group names dropped', () => {
  const n = names('& Juliet');
  assert.ok(n.includes('Anne Hathaway') && n.includes('April'));
  // a group-looking row of a cast table is a principal role played by named actors (Hadestown's Fates,
  // Spring Awakening's Adult Women); group names elsewhere are not roles
  assert.ok(names('Hadestown').includes('The Fates'));
  assert.ok(names('Spring Awakening (musical)').includes('Adult women'));
  assert.ok(!names('Spring Awakening (musical)').some((x) => /^(?:Jennifer Damiano|Matt Doyle|Robert Ariza)$/.test(x))); // replacement lines name actors
  assert.ok(!names('Rent (musical)').some((x) => /script/i.test(x)));
});

test('multi-name table cells split only when they are real lists (Annie vs Phantom)', () => {
  const a = names('Annie (musical)');
  assert.ok(a.includes('Mrs. Greer') && a.includes('Annette') && a.includes('Fred McCracken'));
  assert.ok(names('The Phantom of the Opera (1986 musical)').includes('Raoul, Vicomte de Chagny'));
});

test('bullet list characters with descriptions', () => {
  const { characters } = parseChars(['== Characters ==',
    "* '''Jamie Lockhart''' – a gentleman robber",
    '* Rosamund Musgrove, the daughter of a planter',
    '* [[Maurice Lauchner]] as Stewart Peterson',
    '* Frank Butler—the Wild West show\'s star',
    '* Mary Elizabeth Mastrantonio ..... Dora Spenlow',
    '* Laura Nowalska, Palmatica\'s daughter',
    '* The Ensemble',
  ].join('\n'));
  assert.deepEqual(characters.map((c) => c.name), ['Jamie Lockhart', 'Rosamund Musgrove', 'Stewart Peterson', 'Frank Butler', 'Dora Spenlow', 'Laura Nowalska']);
});

test('table characters: header detection, first line of multi-line cells, actor columns', () => {
  const text = ['== Roles ==', '{| class="wikitable"', '! Role !! Voice type !! Premiere cast',
    '|-', '| Porgy, a disabled beggar || [[bass-baritone]] || [[Todd Duncan]]',
    '|-', '| Bess<br>Crown\'s girl || soprano || [[Anne Brown]]',
    '|}'].join('\n');
  const r = parseChars(text);
  assert.deepEqual(r.characters, [{ name: 'Porgy', voiceType: 'Bass-baritone' }, { name: 'Bess', voiceType: 'Soprano' }]);
  const two = parseChars(['== Characters ==', '{| class="wikitable"', '! Character !! Broadway', '|-', '| Chiron, Poseidon, || [[Jorrel Javier]]', '|-', '| Raoul, Vicomte de Chagny || [[Steve Barton]]', '|}'].join('\n'));
  assert.deepEqual(two.characters.map((c) => c.name), ['Chiron', 'Poseidon', 'Raoul, Vicomte de Chagny']);
  assert.ok(r.actors.has('todd duncan'));
});

test('canonName / mergeVariants', () => {
  assert.equal(canonName('Prof. Harold Hill'), canonName('Harold Hill'));
  assert.equal(canonName('Doctor Madden'), canonName('Dr. Madden'));
  const m = mergeVariants([{ name: 'Ti Moune', voiceType: null }, { name: 'Little Ti Moune', voiceType: null }, { name: 'Eliza Hamilton', voiceType: null }, { name: 'Eliza Schuyler Hamilton', voiceType: null }]);
  assert.deepEqual(m.map((c) => c.name), ['Ti Moune', 'Little Ti Moune', 'Eliza Schuyler Hamilton']);
});

test('createCharacterMatcher rules', () => {
  const m = createCharacterMatcher([
    { name: 'Alexander Hamilton' }, { name: 'Aaron Burr' }, { name: 'Eliza Schuyler Hamilton' }, { name: 'Philip Hamilton' },
    { name: 'Heather Chandler' }, { name: 'Heather Duke' }, { name: 'Jason "J.D." Dean' }, { name: 'Curly McLain' }, { name: 'Dream Curly' },
    { name: 'Sarah Brown' }, { name: 'Sister Sarah Brown' }, { name: "Moses' Son" }, { name: 'The Engineer' },
  ]);
  const { matchCharacter: mc } = m;
  assert.equal(mc('Burr'), 'Aaron Burr');
  assert.equal(mc('H. Chandler'), 'Heather Chandler');
  assert.equal(mc('J.D.'), 'Jason "J.D." Dean');
  assert.equal(mc('Curly'), 'Curly McLain');
  assert.equal(mc('Sarah Brown'), 'Sarah Brown');
  assert.equal(mc('Hamilton'), 'Alexander Hamilton'); // shared surname → first-listed protagonist
  assert.equal(mc('Engineer'), 'The Engineer');
  assert.equal(mc('Moses'), null); // possessive in "Moses' Son"
  assert.equal(mc('Heather'), null); // ambiguous first name
  m.setListTokens(['alexander']);
  assert.equal(mc('Hamilton'), null); // the protagonist's first name is used in the same list → ambiguous
  assert.equal(mc('Engineer', true), 'The Engineer');
  assert.equal(mc('Curly', true), null);
});
