// Regression tests for the round-3 audit defects (the final-catalog audits: popular shows, a uniform random sample and
// structurally hard articles). One test per defect class; each uses a trimmed, lyric-free fixture of the article revision the
// audit checked (test/fixtures) — or a unit input — and asserts the expected records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsed, song, fakeCtx } from './helpers.js';
import { parseArticle, parseItem } from '../src/parse-songs.js';
import { parseTitle, parseSingers, isGroupName, isGroupRole, singularOf } from '../src/normalize.js';
import { createCharacterMatcher, pairOf, actorSideOf } from '../src/parse-characters.js';
import { altTitlesOf, leadCredits, creditNames } from '../src/shows.js';
import { chooseVersion, contentHash, readLedger, recordVersion } from '../src/version.js';

const titles = (t) => parsed(t).songs.map((s) => s.title);
const chars = (t) => parsed(t).characters.map((c) => c.name);
const pick = (s) => [s.title, s.singers, s.ensemble, s.reprise, s.instrumental];

// ---- catalog version ------------------------------------------------------------------------------------------------
test('a version is never issued twice for different content, even after the catalog file was reset', () => {
  const issued = [...Array(12)].map((_, i) => ({ version: `2026-09-27.${i + 1}`, sha256: null }));
  // the file on disk was reset to .5, but .12 was issued before: the next version is .13, not a second .6/.7
  assert.equal(chooseVersion({ today: '2026-09-27', hash: 'new', prev: { version: '2026-09-27.5', hash: 'old' }, issued }).version, '2026-09-27.13');
  // identical content keeps its version (from the file or from the ledger)
  assert.deepEqual(chooseVersion({ today: '2026-09-27', hash: 'same', prev: { version: '2026-09-27.5', hash: 'same', generatedAt: 'x' }, issued }), { version: '2026-09-27.5', reused: true, generatedAt: 'x' });
  assert.equal(chooseVersion({ today: '2026-09-27', hash: 'h9', prev: null, issued: [...issued, { version: '2026-09-27.14', sha256: 'h9' }] }).version, '2026-09-27.14');
  // (an entry without a hash never matches: the twice-issued .7 can't be reused for other content)
  assert.equal(chooseVersion({ today: '2026-09-28', hash: 'x', prev: { version: '2026-09-27.7', hash: 'y' }, issued }).version, '2026-09-28.1');
  assert.notEqual(contentHash({ sources: {}, shows: [1] }), contentHash({ sources: {}, shows: [2] }));
  // the committed ledger keeps the versions issued before it existed
  const committed = readLedger(new URL('../versions.json', import.meta.url).pathname).map((e) => e.version);
  for (let i = 1; i <= 12; i++) assert.ok(committed.includes(`2026-09-27.${i}`), `2026-09-27.${i}`);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), 'v.json');
  recordVersion(f, { version: '2026-09-27.13', sha256: 'a' }); recordVersion(f, { version: '2026-09-27.13', sha256: 'a' });
  assert.deepEqual(readLedger(f).map((e) => e.version), ['2026-09-27.13']);
});

// ---- singers: roles that are several people, groups --------------------------------------------------------------------
test('a role that is several people ("The Fates", "Elle\'s Parents") stays a singer but makes the number an ensemble one', () => {
  for (const t of ['Nothing Changes', 'Word to the Wise']) assert.deepEqual(pick(song('Hadestown', t)), [t, ['The Fates'], true, false, false]);
  for (const t of ['Any Way the Wind Blows', 'When the Chips Are Down', "Gone, I'm Gone"]) assert.equal(song('Hadestown', t).ensemble, true, t);
  assert.equal(song('Hadestown', 'Epic I').ensemble, false); // (Orpheus and Hermes: a duet)
  assert.ok(song('Legally Blonde (musical)', 'What You Want').singers.includes("Elle's Parents"));
  for (const g of ['The Fates', 'The Twins', 'Doctors', "Elle's Parents", 'Storytellers']) assert.equal(isGroupRole(g), true, g);
  for (const r of ['Linda English', 'Robert Woolfolk', 'Sergeant of Police', 'Hermes']) assert.equal(isGroupRole(r), false, r);
});

test('group names are the ensemble, never Solo/Duet singers (Associates, forms, "… Four", Imps, Doubles, Personnel, Soli …)', () => {
  assert.deepEqual(pick(song('A Broadway Musical', 'Yenta Power')), ['Yenta Power', ['Shirley Wolfe'], true, false, false]);
  assert.deepEqual(pick(song('The Utter Glory of Morrissey Hall', 'Lost')), ['Lost', [], true, false, false]); // "The Sixth Form"
  assert.deepEqual(song('The Utter Glory of Morrissey Hall', 'You Will Know When the Time Has Arrived').singers, ['Teresa Winkle', 'Carswell']); // "Fifth and Sixth Forms"
  assert.deepEqual(pick(song('Oh, What A Girl!', 'Medley of Old Songs')), ['Medley of Old Songs', [], true, false, false]); // "The Manhattan Comedy Four"
  assert.deepEqual(pick(song('The Tik-Tok Man of Oz', 'Work, Lads, Work')), ['Work, Lads, Work', ['Ruggedo'], true, false, false]); // "Metal Imps"
  assert.deepEqual(pick(song('Bare: A Pop Opera', '911! Emergency!')), ['911! Emergency!', ['Virgin Mary'], true, false, false]); // "Cherubs"
  assert.deepEqual(pick(song('H.M.S. Pinafore', 'Carefully on tiptoe stealing')), ['Carefully on tiptoe stealing', [], true, false, false]); // "Soli"
  for (const g of ['Associates', 'Cry-Baby Doubles', 'Employees', 'Court Personnel', 'Jitterbugs', 'Crows', 'T-Birds', 'The Manhattan Comedy Four', "Henderson's Razorbacks"]) {
    const sg = parseSingers(`Anna and ${g}`, fakeCtx(['Anna']));
    assert.deepEqual([sg.singers, sg.ensemble], [['Anna'], true], g);
  }
  assert.equal(isGroupName('Juror Number Eight'), false);
  // "Kitty Savary, (Gentlemen)", "(Ladies and Gentlemen)": the chorus's part in brackets (Orange Blossoms)
  assert.deepEqual(pick(song('Orange Blossoms (musical)', 'Orange Blossoms')), ['Orange Blossoms', ['Kitty Savary'], true, false, false]);
  assert.deepEqual(pick(song('Orange Blossoms (musical)', 'On the Riviera')), ['On the Riviera', [], true, false, false]);
  // "Peter and Trio", "Dee Anthony, Greg, Peter, Trio and Male Ensemble": the vocal group doesn't throw the singers away
  assert.deepEqual(pick(song('The Boy from Oz', 'Bi-Coastal')), ['Bi-Coastal', ['Peter'], true, false, false]);
  assert.deepEqual(song('The Boy from Oz', 'Sure Thing Baby').singers, ['Dee Anthony', 'Greg', 'Peter']);
  // "1st & 2nd Congressmen" → one of each
  assert.deepEqual(song('The Lieutenant (musical)', 'He Wants to Put the Army in Jail').singers, ['Senator', 'First Congressman', 'Second Congressman', 'Clergyman']);
  assert.equal(singularOf('Congressmen'), 'Congressman');
});

test('a part played in a scene "(as other Students)" is a note — the singer stays, the number is not an ensemble one', () => {
  assert.deepEqual(pick(song('Ride the Cyclone', "Constance's Bumper")),
    ["Constance's Bumper", ['The Amazing Karnak', 'Constance Blackwood', 'Ricky Potts', 'Noel Gruber', 'Mischa Bachinski'], false, false, false]);
  // "Alice, K.C., Leo and Herb": K.C. is a character, not Alice's title of honour
  assert.deepEqual(song('My Favorite Year (musical)', 'The Musketeer Sketch').singers,
    ['Benjy Stone', 'Sy Benson', 'King Kaiser', 'Alice Miller', 'K.C. Downing', 'Leo Silver', 'Herb Lee']);
  assert.deepEqual(parseSingers('Sir John Chaldicott, Bart., M.P. and Jane', fakeCtx()).singers, ['Sir John Chaldicott Bart. M.P.', 'Jane']);
});

test('slash pairs of titles and singers are separate solos (The Last Five Years)', () => {
  assert.ok(!titles('The Last Five Years').some((t) => /Miracle.*\/|\/.*Come Home/.test(t)));
  assert.deepEqual(pick(song('The Last Five Years', 'A Miracle Would Happen')), ['A Miracle Would Happen', ['Jamie Wellerstein'], false, false, false]);
  assert.deepEqual(pick(song('The Last Five Years', 'When You Come Home to Me')), ['When You Come Home to Me', ['Cathy Hiatt'], false, false, false]);
});

test('singer names: the child\'s surname for a parent, "Madam", first names, English forms of foreign names, typos', () => {
  assert.deepEqual(song('Rent (musical)', 'Voice Mail #5').singers, ['Mrs. Davis', 'Mrs. Marquez', 'Mr. Jefferson', 'Mrs. Cohen']); // "Roger's Mother" …
  assert.deepEqual(song('A Little Night Music', 'The Glamorous Life').singers, ['Fredrika Armfeldt', 'Desiree Armfeldt', 'Madame Leonora Armfeldt']);
  assert.deepEqual(song('La belle Hélène', 'Lorsque la Grèce est un champ de carnage').singers, ['Agamemnon', 'Calchas', 'Ménélas']); // "Menelaus"
  assert.deepEqual(song('La belle Hélène', 'Un mari sage').singers, ['Hélène', 'Ménélas']); // "Helen; Menelaus"
  const m = createCharacterMatcher(['Cecil B. DeMille', 'Norma Desmond', 'J. Jonah Jameson', 'Louise', 'The Shirelle'].map((name) => ({ name })));
  m.setListTokens(new Set(), []);
  assert.equal(m.matchCharacter('Cecil B. DeMile'), 'Cecil B. DeMille');
  assert.equal(m.matchCharacter('Jamerson'), 'J. Jonah Jameson');
  assert.equal(m.matchCharacter('Louis'), null); // never a spelling variant across a gender pair
  // a bare "Mother" shared by two families' mothers stays as written (Salad Days)
  assert.deepEqual(song('Salad Days (musical)', 'Find Yourself Something to Do').singers, ['Father', 'Mother', 'Aunt Prue', 'Timothy']);
  assert.deepEqual(song('Gigi (musical)', 'The Night They Invented Champagne').singers, ['Gigi', 'Gaston Lachaille', 'Inez Alvarez']); // "(Mamita)"
});

// ---- characters: actors and roles ---------------------------------------------------------------------------------------
test('roles linked in the productions prose are roles, not actors (The Wizard of Oz 1987)', () => {
  assert.deepEqual(song('The Wizard of Oz (1987 musical)', 'If I Only Had the Nerve').singers, ['Cowardly Lion', 'Dorothy', 'Scarecrow', 'Tinman']);
  assert.ok(parsed('The Wizard of Oz (1987 musical)').songs.find((s) => /^Munchkinland/.test(s.title)).singers.includes('Glinda'));
  assert.ok(song('The Wizard of Oz (1987 musical)', 'Poppies/Out of the Woods/Act One Finale').singers.includes('Glinda'));
});

test('cast lists: "Actor – Role, Role", "Actor starred as Role", "Role—[[Actor]]", "Role ... Actor"', () => {
  assert.ok(!chars('The Lieutenant (musical)').some((n) => /Boockvor|Curty|Mekka|starred/.test(n)));
  assert.ok(['The Lieutenant', 'Judge', 'OCS Sergeant', 'First General', 'Chaplain', 'First Congressman', 'Second Congressman'].every((n) => chars('The Lieutenant (musical)').includes(n)));
  assert.deepEqual(song('The Lieutenant (musical)', 'On Trial for My Life', false).singers, ['The Lieutenant']);
  assert.deepEqual(chars("Here's Love"), ['Susan Walker', 'Doris Walker', 'Kris Kringle', 'Fred Gaily', 'Marvin Shellhammer', 'R. H. Macy', 'Mr. Sawyer', 'Miss Crookshank', 'Hendrika']);
  assert.deepEqual(chars('The Tik-Tok Man of Oz').slice(0, 4), ['Tik-Tok', 'Shaggy Man', 'Betsy Bobbin', 'Hank the Mule']);
  assert.deepEqual(song('The Tik-Tok Man of Oz', 'The Magnet of Love', false).singers, ['Betsy Bobbin']);
  assert.ok(!chars('The Penny Friend').some((n) => /—/.test(n)) && !chars('Wildcat (musical)').some((n) => /—/.test(n)));
  assert.deepEqual(chars('The Midnight Sons').slice(0, 3), ['Senator Constant Noyes', 'Jack', 'Dick']);
  assert.deepEqual(pairOf("[[Tik-Tok (Oz)|Tik-Tok]]—[[James C. Morton]]"), ['[[Tik-Tok (Oz)|Tik-Tok]]', '[[James C. Morton]]']);
  // a list of roles with descriptions is not a cast list read backwards (Spring Awakening)
  assert.equal(actorSideOf(['*Melchior Gabor – An intelligent schoolboy with radical ideals.', '*Wendla Bergmann – An innocent, curious girl.', '*Moritz Stiefel – Melchior\'s best friend.', '*Ilse Neumann – A friend of the other children.']), null);
  assert.ok(chars('Spring Awakening (musical)').includes('Melchior Gabor'));
});

test('character names: italic descriptions, voice types after the name, casting tables, chorus lines, cover labels', () => {
  const rudd = chars('Ruddigore');
  assert.ok(['Richard Dauntless', 'Rose Maybud', 'Dame Hannah', 'Sir Roderic Murgatroyd', 'Old Adam Goodheart'].every((n) => rudd.includes(n)), rudd.join('|'));
  assert.ok(!rudd.some((n) => /Foster-Brother|Village Maiden|Baronet|Mortals|Ghosts/.test(n)));
  assert.deepEqual(song('Ruddigore', 'I know a youth').singers, ['Rose Maybud', 'Sir Ruthven Murgatroyd']); // "Robin": his disguise
  assert.deepEqual(parsed('I granatieri').characters.slice(0, 2), [{ name: 'Nini', voiceType: 'Soprano' }, { name: 'Dorotea', voiceType: 'Soprano' }]);
  assert.deepEqual(chars('The Goodbye Girl (musical)'), ['Paula McFadden', 'Elliot Garfield', 'Lucy McFadden', 'Mrs. Crosby']); // "Historical casting"
  assert.ok(chars('A Broadway Musical').includes('Smoke & Fire Back-Up Singer'));
  assert.ok(!chars('Spider-Man: Turn Off the Dark').some((n) => /Alternate|^Others$/.test(n)));
  assert.ok(!chars('Beaches (musical)').includes('Cee Cee Bloom')); // = Cecelia Carol "Cee Cee" Bloom
});

// ---- which production list, and numbers from the others -------------------------------------------------------------
test('numbers only later productions have are added in place; the licensed list stays the song list (Grease)', () => {
  const r = parsed('Grease (musical)');
  assert.equal(r.productionList, 'Original Broadway production');
  for (const t of ['Grease', 'Hopelessly Devoted to You', 'Sandy', "You're the One That I Want"]) assert.ok(titles('Grease (musical)').includes(t), t);
  assert.deepEqual(song('Grease (musical)', 'Sandy').singers, ['Danny Zuko']); // (the number itself, not the 1993 prologue reprise)
  assert.equal(song('Grease (musical)', 'Hopelessly Devoted to You').act, 2);
  assert.ok(!titles('Grease (musical)').some((t) => /Megamix|Medley/.test(t)));
  // never from an earlier list: Chicago 1975's numbers removed from the licensed version, Shrek's "Donkey Pot Pie", Kinky Boots' tryout
  assert.equal(parsed('Chicago (musical)').addedFromOtherLists.length, 0);
  assert.equal(parsed('Kinky Boots (musical)').addedFromOtherLists.length, 0);
  assert.equal(parsed('Next to Normal').addedFromOtherLists.length, 0);
  // a later list: a longer name of a number the list has is the same number (Witches of Eastwick "I Love A Little Town")
  assert.ok(!titles('The Witches of Eastwick (musical)').includes('I Love A Little Town') && titles('The Witches of Eastwick (musical)').includes('A Little Town'));
});

test('numbers the notes say productions add ("Something Good", "I Have Confidence") — not a single staging\'s', () => {
  assert.deepEqual(pick(song('The Sound of Music', 'Something Good')), ['Something Good', ['Maria Rainer', 'Captain Georg von Trapp'], false, false, false]);
  assert.equal(titles('The Sound of Music').indexOf('Something Good'), titles('The Sound of Music').indexOf('An Ordinary Couple') + 1);
  assert.ok(titles('The Sound of Music').includes('I Have Confidence'));
  assert.ok(!titles('Ride the Cyclone').some((t) => /Waiting For The Drop|Tragic Fact|^The Uranium Suite$/.test(t))); // (one staging; the list has it)
  assert.ok(!titles('Annie Get Your Gun (musical)').includes('Take It in Your Stride')); // (replaced before opening)
});

test('which list: the show\'s own section / title, the revised version, "onwards", a list override', () => {
  const bj = parsed('By Jeeves');
  assert.ok(titles('By Jeeves').includes('Wooster Will Entertain You') && titles('By Jeeves').includes('By Jeeves'));
  assert.ok(!titles('By Jeeves').includes('Code Of The Woosters') && !titles('By Jeeves').includes('S.P.O.D.E.'));
  assert.match(bj.productionList, /By Jeeves/);
  assert.equal(parsed('Carrie (musical)').productionList, 'Off-Broadway revival');
  for (const t of ['Dreamer in Disguise', 'Why Not Me?', 'You Shine', 'Once You See', 'Stay Here Instead']) assert.ok(titles('Carrie (musical)').includes(t), t);
  assert.equal(parsed('The Fix (musical)').productionList, '1998 onwards');
  assert.ok(titles('The Fix (musical)').includes('Let the Games Begin') && titles('The Fix (musical)').includes('One, Two, Three'));
  assert.equal(parsed('Road Show (musical)').productionList, 'Road Show, 2008 Off-Broadway');
  assert.equal(parsed('Starlight Express').productionList, null); // (its "Starlight Express (Wembley 2024)" list doesn't win by its name)
});

// ---- item formats -------------------------------------------------------------------------------------------------------
test('bilingual operetta lines: original title, translation, then the singers (La belle Hélène)', () => {
  const t = titles('La belle Hélène');
  for (const x of ['Au mont Ida', "Oui c'est un rêve", 'Lorsque la Grèce est un champ de carnage', 'Gloire au berger victorieux', 'Un mari sage']) assert.ok(t.includes(x), x);
  assert.ok(!t.some((x) => /^(?:Air de|Duo |Couplets d|Trio patriotique|Chœur )/.test(x)));
  assert.deepEqual(song('La belle Hélène', 'Au mont Ida').singers, ['Pâris']);
  assert.equal(t.length, 20);
});

test('combined numbers with each part\'s own singers (Gilbert & Sullivan): all the singers, clean titles', () => {
  assert.deepEqual(pick(song('H.M.S. Pinafore', 'Pretty daughter of mine / He is an Englishman')),
    ['Pretty daughter of mine / He is an Englishman', ['Captain Corcoran', 'Boatswain'], true, false, false]);
  assert.ok(!titles('H.M.S. Pinafore').includes('Reflect, my child')); // "5a. Cut song: …"
  assert.deepEqual(song('Trial by Jury', 'When first my old, old love I knew / Silence in Court!').singers, ['The Defendant', 'Usher']);
  assert.deepEqual(song('Trial by Jury', 'May it please you, my lud!').singers, ['Counsel for the Plaintiff']);
  // not a list of original artists: '"I Want It That Way" (Backstreet Boys) / "Bye Bye Bye" (NSYNC)'
  assert.ok(!parsed("Cruel Intentions: The '90s Musical").songs.some((s) => s.singers.includes('NSYNC')));
});

test('translations and originals in brackets are glosses, not singers (Jacques Brel, Starmania)', () => {
  const brel = parsed('Jacques Brel is Alive and Well and Living in Paris');
  assert.ok(brel.songs.every((s) => !s.singers.length), brel.songs.filter((s) => s.singers.length).map((s) => s.title).join('|'));
  for (const x of ['Marathon', 'Alone', 'My Death', 'Next', "You're Not Alone", 'Old Folks', 'Timid Frieda']) assert.ok(titles('Jacques Brel is Alive and Well and Living in Paris').includes(x), x);
  assert.deepEqual(titles('Starmania (musical)').slice(0, 3), ['Quand on arrive en ville', 'Travesti', 'Banlieue nord']);
  assert.ok(titles('Elisabeth (musical)').includes('The Cheerful Apocalypse (Die fröhliche Apokalypse)')); // (a number with its singers keeps it)
});

test('item formats: several titles "from Show", "Pt. 2", "(original)", glued hyphens, label inside quotes, credits in <small>', () => {
  assert.equal(titles('Beguiled Again').length, 12);
  for (const x of ['My Funny Valentine', 'The Lady Is a Tramp', 'Johnny One Note', 'Manhattan', 'It Never Entered My Mind']) assert.ok(titles('Beguiled Again').includes(x), x);
  assert.deepEqual(song("That's Entertainment (musical)", "I'm Glad I'm Single").singers, ['Richard']);
  assert.ok(titles("Ain't Too Proud").includes("Papa Was A Rollin' Stone (Pt. 2)") && !song("Ain't Too Proud", "Papa Was A Rollin' Stone (Pt. 2)").reprise);
  assert.ok(titles('Ruddigore').filter((t) => /^Away, remorse!/.test(t)).length === 2);
  assert.deepEqual(song('Spider-Man: Turn Off the Dark', 'If the World Should End', true).singers, ['Mary Jane Watson']);
  assert.ok(titles('Tina (musical)').includes('Shake a Tail Feather') && titles('Tina (musical)').includes('Finale: Nutbush City Limits / Proud Mary'));
  assert.ok(titles('Aladdin (2011 musical)').includes('Act One Finale (Friend Like Me (Reprise)/Proud of Your Boy (Reprise 1))'));
  assert.ok(titles('The Fix (musical)').every((t) => !/\(\s*\)/.test(t)));
  assert.ok(titles('The Boy from Oz').includes('Waltzing Matilda'));
  assert.ok(titles('Carmen Jones').some((t) => /^Whizzin' Away Along de Track \(Quintet \(Nous avons en tête une affaire\) in Bizet's opera\)$/.test(t)));
  assert.equal(parseTitle('"I\'ve had a trip on board of a ship" (known as "I\'ve been to the Durbar")', {}).title, "I've had a trip on board of a ship (I've been to the Durbar)");
  assert.equal(parseTitle('The War (Les Preludes by Franz Liszt)', {}).title, 'The War');
  assert.equal(parseTitle('(Opening)', {}).title, 'Opening');
  assert.equal(parseItem('A new introductory verse to "Every Day a Little Death"', fakeCtx()), null);
  assert.ok(!titles('A Little Night Music').some((t) => /introductory verse|Additional lyrics|Love Takes Time/.test(t)));
});

test('danced numbers are instrumental; acts typed "Act l"; "(Opening)"', () => {
  for (const [s, t] of [['Oh, What A Girl!', 'Fox Trot'], ['The Tik-Tok Man of Oz', 'A Storm at Sea'], ['The Tik-Tok Man of Oz', 'Imps March'], ['Orange Blossoms (musical)', 'Mosquito Ballet']]) {
    assert.equal(song(s, t).instrumental, true, t);
  }
  assert.deepEqual(parsed('Orange Blossoms (musical)').songs.map((s) => s.act), [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
  assert.equal(titles('Orange Blossoms (musical)')[0], 'Opening');
  assert.equal(song('Ruddigore', 'Original Overture').instrumental, true);
});

test('song tables without a title header, and one column per version', () => {
  assert.equal(parsed('The Arcadians (musical)').songs.length, 26);
  assert.deepEqual(song('The Arcadians (musical)', 'The Pipes of Pan are calling').singers, ['Sombra']);
  assert.deepEqual(parsed('Orpheus in the Underworld').lists.map((l) => l.label), ['1858 version', '1874 version']);
  assert.equal(parsed('Orpheus in the Underworld').productionList, '1874 version');
  assert.deepEqual(song('Orpheus in the Underworld', 'La femme dont le cœur rêve').singers, ['Eurydice']);
  assert.deepEqual(song('The Cradle Will Rock', 'Nickel Under the Foot').singers, ['Larry Foreman']);
  assert.equal(parsed('La Périchole').songs.length, 32);
  assert.deepEqual(pick(song('La Périchole', 'Ouverture')), ['Ouverture', [], false, false, true]);
  assert.equal(parsed('Whittington (opera)').songs.length, 24);
  assert.ok(parsed('White Horse Inn (Broadway version)').songs.length >= 19);
  assert.equal(parsed('Southampton Passion').songs.length, 9); // (a "Musical item" table under a "Music" heading)
});

// ---- shows ----------------------------------------------------------------------------------------------------------------
test('show records: "&" as "and", redirects to parts of the show, credits in the opening sentences, non-musicals', () => {
  assert.deepEqual(altTitlesOf({ title: '& Juliet', wikiTitle: '& Juliet' }), ['And Juliet']);
  assert.deepEqual(altTitlesOf({ title: 'Florodora', wikiTitle: 'Florodora', redirects: ['Florodora girl', 'Florodora sextette', 'Florodora sextettes'] }), []);
  const text = (lead) => `{{Infobox musical\n| name = X\n}}\n${lead}\n==Plot==\n`;
  assert.deepEqual(leadCredits(text("'''''Beguiled Again''''' is a [[musical revue]] compiling the works of [[Richard Rodgers]] (music) and [[Lorenz Hart]] (lyrics).")),
    { composer: ['Richard Rodgers'], lyricist: ['Lorenz Hart'], book: [] });
  assert.deepEqual(leadCredits(text("'''''Salad Days''''' is a [[Musical theater|musical]] with music by [[Julian Slade]], and with [[libretto|book and lyrics]] by [[Dorothy Reynolds]] and Julian Slade.")),
    { composer: ['Julian Slade'], lyricist: ['Dorothy Reynolds', 'Julian Slade'], book: ['Dorothy Reynolds', 'Julian Slade'] });
  assert.deepEqual(leadCredits(text("'''X''' is a musical based on the book by [[Roald Dahl]], with music by [[Tim Minchin]].")).book, []);
  assert.deepEqual(creditNames('[[Motown|The Legendary Motown Catalog]]'), []);
  // a contemporary-circus show is not a musical — a "Cirque du Soleil musical" is
  const circus = (desc) => `{{Short description|${desc}}}\n{{Infobox stage production\n| name = Love\n| genre = [[Contemporary circus]]\n| premiere = June 30, 2006\n}}\n'''Love''' is a show.\n`;
  assert.equal(parseArticle(circus('2006 theatrical production by Cirque du Soleil'), { title: 'Love (Cirque du Soleil)', lenient: true }).isStageWork, false);
  assert.equal(parseArticle(circus('Cirque du Soleil musical'), { title: 'Paramour (Cirque du Soleil)', lenient: true }).isStageWork, true);
});
