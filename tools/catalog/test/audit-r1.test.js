// Regression tests for the round-1 audit defects (one test per defect class). Each uses a trimmed, lyric-free
// fixture of the article revision the audit checked (test/fixtures) and asserts the expected catalog records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsed, song } from './helpers.js';
import { parseItem, infoboxYear, formLabel, firstLineTitle } from '../src/parse-songs.js';
import { parseTitle, parseSingers, isGroupName, stripMarkers, findSeparator } from '../src/normalize.js';
import { createCharacterMatcher, mergeVariants, voiceIn } from '../src/parse-characters.js';
import { creditNames, altTitlesOf, categoryYear, wdNames } from '../src/shows.js';
import { decideFallback, kindOf } from '../src/rules.js';
import { fakeCtx } from './helpers.js';

const pick = (s) => [s.title, s.singers, s.ensemble, s.reprise, s.instrumental];
const titles = (t) => parsed(t).songs.map((s) => s.title);
const find = (t, title, reprise) => song(t, title, reprise);

// ---- characters: numbered roles, cast-table groups, canonical names -------------------------------------
test('Little Shop: "Audrey" is not merged into "Audrey II"; "Audrey and Audrey II" is a duet', () => {
  const names = parsed('Little Shop of Horrors (musical)').characters.map((c) => c.name);
  assert.ok(names.includes('Audrey') && names.includes('Audrey II'));
  assert.deepEqual(find('Little Shop of Horrors (musical)', "Somewhere That's Green", false).singers, ['Audrey']);
  assert.deepEqual(find('Little Shop of Horrors (musical)', 'Sominex/Suppertime II').singers, ['Audrey', 'Audrey II']);
  assert.deepEqual(mergeVariants([{ name: 'Audrey' }, { name: 'Audrey II' }]).map((c) => c.name), ['Audrey', 'Audrey II']);
});

test('Hadestown: "The Fates" (a row of the cast table) is a role, not the chorus', () => {
  assert.ok(parsed('Hadestown').characters.some((c) => c.name === 'The Fates'));
  // (round 3: the role is three people, so the number is also flagged ensemble — never a Solo/Duet guess)
  assert.deepEqual(pick(find('Hadestown', 'Nothing Changes')), ['Nothing Changes', ['The Fates'], true, false, false]);
  assert.deepEqual(find('Hadestown', 'When the Chips Are Down').singers, ['The Fates', 'Eurydice']);
});

test('matcher: honorific + surname, short forms, first name + initial, Young/Old variants, list names', () => {
  const m = createCharacterMatcher(['Tom Hawkins', 'Clifford Bradshaw', 'Kevin Gnapoor', 'Benjamin Stone', 'Young Ben', 'Mrs. Ida Bogen', 'Harry Bogen',
    'Maurice Pulvermacher', 'Buckley J. "Buck" Thomas', 'Alonzo "Stinky" Goodhue', 'Juliet Capulet', 'Dr. Pomatter'].map((name) => ({ name })));
  m.setListTokens(new Set(['lee']), ['Charles Lee']);
  assert.equal(m.matchCharacter('Mr. Hawkins'), 'Tom Hawkins');
  assert.equal(m.matchCharacter('Cliff'), 'Clifford Bradshaw');
  assert.equal(m.matchCharacter('Kevin G'), 'Kevin Gnapoor');
  assert.equal(m.matchCharacter('Ben'), 'Benjamin Stone'); // Follies: never "Young Ben"
  assert.equal(m.matchCharacter('Young Ben'), 'Young Ben');
  assert.equal(m.matchCharacter('Mrs. Bogen'), 'Mrs. Ida Bogen');
  assert.equal(m.matchCharacter('Mr. Pulvermacher'), 'Maurice Pulvermacher');
  assert.equal(m.matchCharacter('Buckley Joyce Thomas'), 'Buckley J. "Buck" Thomas');
  assert.equal(m.matchCharacter('Alonzo P. Goodhue'), 'Alonzo "Stinky" Goodhue');
  assert.equal(m.matchCharacter('Dr. Jim Pomatter'), 'Dr. Pomatter');
  assert.equal(m.matchCharacter('Lord Capulet'), null); // a title of rank is part of a different role's name
  assert.equal(m.matchCharacter('Lee'), 'Charles Lee'); // written in full elsewhere in the same list
  // regressions caught while re-checking the whole catalog
  const m2 = (names, tok, lt = [], ln = []) => { const x = createCharacterMatcher(names.map((name) => ({ name }))); x.setListTokens(new Set(lt), ln); return x.matchCharacter(tok); };
  assert.equal(m2(['Elder Price', 'Elder Cunningham'], 'Price'), 'Elder Price'); // "Elder" is a title, not an age
  assert.equal(m2(['Joseph Pinglet', 'Mme. Pinglet'], 'Pinglet'), 'Joseph Pinglet'); // the protagonist
  assert.equal(m2(['The Phantom of the Opera', 'Madame Giry', 'Meg Giry'], 'Giry'), 'Madame Giry');
  assert.equal(m2(["Joey's Heart", 'Dick'], 'Joey'), null); // not a short form of a possessive
  assert.equal(m2(['Frances Gumm', 'Baby Frances Gumm'], 'Baby'), 'Baby Frances Gumm');
  assert.equal(m2(['Twelve-year-old Jesus', 'Mary'], 'Jesus'), null);
  assert.equal(m2([], 'Luz', [], ['Lil Luz']), null); // "Lil Luz" is the daughter
  assert.deepEqual(find('The Book of Mormon (musical)', 'Two by Two').singers, ['Elder Price']);
  assert.deepEqual(find('Follies', "The Road You Didn't Take").singers, ['Benjamin Stone']);
  assert.deepEqual(find('Cabaret (musical)', 'Perfectly Marvelous').singers, ['Sally Bowles', 'Clifford Bradshaw']);
});

test('Rent: "Mr. and Mrs. Jefferson" are two characters and two singers', () => {
  assert.deepEqual(find('Rent (musical)', 'Voice Mail #2').singers, ['Mr. Jefferson', 'Mrs. Jefferson']);
});

// ---- groups ---------------------------------------------------------------------------------------------
test('groups are the ensemble flag, never singers (VC, Delta Nus, Mission Band, Kit Kats, Paparazzi, Statues, Sweeps, Trucks …)', () => {
  assert.deepEqual(pick(find('Dear Evan Hansen', 'You Will Be Found', true)), ['You Will Be Found', ['Alana Beck', 'Jared Kleinman'], true, true, false]);
  assert.deepEqual(find('Legally Blonde (musical)', 'Daughter of Delta Nu').singers, ['Serena', 'Margot', 'Pilar']);
  assert.equal(find('Legally Blonde (musical)', 'Daughter of Delta Nu').ensemble, true);
  assert.deepEqual(pick(find('Guys and Dolls', 'Follow the Fold')), ['Follow the Fold', ['Sarah Brown'], true, false, false]);
  assert.deepEqual(pick(find('Cabaret (musical)', 'Sitting Pretty')), ['Sitting Pretty', ['The Emcee'], true, false, false]);
  assert.deepEqual(find('Mary Poppins (musical)', 'Step in Time', false).singers, ['Bert', 'Mary Poppins', 'Jane Banks', 'Michael Banks']);
  assert.equal(find('Starlight Express', 'Boy, Boy, Boy').ensemble, true);
  for (const g of ['Workmen', 'Paparazzi', 'Bums', 'G.I.s', 'Widows', 'Principals', 'Secretaries to Mr. Goodhue', 'Ladies-in-Waiting', 'Teen Queens',
    '3rd class Sleepers', 'Featured Male Singer', "Mrs. Goodhue's Daughters", 'Chorus of Hop-Pickers']) assert.equal(isGroupName(g), true, g);
  for (const r of ['Sergeant of Police', 'Prefect of Police', 'Bishop of Basingstoke', 'Carmen', 'Jacques']) assert.equal(isGroupName(r), false, r);
  assert.deepEqual(find('Candide (operetta)', "What's the Use?").singers, ['Madame Sofronia', 'Ferone', 'Prefect of Police', 'Prince Ivan']);
  assert.deepEqual(parseSingers('Soloist', fakeCtx()).singers, []);
});

// ---- which production list -------------------------------------------------------------------------------
test('Grease: the licensing note next to a list picks the original Broadway list over the 1994 revival', () => {
  const r = parsed('Grease (musical)');
  assert.equal(r.productionList, 'Original Broadway production');
  // (round 3: the licensed list stays the song list — its 21 numbers — and numbers only later revivals have are added)
  assert.equal(r.songs.length - r.addedFromOtherLists.length, 21);
  assert.ok(r.songs.some((s) => s.title === 'All Choked Up') && !r.songs.some((s) => /Finale Medley/.test(s.title)));
  assert.deepEqual(find('Grease (musical)', "Rock 'N' Roll Party Queen").singers, ['Doody', 'Roger "Rump"']);
});

test('Kinky Boots / Wholesale: a ";Chicago" or bold label glued to {{col-begin}} starts another list; lists are never merged', () => {
  const k = parsed('Kinky Boots (musical)');
  assert.deepEqual(k.lists.map((l) => [l.label, l.songs]), [['Broadway', 19], ['Chicago', 17]]);
  assert.ok(!k.songs.some((s) => /Black Widow|Come to the Rescue|So Long, Charlie/.test(s.title)));
  assert.ok(k.songs.every((s, i, a) => !i || (s.act ?? 0) >= (a[i - 1].act ?? 0)));
  const w = parsed('I Can Get It for You Wholesale');
  assert.deepEqual(w.lists.map((l) => l.label), ['Original Broadway (1962)', 'Off-Broadway Revision (2023)']);
  assert.ok(w.songs.every((s) => !/ \/ /.test(s.singersRaw)));
});

test('Show Boat: a "History of revisions" subsection is not a production list', () => {
  const r = parsed('Show Boat');
  assert.equal(r.songs.length, 28);
  assert.deepEqual(pick(find('Show Boat', "Ol' Man River", false)), ["Ol' Man River", ['Joe'], true, false, false]);
  assert.equal(find('Show Boat', 'Olio Dance').instrumental, true);
  assert.equal(find('Show Boat', 'Make Believe', false).singersRaw, 'Ravenal and Magnolia');
});

test('Jekyll & Hyde: a recording ("1994 Complete Works") loses to the show list; "Jekyll" is Dr. Henry Jekyll', () => {
  const r = parsed('Jekyll & Hyde (musical)');
  assert.equal(r.productionList, null);
  assert.deepEqual(find('Jekyll & Hyde (musical)', 'This Is the Moment').singers, ['Dr. Henry Jekyll']);
  assert.ok(!r.characters.some((c) => /Alternate/.test(c.name)));
  assert.equal(r.characters.find((c) => c.name === 'Emma Carew').voiceType, 'Soprano'); // "'''vocal range:''' [[soprano]]"
});

test('We Will Rock You: the Discography chart table is not part of the song list', () => {
  const r = parsed('We Will Rock You (musical)');
  assert.equal(r.songs.length, 33);
  assert.ok(!r.songs.some((s) => /Remix|In German|Version\)/.test(s.title)));
});

test('Chicago: licensing note naming the 1975 list → the 1996 revival (Nowadays is a Velma/Roxie duet)', () => {
  assert.match(parsed('Chicago (musical)').productionList, /1996/);
  assert.deepEqual(find('Chicago (musical)', 'Nowadays').singers, ['Velma Kelly', 'Roxie Hart']);
});

test('act restarts, italic venue labels and prose intros split lists (Dancin\', Roman Holiday, Meet Me in St. Louis, To-Night\'s the Night)', () => {
  assert.equal(parsed("Dancin'").songs.length, 26); // "Part I" bullets are numbers, not acts
  assert.deepEqual(parsed('Roman Holiday (musical)').lists.map((l) => l.songs), [20, 21]);
  assert.equal(parsed('Meet Me in St. Louis (musical)').productionList, 'The current version is as follows');
  assert.equal(parsed("To-Night's the Night (musical)").songs.length, 19); // a mistyped "Act I – Scene 2" is not a new list
});

// ---- dedupe / numbering -----------------------------------------------------------------------------------
test('Mamma Mia!: encore numbers are reprises; the Act I "Dancing Queen" stays a trio', () => {
  assert.deepEqual(pick(find('Mamma Mia! (musical)', 'Dancing Queen', false)), ['Dancing Queen', ['Donna Sheridan', 'Tanya', 'Rosie'], false, false, false]);
  assert.equal(find('Mamma Mia! (musical)', 'Dancing Queen', true).reprise, true);
});

test('Newsies / Sweeney Todd / The Prom: repeated reprises stay apart with the source number and wording', () => {
  assert.equal(parsed('Newsies (musical)').songs.length, 25);
  assert.ok(titles('Newsies (musical)').includes('Carrying the Banner (Reprise 2)'));
  const ballads = titles('Sweeney Todd: The Demon Barber of Fleet Street').filter((t) => /Ballad of Sweeney Todd/.test(t));
  assert.ok(ballads.includes('The Ballad of Sweeney Todd (Reprise 6)'));
  assert.ok(ballads.every((t) => !/'|La la|Razor|Sweeney!/.test(t.replace('Ballad of Sweeney Todd', '')))); // no lyric fragments
  assert.deepEqual(parsed('The Prom (musical)').songs.filter((s) => s.title.startsWith('Changing Lives')).map((s) => s.title),
    ['Changing Lives', 'Changing Lives (Mini-Reprise)', 'Changing Lives', 'Changing Lives (Act 2 Reprise)']);
});

test('Out of This World: three "Dance" numbers stay three danced numbers', () => {
  assert.deepEqual(parsed('Out of This World (musical)').songs.filter((s) => /^Dance/.test(s.title)).map(pick), [
    ['Dance', [], false, false, true], ['Dance (Act 2)', [], false, false, true], ['Dance (3)', [], false, false, true]]);
});

// ---- titles -----------------------------------------------------------------------------------------------
test('titles: footnote markers, quoted/explanatory parentheses, year notes, " – Reprise", glosses, AC/DC', () => {
  assert.deepEqual(['Overture', 'No Matter What', 'Me', 'Maison Des Lunes', 'A Change in Me'].filter((t) => titles('Beauty and the Beast (musical)').includes(t)).length, 5);
  assert.equal(stripMarkers('Overture*# — Orchestra'), 'Overture — Orchestra');
  assert.equal(stripMarkers('Cabinet Battle #1 †'), 'Cabinet Battle #1');
  assert.equal(stripMarkers('"#ILoveMyJob" – Charlie'), '"#ILoveMyJob" – Charlie');
  assert.ok(titles('Shrek the Musical').some((t) => /^Finale \(This is Our Story\)$|^This Is Our Story$/i.test(t)));
  const u = parseTitle('"Finale Ultimo" (reprise of "Climb Every Mountain")', {});
  assert.deepEqual([u.title, u.reprise], ['Finale Ultimo', true]);
  assert.equal(parseTitle('"Finale Medley" (includes "All Choked Up")', {}).title, 'Finale Medley');
  assert.ok(titles('Mary Poppins (musical)').includes('Playing the Game') && !titles('Mary Poppins (musical)').some((t) => /Temper|\(20/.test(t)));
  assert.equal(parseTitle('"Think Vulgar" (2002) "Act English" (2003–present)', {}).title, 'Act English');
  assert.deepEqual(pick(find('Diana (musical)', 'Whatever Love Means Anyway', true)), ['Whatever Love Means Anyway', ['Prince Charles'], false, true, false]);
  const j = parseTitle('"December, 1963 (Oh, What a Night) reprise"', {});
  assert.deepEqual([j.title, j.reprise], ['December, 1963 (Oh, What a Night)', true]);
  assert.ok(['Inútil', 'No Me Diga', 'Paciencia y Fe'].every((t) => titles('In the Heights').includes(t)));
  assert.ok(titles('Starlight Express').includes('AC/DC'));
  assert.equal(parseTitle('"Believe It or Not" (Theme Song from The Greatest American Hero)', {}).title, 'Believe It or Not');
  assert.equal(parseTitle('"Beach Song" (short)', {}).title, 'Beach Song');
  assert.equal(parseTitle('"(I Am) The Seeker" (new song)', {}).title, '(I Am) The Seeker');
  assert.equal(parseTitle('"Spring Fete\'', {}).title, 'Spring Fete');
});

test('Candide: "Aria:" / "Duet:" prefixes go when the list uses them; plain "Act 1" lines set acts', () => {
  const r = parsed('Candide (operetta)');
  for (const t of ['Glitter and Be Gay', 'Oh, Happy We', 'Make Our Garden Grow', 'I Am Easily Assimilated']) assert.ok(r.songs.some((s) => s.title === t), t);
  assert.equal(find('Candide (operetta)', 'Glitter and Be Gay').act, 1);
  assert.equal(find('Candide (operetta)', 'Make Our Garden Grow').act, 2);
  assert.ok(r.songs.some((s) => /^Lisbon Sequence: Lisbon Fair/.test(s.title)));
  assert.equal(parseItem('Tango: Maureen – Mark, Maureen', fakeCtx(['Maureen'])).title, 'Tango: Maureen'); // one prefixed title is a title
});

test('Cabaret: "\'\'\'Act I\'\'\'{{sfn|…}}" still labels the act', () => {
  assert.equal(find('Cabaret (musical)', 'Willkommen', false).act, 1);
  assert.equal(find('Cabaret (musical)', 'Cabaret').act, 2);
});

test('lyric excerpts are never titles in works under copyright (Fun Home, Sweeney Todd); real "…" titles stay (Phantom)', () => {
  const f = titles('Fun Home (musical)');
  assert.ok(['Ring of Keys', 'Changing My Major', 'Days and Days'].every((t) => f.includes(t)));
  assert.ok(!f.some((t) => /^La la/.test(t)));
  assert.ok(['Why So Silent…?', 'Track Down This Murderer…', 'Magical Lasso…'].every((t) => titles('The Phantom of the Opera (1986 musical)').includes(t)));
});

// ---- operetta / musical-comedy formats ----------------------------------------------------------------------
test('Dorothy: "N. Form – "first line" (Singers)" → the quoted number, its singers; dances instrumental', () => {
  const r = parsed('Dorothy (opera)');
  assert.equal(r.songs.length, 25);
  assert.deepEqual(pick(find('Dorothy (opera)', 'Be wise in time, Oh Phyllis mine')), ['Be wise in time, Oh Phyllis mine', ['Dorothy Bantam', 'Lydia Hawthorne', 'Phyllis Tuppitt'], false, false, false]);
  assert.equal(find('Dorothy (opera)', "A father's pride and joy they are").singers.length, 5); // "5  Quintet – …"
  for (const t of ['Graceful Dance', 'Act III Ballet', 'Music for the Entrance of Dorothy and Lydia']) assert.equal(find('Dorothy (opera)', t).instrumental, true, t);
  assert.ok(!r.songs.some((s) => /^(?:Quartet|Song|Trio|Septet)$/.test(s.title) || s.singers.some((x) => /Solo|Septet|Quartett/.test(x))));
  assert.equal(r.characters.find((c) => c.name === 'Geoffrey Wilder').voiceType, 'Tenor'); // "(tenor)"
});

test('A Persian Princess / Ma mie Rosette / Princess Caprice: "Form: Singers – "Title"", "Form (Singers) – Title (gloss)"', () => {
  assert.ok(titles('A Persian Princess').includes('When I am King'));
  assert.deepEqual(find('A Persian Princess', 'When I am King').singers, ['Prince Omar']);
  assert.ok(titles('Ma mie Rosette').includes('Nous allons entrer en ménage'));
  assert.ok(!parsed('Princess Caprice').songs.some((s) => s.singers.some((x) => /Act|Concerted/.test(x))));
  assert.deepEqual(formLabel('Song with Trio'), { form: 'Song with Trio', names: '' });
  assert.equal(firstLineTitle('I have always had a passion for a man of rank and fashion...'), 'I have always had a passion for a man of rank and fashion');
});

test('Pirates of Penzance: "A" … "B" is one number; editorial [notes] go; Sergeant of Police is a role; voice types', () => {
  const r = parsed('The Pirates of Penzance');
  assert.ok(r.songs.some((s) => /^Stay, we must not lose our senses … Here's a first-rate opportunity/.test(s.title)));
  assert.deepEqual(find('The Pirates of Penzance', 'When you had left our pirate fold').singers, ['Ruth', 'Frederic', 'The Pirate King']);
  assert.deepEqual(find('The Pirates of Penzance', 'Sergeant, approach!').singers, ['Mabel', 'Sergeant of Police']);
  assert.ok(r.characters.filter((c) => c.voiceType).length >= 9);
});

// ---- coverage ----------------------------------------------------------------------------------------------
test('coverage: {{Ordered list}}, "Songs and recordings", writer credits, plain lines, bilingual tables, "Songs in the original production"', () => {
  assert.equal(parsed('Natasha, Pierre & The Great Comet of 1812').songs.length, 27);
  assert.deepEqual(find('Natasha, Pierre & The Great Comet of 1812', 'Sonya Alone').singers, ['Sonya Rostova']);
  assert.equal(parsed('Fun Home (musical)').section, 'Songs and recordings');
  assert.equal(parsed('SpongeBob SquarePants (musical)').songs.length, 20); // "Title" by [[A]] & [[B]] – singers
  assert.equal(parsed('Mulan Jr.').songs.length, 19);
  assert.deepEqual(find('Mulan Jr.', 'Honor to Us All (Part one)').singers, ['Fa Zhou', 'Mulan', 'Ancestors', 'Fa Li', 'Grandmother Fa']);
  assert.equal(parsed('Notre-Dame de Paris (musical)').songs.length, 51);
  assert.deepEqual(find('Notre-Dame de Paris (musical)', 'The Age of the Cathedrals').singers, ['Gringoire']);
  assert.deepEqual(parsed('Notre-Dame de Paris (musical)').characters.map((c) => c.name).slice(0, 3), ['Esmeralda', 'Quasimodo', 'Frollo']);
  assert.deepEqual(find('Rebecca (musical)', 'Du wirst niemals eine Lady').singers, ['Mrs. Van Hopper', 'Ich']);
  assert.deepEqual(find('The Good Companions (musical)', 'Bruddersford').singers, ['Jess']); // "Title ..... Singers"
  assert.deepEqual(find('Letter to Harvey Milk', 'Too Old For This').singers, ['Harry', 'Frannie']); // "2. Title (Singers)" lines
  assert.equal(parsed('On the Record (musical)').songs.length, 51); // a revue under "Music" citing each song's film ("You Can Fly! You Can Fly! You Can Fly!", "The Walrus and the Carpenter/…" too)
  assert.ok(titles('On the Record (musical)').includes('Whistle While You Work/Give a Little Whistle'));
});

// ---- the singers text -----------------------------------------------------------------------------------------
test('Sondheim on Sondheim / El barberillo: "Show (year), credits: "Song"" and ":"Song"" lines give the songs, not the headers', () => {
  const t = titles('Sondheim on Sondheim');
  assert.ok(t.includes("I'll Meet You at the Donut") && t.includes("Something's Coming") && t.includes('Being Alive'));
  assert.ok(!t.some((x) => /book by|music by|\(19\d\d\)/.test(x)));
  assert.ok(titles('El barberillo de Lavapiés').includes('¡Este es el sitio!'));
  assert.equal(parseItem('Moonlight surfing / words & music by Herbert de Pinna', fakeCtx()).title, 'Moonlight surfing');
  assert.equal(parseItem('Lyrics by Sam Coslow and Music by W. Franke Harling', fakeCtx()), null);
});

test('credits, source songs, source shows and performers are not singers', () => {
  assert.ok(parsed('Blues in the Night (musical)').songs.every((s) => !s.singers.length && !/\((?:Harry Akst|Bessie Smith|Harold Arlen)/.test(s.title))); // "Note: composers in parentheses"
  assert.ok(parsed('Abbacadabra').songs.every((s) => !s.singers.length));
  assert.ok(titles('Abbacadabra').includes('Battle of The Brooms') && titles('Abbacadabra').includes('(I Am) The Seeker'));
  assert.ok(parsed('Side by Side by Sondheim').songs.every((s) => !s.singers.length && !s.ensemble)); // – ''[[Company (musical)|Company]]''
  assert.equal(parsed('At Home Abroad').singersSource, 'actors-dropped'); // "It featured in the cast [[Beatrice Lillie]], [[Ethel Waters]] …"
  assert.ok(parsed('The Streets of Paris').songs.every((s) => !s.singers.length)); // a revue's Cast section lists performers
});

test('medleys, prose notes, "a Student", glued dashes', () => {
  assert.deepEqual(pick(find('Chess (musical)', 'Golden Bangkok / One Night in Bangkok')), ['Golden Bangkok / One Night in Bangkok', ['Freddie Trumper'], true, false, false]);
  assert.deepEqual(find('Elisabeth (musical)', 'The Cheerful Apocalypse (Die fröhliche Apokalypse)').singers, ['Luigi Lucheni']);
  assert.equal(find('Elisabeth (musical)', 'Beauty Care (Schönheitspflege)').ensemble, true); // Ladies-in-Waiting
  assert.deepEqual(find('Caroline, or Change', 'Laundry Quintet').singers, ['The Washing Machine', 'Caroline Thibodeaux', 'The Radio']);
  assert.ok(titles('Naughty Marietta (operetta)').includes('The Dream Melody (Ah! Sweet Mystery of Life)'));
  assert.deepEqual(pick(find('Naughty Marietta (operetta)', 'New Orleans Jeunesse Dorèe')), ['New Orleans Jeunesse Dorèe', [], true, false, false]);
  assert.deepEqual(find('Follies', 'The Story of Lucy and Jessie').singers, ['Phyllis Rogers Stone']); // "Phyllis and backup male dancers"
  const sep = findSeparator('Laundry Quintet— The Washing Machine');
  assert.ok(sep && sep.start === 15);
});

test('instrumental flags: "Dance With Me" is sung, "Prelude and Simply Heavenly" is sung, "Danced by …" and bare "Dance" are danced', () => {
  assert.equal(find("Smokey Joe's Cafe (revue)", 'Dance With Me').instrumental, false);
  assert.equal(find('Simply Heavenly', 'Prelude and Simply Heavenly').instrumental, false);
  assert.equal(find('Follies', "Bolero d'Amour").instrumental, true);
  assert.equal(parseItem('"March of the Witch Hunters"', fakeCtx()).instrumental, false);
  assert.equal(parseItem('Dance – Night', fakeCtx(['Night'])).instrumental, true);
});

// ---- characters -------------------------------------------------------------------------------------------------
test('characters: no actors, crew, song titles or prose; roles after "as"; described linked roles kept', () => {
  const names = (t) => parsed(t).characters.map((c) => c.name);
  assert.ok(!names('Spring Awakening (musical)').some((x) => /Damiano|Matt Doyle|Ariza/.test(x)));
  assert.ok(!names('Rent (musical)').some((x) => /script/.test(x)));
  assert.ok(!names('The Lion King (musical)').some((x) => /Director|Choreographer|Design/.test(x)));
  assert.deepEqual(names('Godspell'), ['Jesus', 'John the Baptist', 'Judas']);
  assert.ok(names('The Sound of Music').includes('Sister Berthe'));
  assert.ok(names('Mary Poppins (musical)').includes('Miss Andrew'));
  assert.ok(names('Anastasia (musical)').includes('Anya'));
  assert.ok(names('Mulan Jr.').includes('Mulan')); // "[[Mulan (Disney character)|Mulan]] - A young woman …"
  assert.deepEqual(parsed('The Amorous Flea').characters.map((c) => c.voiceType), ['Baritone', 'Baritone', 'Baritone', 'Alto', 'Mezzo-soprano', 'Tenor']);
  assert.equal(voiceIn("Frederic, ''the Pirate Apprentice'' ([[tenor]])"), 'Tenor');
  assert.equal(voiceIn('Arnolphe - Lew Parker - Baritone'), 'Baritone');
});

// ---- show-level fields ------------------------------------------------------------------------------------------
test('show fields: premiere year, credits, alternative titles, comic-opera categories', () => {
  assert.equal(infoboxYear({ premiere_date: '{{start date|2011|9|25}}' }), 2011); // Newsies (Paper Mill)
  assert.equal(infoboxYear({ productions: '1969 [[Broadway theatre|Broadway]] <br /> 1972 [[1776 (film)|Film]]' }), 1969);
  assert.equal(infoboxYear({ premiere_date: '{{Start date|1935|06|28|df=y}}' }), 1935);
  assert.equal(categoryYear(['1935 operas']), 1935);
  assert.deepEqual(creditNames('[[Samuel and Bella Spewack]]'), ['Samuel Spewack', 'Bella Spewack']);
  assert.deepEqual(creditNames('Various'), []);
  assert.deepEqual(creditNames('Revue basis'), []);
  assert.deepEqual(creditNames('Neil Gooding. Additional material by Stuart Smith'), ['Neil Gooding', 'Stuart Smith']);
  assert.deepEqual(creditNames('Walter Bobbie. There is no script'), ['Walter Bobbie']);
  assert.deepEqual(wdNames([{ label: 'various artists' }, { label: 'Elvis Presley' }]), ['Elvis Presley']);
  assert.deepEqual(altTitlesOf({ title: 'Rent', wikiTitle: 'Rent (musical)', wdAliases: ['Mark Cohen -Rent', 'RENT-heads', 'Rent 20th Anniversary Concert UK Tour', 'Tom Collins - RENT'] }), []);
  assert.deepEqual(altTitlesOf({ title: 'Into the Woods', wikiTitle: 'Into the Woods', wdAliases: ['Into the wood'] }), []);
  assert.deepEqual(altTitlesOf({ title: 'Chicago', wikiTitle: 'Chicago (musical)', wdAliases: ['Chicago The Musical Bangalore', 'Chicago: A Musical Vaudeville'] }), ['Chicago: A Musical Vaudeville']);
  const flags = {};
  assert.equal(decideFallback('Iolanthe', { p31: 'Q58483083', forms: 'Q13220650 Q1344', desc: 'comic opera by Gilbert and Sullivan' }, flags, { cats: ['English comic operas', 'Operas by Gilbert and Sullivan'] }).include, true);
  assert.equal(decideFallback('Ivanhoe (opera)', { p31: 'Q58483083', desc: 'opera by Arthur Sullivan' }, flags, { cats: ['Operas by Arthur Sullivan'] }).include, false);
  assert.equal(decideFallback('The Tales of Hoffmann', { desc: 'opéra fantastique by Jacques Offenbach' }, flags, { cats: ['Operas by Jacques Offenbach'] }).include, false);
  assert.equal(kindOf(['Q13220650'], []), 'operetta');
  assert.equal(parsed('Iolanthe').songs.length, 31);
});
