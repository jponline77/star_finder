// Regression tests for the round-2 audit defects (one test per defect class). Each uses a trimmed, lyric-free fixture
// of the article revision the audit checked (test/fixtures) — or a unit input — and asserts the expected records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsed, song, fixtureText, fakeCtx } from './helpers.js';
import { parseItem, parseArticle, sentenceBreak, infoboxYears } from '../src/parse-songs.js';
import { parseTitle, parseSingers, isGroupName, stripMarkers, foldHomoglyphs } from '../src/normalize.js';
import { voiceIn, createCharacterMatcher, mergeVariants } from '../src/parse-characters.js';
import { creditNames } from '../src/shows.js';
import { decideFallback, rescueStageArticle } from '../src/rules.js';

const titles = (t) => parsed(t).songs.map((s) => s.title);
const chars = (t) => parsed(t).characters.map((c) => c.name);
const voice = (t, name) => parsed(t).characters.find((c) => c.name === name)?.voiceType ?? null;
const pick = (s) => [s.title, s.singers, s.ensemble, s.reprise, s.instrumental];

// ---- singers: groups, performers, names ---------------------------------------------------------------------------
test('group and collective names are the ensemble, not singers ("Tribe", "Whos", "Suspects", "Lead Vocals")', () => {
  assert.deepEqual(pick(song('Hair (musical)', 'Aquarius', false)), ['Aquarius', [], true, false, false]);
  assert.deepEqual(song('Hair (musical)', 'What a Piece of Work Is Man').singers, []); // "Tribe duo"
  assert.equal(song('Hair (musical)', 'What a Piece of Work Is Man').ensemble, true);
  assert.deepEqual(song('Hair (musical)', 'Frank Mills').singers, ['Chrissy']); // "Crissy": one letter apart
  assert.deepEqual(song('Seussical', 'Havin\' a Hunch').singers, ['The Cat in the Hat', 'Jojo']);
  assert.ok(!parsed('Seussical').songs.some((s) => s.singers.some((x) => /^(?:Whos|Hunches|Wickershams)$/.test(x))));
  for (const g of ['Local Lads', 'Suspects', 'Wildcats', 'Chess Players', 'Lalor Siblings', 'Hebrew Slaves', 'Immortals', 'Tribe', 'Ensamble']) {
    assert.equal(parseSingers(`Anna and ${g}`, fakeCtx(['Anna'])).ensemble, true, g);
    assert.deepEqual(parseSingers(`Anna and ${g}`, fakeCtx(['Anna'])).singers, ['Anna'], g);
  }
  assert.equal(isGroupName("Elle's Parents"), false); // a pair of roles
  assert.ok(song('Legally Blonde (musical)', 'What You Want').singers.includes("Elle's Parents"));
  // "The Band and Lead Vocals": nobody named, but sung — not instrumental
  assert.deepEqual(pick(song('Hot Feet', 'When I Dance')), ['When I Dance', [], false, false, false]);
  assert.deepEqual(parseSingers('N/A', fakeCtx()).singers, []);
});

test('performers named instead of roles: cleared when the list says so, mapped to the role when the cast list says "X as Y"', () => {
  const r = parsed('Your Arms Too Short to Box with God'); // "Songs are listed with performers in the original Broadway version"
  assert.equal(r.singersSource, 'actors-dropped');
  assert.ok(r.songs.every((s) => !s.singers.length));
  assert.equal(song('Your Arms Too Short to Box with God', "There's a Stranger in Town").singersRaw, 'William Hardy, Jr. & Company');
  // a revue: "Monotonous – (Sung by Eartha Kitt)" names a performer, not a role
  assert.deepEqual(parsed('New Faces of 1952').songs.find((s) => /^Monotonous/.test(s.title)).singers, []);
  // "[[Lee Kernaghan]] as the Balladeer" → "Spirit of the High Country (sung by Lee Kernaghan)" is the Balladeer's
  assert.deepEqual(song('The Man from Snowy River: Arena Spectacular', 'Spirit of the High Country', false).singers, ['The Balladeer']);
  assert.deepEqual(song('The Man from Snowy River: Arena Spectacular', 'Kosciusko Moon').singers, ['Jim Ryan', 'Kate Conroy']);
  assert.ok(song('Cool Rider', 'Cool Rider').singers.includes('Stephanie Zinone'));
});

test('singer names: suffixes, disguises, titles, spelling variants, numbered and elliptical groups', () => {
  assert.deepEqual(song('Afgar', 'Give the Devil His Due').singers, ['Don Juan Jr.']); // "Don Juan, Jr."
  assert.deepEqual(parseSingers('Sir John Chaldicott, Bart., M.P. and Jane', fakeCtx()).singers, ['Sir John Chaldicott Bart. M.P.', 'Jane']);
  assert.deepEqual(song('Seussical', 'Mayzie in Palm Beach').singers, ['Mayzie La Bird', 'The Cat in the Hat', 'Horton the Elephant']);
  assert.deepEqual(song('Seussical', 'How to Raise a Child').singers, ['The Mayor of Whoville', 'Mrs. Mayor']);
  assert.deepEqual(song('Seussical', 'Solla Sollew', true).singers, ['The Mayor of Whoville', 'Mrs. Mayor']); // "Mr. Mayor"
  assert.deepEqual(song('Beauty and the Beast (musical)', 'Maison Des Lunes').singers, ['Gaston', 'LeFou', "Monsieur D'Arque"]);
  assert.deepEqual(song('Death Takes a Holiday (musical)', 'Alone Here With You').singers, ['Grazia Lamberti', 'Death']); // "Sirki"
  assert.deepEqual(song('Death Takes a Holiday (musical)', "Roberto's Eyes").singers, ['Major Eric Fenton']);
  assert.deepEqual(song('Stinkfoot, a Comic Opera', 'Imagination').singers, ['Pollyanna']); // "Polly"
  assert.deepEqual(song('Stinkfoot, a Comic Opera', "Drowned Sailor's Dream", false).singers, ['Elma']); // "Elma the Electrifying Elver"
  assert.deepEqual(song('Stinkfoot, a Comic Opera', 'Follow Your Nose').singers, ['The Great Soliquisto']);
  assert.deepEqual(song('Titanic (musical)', 'The Staircase').singers, ['Kate McGowan', 'Kate Murphey', 'Kate Mullins', 'Jim Farrell', 'Frederick Barrett']);
  assert.deepEqual(pick(song('Titanic (musical)', 'Wake Up, Wake Up!')), ['Wake Up, Wake Up!', ['Henry Etches'], true, false, false]);
  assert.deepEqual(song('Miss Littlewood', 'Nothing Much Happened After That').singers,
    ['Joan Littlewood', 'Joan 1', 'Joan 2', 'Joan 3', 'Joan 4', 'Joan 5', 'Joan 6']); // "Joan 1, 2, 3, 4, 5 and 6"
  const m = createCharacterMatcher(['Daryl Van Horne', 'Louis'].map((name) => ({ name })));
  m.setListTokens(new Set(), []);
  assert.equal(m.matchCharacter('Darryl'), 'Daryl Van Horne');
  assert.equal(m.matchCharacter('Louise'), null); // not a spelling variant of Louis
});

// ---- characters ----------------------------------------------------------------------------------------------------
test('character lists: aliases, doubling lists, duplicates, headings, capitals, labels and descriptors', () => {
  assert.deepEqual(chars('Anastasia (musical)').filter((n) => /Anya|Anastasia/.test(n)), ['Anya']); // "Anya / Anastasia"
  assert.ok(!chars('Rent (musical)').some((n) => /Mark's Mother|Roger's Mother|Coat Vendor/.test(n))); // the doubling list
  assert.deepEqual(chars('Guys and Dolls').filter((n) => /Cartwright/.test(n)), ['General Matilda B. Cartwright']);
  assert.ok(chars('Stinkfoot, a Comic Opera').includes('Pollyanna')); // "Main characters, original cast"
  assert.ok(!chars('Stinkfoot, a Comic Opera').some((n) => /^(?:Lights|Choreography|Soliquisto)$/.test(n)));
  assert.deepEqual(chars("Lust 'n Rust").slice(0, 2), ['Red', 'Steve Morgan']); // "RED", "STEVE MORGAN"
  assert.ok(!chars("The Who's Tommy").some((n) => /age|Supporting|Principals/.test(n)));
  assert.equal(voice("The Who's Tommy", 'Captain Walker'), 'Tenor');
  assert.ok(!chars('Falsettos').some((n) => /Replacement|Transfer/.test(n)));
  assert.ok(['Marvin Gaye', 'Smokey Robinson', 'Diana Ross'].every((n) => chars('Motown: The Musical').includes(n))); // rows of the cast table
  assert.ok(!chars('Blindekuh (operetta)').includes('Gutsbesitzer')); // "Scholle, ''Gutsbesitzer'' (Landowner)"
  assert.deepEqual(chars('The Sultan of Sulu').slice(0, 4), ['Ki-Ram', 'Colonel Jefferson Budd', 'William Hardy', 'Hadji Tanton']);
  assert.ok(!chars('The Man from Snowy River: Arena Spectacular').some((n) => /assistant|villager/.test(n)));
  assert.ok(['Joan 4', 'Woman with pears', 'Lionel Bart'].every((n) => chars('Miss Littlewood').includes(n))); // "A/B/C/D" cast rows
  assert.deepEqual(mergeVariants([{ name: 'Mayzie La Bird' }, { name: 'Mayzie LaBird' }]).map((c) => c.name), ['Mayzie La Bird']);
  // cast lists written "Actor as Role" / "Actor (Role)": a bare name, "A / B (double cast as the rival)", "X as rival"
  // and "Actor: description" lines name actors, not roles — judged per subsection
  assert.deepEqual(chars('Shock (musical)'), ['Koichi', "Koichi's brother-in-law", "Tsubasa's sister", "Sakiho's son", 'Taku', 'Machida', 'Yara', 'Yonehara', 'Rika', 'Owner', 'Rival']);
  const tony = chars('TONY! The Blair Musical'); // "Characters" then "Original Edinburgh Fringe cast" under it
  assert.ok(tony.includes('News Reporter') && tony.includes('Wife') && !tony.some((n) => /Ellie Cox|Boagey| as /.test(n)));
  assert.ok(chars('Prince Kaguya').includes('Sora')); // "… as Sora (ソラ), a zashiki-warashi who … acts as storyteller"
  assert.ok(['The Balladeer', 'The Breaker'].every((n) => chars('The Man from Snowy River: Arena Spectacular').includes(n)));
});

test('voice types: compound types, boy soprano, a trailing voice link, the first of "X or Y"', () => {
  assert.equal(voiceIn('Ruth ([[mezzo-soprano]])'), 'Mezzo-soprano');
  assert.equal(voiceIn('Sir Marmaduke ([[bass-baritone]])'), 'Bass-baritone');
  assert.equal(voiceIn("A young teacup. '''Voice type:''' [[Boy soprano]]"), 'Boy soprano');
  assert.equal(voiceIn('Tommy, age 16–25, A young pinball genius. [[Tenor]].'), 'Tenor');
  assert.equal(voiceIn('Nita ([[mezzo-soprano]] or soprano)'), 'Mezzo-soprano');
  assert.equal(voice('The Sorcerer', 'Sir Marmaduke Pointdextre'), 'Bass-baritone');
  assert.equal(voice('Beauty and the Beast (musical)', 'Chip'), 'Boy soprano');
  assert.equal(voice('Jesus Christ Superstar', 'Caiaphas'), 'Bass-baritone'); // "[[Bass (voice type)|bass]]-[[baritone]]"
});

// ---- lists: versions, boundaries, missed lists --------------------------------------------------------------------
test('two production lists one after the other are split, never merged into fake reprises', () => {
  const ss = parsed('Sing Street (musical)'); // a plain "Boston" line between the lists
  assert.deepEqual(ss.lists.map((l) => [l.label, l.songs]), [['New York Theatre Workshop', 12], ['Boston', 13]]);
  assert.deepEqual(song('Sing Street (musical)', 'Up', true).singers, ['Raphina']); // the source's own "Up (Reprise)"
  assert.equal(ss.songs.filter((s) => s.reprise).length, 2);
  const v = parsed('The Visit (musical)'); // italic "''From the One Act 2015 Broadway Production''"
  assert.deepEqual([v.productionList, v.songs.length, v.songs.filter((s) => s.reprise).length], ['From the One Act 2015 Broadway Production', 22, 0]);
  const sos = parsed('Sondheim on Sondheim'); // "… on the cast album:" introduces a recording's list
  assert.equal(sos.lists.length, 2);
  assert.ok(sos.productionList.startsWith('List of shows represented') && titles('Sondheim on Sondheim').includes('Invocation/Forget War'));
  assert.ok(!titles('Sondheim on Sondheim').some((t) => /\(/.test(t) && /Cook|Mackey|Company\)/.test(t)));
  assert.match(parsed('Fanny (musical)').productionList, /1954 Broadway production/); // the list's intro line names it
  assert.equal(parsed('Miss You Like Hell').songs.length, 20); // "… songs that were cut and reworked in future productions" loses
  const pl = parsed('Platinum (musical)'); // "*'''1977 world premiere production'''": a bullet that is only a bold label
  assert.deepEqual(pl.lists.map((l) => l.label), ['1977 world premiere production', '1978 Broadway production', '1984 Village Gate NYC production']);
  assert.equal(pl.songs.filter((s) => s.reprise).length, 0);
});

test('a list override (overrides.json › preferList) picks the version the notes describe', () => {
  const shrek = parseArticle(fixtureText('Shrek the Musical'), { title: 'Shrek the Musical', preferList: '^US tour' });
  assert.equal(shrek.productionList, 'US tour');
  assert.ok(shrek.songs.some((s) => s.title === 'Forever') && !shrek.songs.some((s) => s.title === 'Donkey Pot Pie'));
  const w = parseArticle(fixtureText('The Witches of Eastwick (musical)'), { title: 'The Witches of Eastwick (musical)', preferList: '^London' });
  assert.ok(w.songs.some((s) => s.title === 'Eye of the Beholder'));
});

test('song lists the parser missed: headings, <br> lines, "(English – singers)", act/scene notes, typed lines, recordings', () => {
  assert.equal(parsed('Kristina från Duvemåla').songs.length, 39); // "Music numbers in the original set"
  assert.equal(parsed('Rudolf (musical)').songs.length, 29); // "Original Hungarian Production Song list"
  assert.deepEqual(song('Redwood (musical)', 'Drive').singers, ['Jesse', 'Mel', 'Spencer']); // "Musical numbers and instrumentation"
  assert.equal(parsed("James Joyce's The Dead").songs.length, 15); // ";Source:playbillvault"
  assert.equal(parsed('The Threepenny Opera').songs.length, 25); // "{{0|1}}2. Die Moritat … (The Ballad of … – Street singer)<br />"
  assert.deepEqual(pick(song('The Threepenny Opera', 'Seeräuberjenny (Pirate Jenny)')), ['Seeräuberjenny (Pirate Jenny)', ['Polly Peachum'], false, false, false]);
  assert.deepEqual([song('Porgy and Bess', 'Summertime').act, song('Porgy and Bess', 'Summertime').singers], [1, ['Clara', 'Jake']]); // ", act 1, scene 1 –"
  assert.equal(parsed('The Man from Snowy River: Arena Spectacular').songs.length, 26); // ": song: "X" (sung by Y)"
  assert.equal(song('The Man from Snowy River: Arena Spectacular', 'Snowy River Suite').instrumental, true);
  const wd = parsed('Whistle Down the Wind (1996 musical)'); // "==Original London Cast Recording==" laid out by act
  assert.deepEqual([wd.section, wd.songs.length], ['Original London Cast Recording', 27]);
  assert.ok(titles('Whistle Down the Wind (1996 musical)').includes('I Never Get What I Pray For') && !titles('Whistle Down the Wind (1996 musical)').some((t) => /Tom Jones|Lottie/.test(t)));
  const norway = parsed('Song of Norway (original Broadway cast recording)'); // one {{Track listing}} per side, "(1) … (2) …"
  assert.equal(norway.songs.length, 18);
  assert.ok(['Strange Music', 'Now', 'Midsummer\'s Eve', 'March of the Trollgers'].every((t) => norway.songs.some((s) => s.title === t)));
});

test('"!" and "?" inside a title are not sentence breaks; "* Act Two Finale" is a number, not an act label', () => {
  assert.deepEqual(song('I Do! I Do!', 'I Do! I Do!').singers, ['Michael', 'Agnes']);
  assert.ok(['Oh! What a Bump', 'Allah! Strike for Thee', 'Act Two Finale'].every((t) => titles('The Sultan of Sulu').includes(t)));
  assert.equal(sentenceBreak('Who Can? You Can', false, true), false);
  assert.equal(sentenceBreak('A song. It was cut', false, true), true);
  assert.deepEqual(song('Mozart!', 'Ha! Ein Liebesnest!').singers, ['Cäcilia Weber', 'Johann Thorwart']);
  assert.deepEqual(song('The Mikado', 'Alone, and yet alive').singers, ['Katisha']); // "Recit. and song, "Alone, and yet alive" (Katisha)"
});

// ---- items: old operetta formats, notes, tables -------------------------------------------------------------------
test('operetta formats: form labels, nested quotes, Verse/Refrain children, acts from finale numbers, overtures', () => {
  assert.deepEqual(pick(song('The New Aladdin', "Who would be a 'Boy,' nothing to enjoy")), ["Who would be a 'Boy,' nothing to enjoy", ['Tippin'], true, false, false]);
  assert.deepEqual(song('The New Aladdin', "We're taking a trip in a hop or a skip").singers, ['Genie of the Lamp']); // "Genie and others"
  assert.ok(titles('The New Aladdin').includes('If you ever go down to a popular town on the coast when the summer is hot'));
  const bk = parsed('Blindekuh (operetta)');
  assert.ok(!bk.songs.some((s) => /:/.test(s.title)) && bk.songs[0].title === 'Overture' && bk.songs[0].instrumental);
  assert.deepEqual(song('Blindekuh (operetta)', 'Ich bin Gousmand').singers, ['Johann']); // "Couplet by Johann:"
  assert.deepEqual([song('Blindekuh (operetta)', "Welch' buntes Leben wird").ensemble, song('Blindekuh (operetta)', 'Welche Lust bei diesen Klängen').act], [true, 3]);
  const hz = parsed('Die Herzogin von Chicago');
  assert.equal(hz.songs.length, 28);
  assert.ok(!hz.songs.some((s) => /^(?:Verse|Refrain)\b|Negresco|^Duet \(/.test(s.title)));
  assert.deepEqual(song('Die Herzogin von Chicago', 'Und in Chicago, wissen sie, was sich da tut!').singers, ['Miss Mary Lloyd', 'James Bondy']);
  assert.deepEqual(pick(song('The Mikado', 'A more humane Mikado')), ['A more humane Mikado', ['The Mikado of Japan'], true, false, false]);
  assert.ok(titles('The Mikado').includes('And have I journey\'d for a month') && titles('The Mikado').includes('Brightly dawns our wedding day') && titles('The Mikado')[0] === 'Overture');
  assert.deepEqual(pick(song('The Sorcerer', 'Happy are we in our loving frivolity')), ['Happy are we in our loving frivolity', [], true, false, false]);
  assert.deepEqual(pick(song('The Sorcerer', 'Or he or I must die')), ['Or he or I must die', [], true, false, false]);
  assert.equal(song('The Sorcerer', 'Dance').instrumental, true);
  assert.ok(!parsed('The Sorcerer').songs.some((s) => s.singers.some((x) => /version/.test(x))));
  assert.ok(parsed('El Capitan (operetta)').songs.filter((s) => s.instrumental).every((s) => /^(?:Melodrama|Introduction)$/.test(s.title)));
  assert.deepEqual(song('Cox and Box', 'My Hand upon It').singers, ['John James Box', 'James John Cox', 'Sergeant Bouncer']);
  assert.ok(!parsed('Les cloches de Corneville').songs.some((s) => s.singers.some((x) => /^(?:In my|It's awful|By the light)/.test(x))));
  assert.deepEqual(song('3 Musketiers', 'Milady ist zurück (Milady is back)').singers, ['Milady']); // "("…" - Milady - written for …)"
});

test('production notes are not singers: <small> notes, "– 1877 version only", "(Added for …)", "(The Poor)"', () => {
  assert.deepEqual(pick(song('Mozart!', 'Die Wunder sind vorüber')), ['Die Wunder sind vorüber', ['Wolfgang', 'Leopold'], true, false, false]);
  assert.deepEqual(song('Mozart!', 'Eine ehrliche Familie').singers, ['Cäcilia Weber', 'Aloysia', 'Josepha', 'Sophie']);
  assert.equal(song('Mozart!', 'Wer ist wer? (Mummenschanz / Rätsellied / Mummenschanz Reprise)').reprise, false);
  assert.equal(song('Falsettos', "I'm Breaking Down").singersRaw, 'Trina');
  assert.equal(song('Marie Antoinette (musical)', 'This Night').singersRaw, 'Margrid, Ensemble (The Poor)');
});

test('tables: an Act column, names on separate lines, N/A, "Instrumental Introduction:", the Name column over Number', () => {
  const oz = parsed('The Wizard of Oz (1902 musical)');
  assert.deepEqual([...new Set(oz.songs.map((s) => s.act))], [1, 2, 3]);
  assert.deepEqual(pick(song('The Wizard of Oz (1902 musical)', 'Carrie Barry')), ['Carrie Barry', ['Dorothy Gale'], true, false, false]); // "Dorothy\nChorus"
  assert.ok(['Prelude', 'Cyclone', 'Waltzes', 'Lanciers'].every((t) => song('The Wizard of Oz (1902 musical)', t).instrumental));
  assert.ok(!titles('The Wizard of Oz (1902 musical)').some((t) => /Grand March Chorus|No Longer King Ensemble/.test(t)) && !oz.songs.some((s) => s.singers.includes('N')));
  assert.deepEqual(song('La Grande-Duchesse de Gérolstein', 'Overture').instrumental, true);
  assert.ok(!titles('La Grande-Duchesse de Gérolstein').some((t) => /^(?:Orchestra|\d+)$/.test(t)));
  assert.ok(!titles('Shock (musical)').some((t) => /Lyrics|Composition|Arrangement/.test(t))); // "*: Lyrics: …" note lines
});

test('titles: glosses, "– Instrumental", wrapping single quotes, reprise wording, source slash spacing, look-alike letters', () => {
  assert.ok(titles('Maybe Happy Ending').includes('Why Love?') && !titles('Maybe Happy Ending').some((t) => /Korean|[가-힣]/.test(t)));
  assert.equal(song('Maybe Happy Ending', 'Tell Me About Fireflies, Please').instrumental, true);
  assert.ok(titles('Love Never Dies (musical)').includes('Mother, Did You See…? / Ten Long Years… / Meg\'s Aria'));
  assert.ok(!titles('Love Never Dies (musical)').some((t) => /^'[^']*'$|' \/ '/.test(t)));
  assert.deepEqual([song('Peach Boy', "Cherry Blossom (Hōseki's Lullaby)", true).title], ["Cherry Blossom (Hōseki's Lullaby)"]);
  assert.ok(song('White Noise: A Cautionary Musical', 'Welcome to Eden', true)); // "Welcome to Eden Reprise"
  // one rule for medleys: a marker stays on its part, the number is a reprise when its first part is one, a medley listed
  // again as a whole is a reprise of it
  assert.equal(song('Beauty and the Beast (musical)', 'No Matter What (Reprise) / Wolf Chase').reprise, true);
  assert.equal(song('Next to Normal', "Make Up Your Mind / Catch Me I'm Falling", true).reprise, true);
  assert.equal(song('Next to Normal', 'Hey #3 / Perfect for You (Reprise)').reprise, false);
  assert.equal(parseTitle('"Changing Lives" (Mini-Reprise)', {}).title, 'Changing Lives (Mini-Reprise)');
  assert.equal(parseTitle('"Valjean Arrested/Valjean Forgiven"', {}).title, 'Valjean Arrested/Valjean Forgiven');
  assert.equal(parseTitle('"A" / "B"', {}).title, 'A / B');
  assert.equal(foldHomoglyphs('Rosabella Clancу'), 'Rosabella Clancy');
  assert.equal(stripMarkers('Gleb and Ensemble +'), 'Gleb and Ensemble');
  // titles in another script are different songs, not reprises of one another; "(INST)" marks an instrumental
  const shock = parsed('Shock (musical)').songs;
  assert.equal(shock.filter((s) => s.reprise).length, 0);
  assert.deepEqual(shock.filter((s) => /^[戦合死罠]/.test(s.title)).map((s) => [s.title, s.instrumental]), [['戦車', true], ['合戦', true], ['死闘', true], ['罠', true]]);
  assert.equal(parseTitle('OVERTURE(INST)', {}).instrumental, true);
});

// ---- shows: selection, years, credits -----------------------------------------------------------------------------
test('show selection: TV musicals, genre articles, umbrella articles and theme-park attractions are not stage shows', () => {
  assert.equal(decideFallback('The Adventures of Marco Polo (television musical)', null, {}).include, false);
  assert.equal(decideFallback('Sung-through', { desc: 'term describing a musical or opera with no spoken dialogue' }, {}).include, false);
  assert.equal(decideFallback('Theme park live adaptations of The Lion King', null, {}).include, false);
  const bb = parseArticle(fixtureText('Beauty and the Beast Live on Stage'), { title: 'Beauty and the Beast Live on Stage', lenient: true });
  assert.deepEqual([bb.isStageWork, bb.rejectedReason], [false, 'infobox attraction']);
});

test('stage musicals that Wikidata classes as a film/album are rescued; a "musical podcast" is not', () => {
  const marley = "{{Infobox musical\n| name = Get Up, Stand Up!\n| premiere_date = 1 October 2021\n| premiere_location = [[Lyric Theatre (London)|Lyric Theatre]]\n}}\n'''''Get Up, Stand Up! The Bob Marley Musical''''' is a jukebox musical.";
  assert.equal(rescueStageArticle('Get Up, Stand Up! The Bob Marley Musical', marley, []), '{{Infobox musical}}');
  const cinders = "'''''Mr. Cinders''''' is a musical comedy in two acts with a book and lyrics by Clifford Grey and Greatrex Newman.";
  assert.equal(rescueStageArticle('Mr. Cinders', cinders, ['1928 musicals']), 'no infobox; a "YYYY musicals" category and "… is a musical"');
  assert.equal(rescueStageArticle('Mr. Cinders', cinders, []), null); // no "YYYY musicals" category
  const podcast = "{{Infobox musical\n|premiere_date=June 14, 2017\n|productions=2017 Original Podcast Cast\n}}\n'''''36 Questions''''' is a 2017 musical [[podcast]] by Two-Up Productions.";
  assert.equal(rescueStageArticle('36 Questions', podcast, []), null);
  const both = "'''''Balada pro banditu''''' is a Czech stage [[musical play]] and film with music by Miloš Štědroň.";
  assert.ok(rescueStageArticle('Balada pro banditu', both, ['1975 musicals']));
});

test('year of first performance: concept albums and private previews are not premieres', () => {
  const jcs = infoboxYears({ premiere_date: '{{start date|1971|10|12}}', productions: '{{Plainlist|\n* 1970 [[Jesus Christ Superstar (album)|Concept album]]\n* 1971 [[Broadway theatre|Broadway]]}}' });
  assert.deepEqual([jcs.year, [...jcs.notFirst]], [1971, [1970]]); // Wikidata's 1970 (the album) is not used either
  const phantom = infoboxYears({ productions: '{{unbulleted list| 1985: 1st performance at Sydmonton |1986 [[West End theatre|West End]] |1988 Broadway}}' });
  assert.deepEqual([phantom.year, [...phantom.notFirst]], [1986, [1985]]);
  assert.equal(infoboxYears({ productions: '2005 [[Sydmonton Festival]]' }).year, 2005); // The Likes of Us: its real premiere
  assert.equal(infoboxYears({ productions: '{{ubl|1962 [[Broadway theatre|Broadway]]|1963 West End|1966 [[A Funny Thing Happened on the Way to the Forum (film)|Film]]}}' }).year, 1962);
});

test('credits: "and others" is left out; a name with digits is a name', () => {
  assert.deepEqual(creditNames('Max Martin and others'), ['Max Martin']);
  assert.deepEqual(creditNames('KEN the 390'), ['KEN the 390']);
  assert.deepEqual(creditNames('[[A]] (1998)<br>2004'), ['A']); // (a year is a remark)
});

test('parseItem: unquoted titles with "!", "Nos. 27 and 28 –", singers before a quoted title, "(sung by …)"', () => {
  const c = fakeCtx(['Doris', 'Martin', 'Felice', 'Max']); c.publicDomain = true;
  assert.equal(parseItem('Oh! What a Bump', c).title, 'Oh! What a Bump');
  assert.deepEqual(parseItem('Nos. 27 and 28 - Recit. and Song - Doris and Martin - "I thank you for your gifts..." and "All the wealth..."', c).singers, ['Doris', 'Martin']);
  assert.deepEqual(parseItem('Felice and Max "Although we are at war" (this song was added during the original run)', c).title, 'Although we are at war');
  assert.deepEqual(parseItem('"Spirit" (sung by Anna)', fakeCtx(['Anna'])).singers, ['Anna']);
});
