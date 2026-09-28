// Song-list parser: the tricky cases from the research (real, trimmed Wikipedia articles in
// test/fixtures) → expected catalog song records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsed, song, index } from './helpers.js';
import { parseArticle, parseItem, subpageMode, actOf, scoreBlock, looksLikeSingerParen, sentenceBreak } from '../src/parse-songs.js';
import { fakeCtx } from './helpers.js';

const rec = (s) => ({ title: s.title, act: s.act, singers: s.singers, singersRaw: s.singersRaw, ensemble: s.ensemble, reprise: s.reprise, instrumental: s.instrumental });
const expectSong = (show, title, expected, reprise) => {
  const s = song(show, title, reprise);
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(s[k], v, `${show} / ${title}: ${k}`);
};

test('1. Guys and Dolls: orchestra-only number with &nbsp;– separator is instrumental', () => {
  assert.deepEqual(rec(song('Guys and Dolls', 'Runyonland')),
    { title: 'Runyonland', act: 1, singers: [], singersRaw: 'Orchestra', ensemble: false, reprise: false, instrumental: true });
});

test('2. The Music Man: HTML comment mid-item, singers mapped to full names, "Ladies of River City" is ensemble', () => {
  expectSong('The Music Man', 'Pickalittle (Talk-a-Little)', {
    act: 1, singers: ['Eulalie Mackecknie Shinn', 'Maud', 'Ethel', 'Alma', 'Mrs. Squires'], ensemble: true, reprise: false,
  }, false);
});

test('3. The Music Man: "Barbershop quartet (Olin, Oliver, Ewart, Jacey)" → the four members + ensemble', () => {
  expectSong('The Music Man', 'Sincere', { singers: ['Olin', 'Oliver', 'Ewart', 'Jacey'], ensemble: true });
});

test('4. Gypsy: link label wins over target, {{efn}} note dropped', () => {
  expectSong('Gypsy (musical)', 'May We Entertain You', { singers: ['Baby June', 'Baby Louise'], ensemble: false, reprise: false });
});

test('5. Into the Woods: <small> singers and a trailing ** footnote marker', () => {
  expectSong('Into the Woods', 'Our Little World', { singers: ['Rapunzel', 'The Witch'], singersRaw: 'Rapunzel, Witch' });
});

test('6. Sweeney Todd: a group header bullet ("Parlor Sequence":) is skipped, nested items are songs', () => {
  const r = parsed('Sweeney Todd: The Demon Barber of Fleet Street');
  assert.ok(!r.songs.some((s) => /^Parlor Sequence/.test(s.title)));
  expectSong('Sweeney Todd: The Demon Barber of Fleet Street', 'Parlor Song (Part 1): Sweet Polly Plunkett', { act: 2, singers: ['Beadle Bamford'] });
});

test('7. Company: "Kathy (Instrumental)" is a danced number, not sung', () => {
  expectSong('Company (musical)', 'Tick-Tock', { instrumental: true, singers: [], ensemble: false, singersRaw: 'Kathy (Instrumental)' });
});

test('8. Les Misérables: piped link with quotes inside the label', () => {
  expectSong('Les Misérables (musical)', 'Do You Hear The People Sing?', { act: 1, singers: ['Enjolras', 'Marius Pontmercy'], ensemble: true }, false);
});

test('9. Phantom: italic title inside a medley, {{efn}} dropped, "The Phantom" → character', () => {
  const s = song('The Phantom of the Opera (1986 musical)', 'Il Muto/Poor Fool, He Makes Me Laugh');
  assert.equal(s.ensemble, true);
  assert.equal(s.singers.length, 3);
  assert.ok(s.singers.includes('Carlotta Guidicelli') && s.singers.includes('Ubaldo Piangi'));
});

test('10. Aladdin: writer-credit parenthetical "(Ashman/Rice)" and asterisk markers dropped', () => {
  expectSong('Aladdin (2011 musical)', 'Arabian Nights', { singers: ['Genie'], ensemble: true, reprise: false });
});

test('11. Aladdin: a qualified reprise stays in the title and is flagged', () => {
  expectSong('Aladdin (2011 musical)', 'Prince Ali (Jafar Reprise)', { reprise: true, singers: ['Jafar'], act: 2 });
});

test('12. Newsies: unbalanced quote "Entr\'acte – Orchestra †', () => {
  expectSong('Newsies (musical)', "Entr'acte", { instrumental: true, singers: [], singersRaw: 'Orchestra' });
});

test('13. Dear Evan Hansen: reprises by different singers are kept apart (no false duet)', () => {
  expectSong('Dear Evan Hansen', 'Waving Through a Window', { reprise: true, singers: ['Evan Hansen'] }, true);
  expectSong('Dear Evan Hansen', 'Waving Through a Window (Reprise 2)', { reprise: true, singers: ['Alana Beck'] });
});

test('14. Merrily We Roll Along: "Current songlist" chosen over the 1981 list; "(Part I)" stays', () => {
  const r = parsed('Merrily We Roll Along (musical)');
  assert.match(r.productionList, /current/i);
  expectSong('Merrily We Roll Along (musical)', 'Old Friends (Part I)', { singers: ['Mary Flynn', 'Charley Kringas'] });
});

test('15. Waitress: production label, then ";Act I<ref…>"; "Band" → instrumental', () => {
  expectSong('Waitress (musical)', 'Pomatter Pie', { act: 1, instrumental: true, singers: [] });
});

test('16. & Juliet: wikitable with rowspans; Original Artist column ignored', () => {
  expectSong('& Juliet', '...Baby One More Time', { act: 1, singers: ['Juliet Capulet'], singersRaw: 'Juliet' });
});

test('17. Once on This Island: table with ✓/✗ recording columns, no acts, "Storytellers" = ensemble', () => {
  expectSong('Once on This Island', 'We Dance', { act: null, singers: [], ensemble: true });
});

test('18. Dreamboats and Petticoats: numbered unquoted list, italic "(reprise)"', () => {
  expectSong('Dreamboats and Petticoats', "You Won't Catch Me Crying", { reprise: true, singers: ['Laura'] }, true);
});

test('19. Oh, What a Lovely War!: credit dropped; singers are actors → cleared for the whole show', () => {
  const r = parsed('Oh, What a Lovely War!');
  assert.equal(r.singersSource, 'actors-dropped');
  assert.ok(r.songs.every((s) => s.singers.length === 0));
  expectSong('Oh, What a Lovely War!', "I'll Make a Man of You", { singersRaw: 'Barbara Windsor' });
});

test('20. West Side Story: "Orchestra, danced by …" is instrumental; "Consuelo, danced by Company" is a solo', () => {
  expectSong('West Side Story', 'The Rumble', { instrumental: true, singers: [], ensemble: false });
  expectSong('West Side Story', 'Somewhere', { instrumental: false, singers: ['Consuelo'], ensemble: false });
});

test('21. Evita: "Eva and Perón" stays two singers', () => {
  expectSong('Evita (musical)', "I'd Be Surprisingly Good for You", { singers: ['Eva Perón', 'Perón'] });
});

test('22. Heathers: initial + surname → full names', () => {
  expectSong('Heathers: The Musical', 'Candy Store', { singers: ['Heather Chandler', 'Heather McNamara', 'Heather Duke'] }, false);
});

test('23. Anything Goes: "(reinstated for 1987, 2011)" dropped from a medley title', () => {
  expectSong('Anything Goes', "There's No Cure Like Travel / Bon Voyage", { singers: ['Sailor', 'Girl'], ensemble: true });
});

test('24. Mame: U+2212 minus sign as separator', () => {
  expectSong('Mame (musical)', 'St. Bridget', { singers: ['Young Patrick', 'Agnes Gooch'] });
});

test('25. Spring Awakening: "(except Ilse)" never makes Ilse a singer', () => {
  expectSong('Spring Awakening (musical)', 'My Junk', { singers: [], ensemble: true });
});

// ---- extra regression cases ----

test('Charlie Brown: "(sung over Beethoven\'s "Moonlight Sonata")" is a note; revised list chosen', () => {
  expectSong("You're a Good Man, Charlie Brown", 'Schroeder', { singers: ['Lucy van Pelt'] });
  assert.match(parsed("You're a Good Man, Charlie Brown").productionList, /revised/i);
});

test('Beetlejuice: finale medley keeps per-segment "(Reprise)" and is not itself a reprise', () => {
  const s = parsed('Beetlejuice (musical)').songs.find((x) => x.title.startsWith('Jump in the Line'));
  assert.equal(s.title, 'Jump in the Line (Shake, Senora) / Dead Mom (Reprise) / Home (Reprise) / Day-O (Reprise)');
  assert.equal(s.reprise, false);
});

test('Jersey Boys: a hyphen inside quotes is not a separator', () => {
  const s = song('Jersey Boys', 'Ces soirées-là (Oh What a Night) - Paris, 2000');
  assert.equal(s.ensemble, true);
});

test('Sound of Music: [[Ländler]] (instrumental)', () => {
  expectSong('The Sound of Music', 'Ländler', { instrumental: true, singers: [], singersRaw: '' });
});

test('Six: "Playout – The Ladies in Waiting" (the band) is instrumental; no acts', () => {
  expectSong('Six (musical)', 'Playout', { instrumental: true, act: null });
  assert.ok(parsed('Six (musical)').songs.every((s) => s.act === null));
});

test('Baroness Fiddlesticks: singers in a trailing parenthetical', () => {
  expectSong('Baroness Fiddlesticks', 'At a Fancy Costume Ball', { singers: ['Isabelle'], singersRaw: 'Isabelle' });
});

test('Rent: "Mr. and Mrs. Jefferson" are two singers (the compound character splits too)', () => {
  const s = parsed('Rent (musical)').songs.find((x) => x.title === 'Voice Mail #2');
  assert.deepEqual(s.singers, ['Mr. Jefferson', 'Mrs. Jefferson']);
  assert.ok(parsed('Rent (musical)').characters.some((c) => c.name === 'Mrs. Jefferson'));
});

test('Hamilton: "Hamilton" → Alexander Hamilton, "Burr" → Aaron Burr', () => {
  const s = song('Hamilton (musical)', 'My Shot');
  assert.deepEqual(s.singers, ['Alexander Hamilton', 'John Laurens', 'Marquis de Lafayette', 'Hercules Mulligan', 'Aaron Burr']);
  assert.equal(s.ensemble, true);
});

test('Shrek: the note bullet about the Seattle run is not a song; Broadway list chosen over the tour', () => {
  const r = parsed('Shrek the Musical');
  assert.equal(r.productionList, 'Broadway');
  assert.ok(!r.songs.some((s) => /seattle|replaced/i.test(s.title)));
});

test('Songs from Les Misérables: film-only items excluded; parent characters used for singers', () => {
  const r = parsed('Songs from Les Misérables');
  assert.ok(!r.songs.some((s) => /film only/i.test(s.title)));
  expectSong('Songs from Les Misérables', 'Prologue: Work Song', { singers: ['Javert', 'Jean Valjean'], ensemble: true });
});

test('Hamilton (album): album mode keeps titles only', () => {
  const r = parsed('Hamilton (album)');
  assert.ok(r.songs.length >= 40);
  assert.ok(r.songs.every((s) => s.singers.length === 0 && s.singersRaw === ''));
});

test('Disaster!: <br> inside a title → " / "', () => {
  assert.ok(parsed('Disaster! (musical)').songs.some((s) => s.title === "I Am Woman / That's the Way I've Always Heard It Should Be"));
});

test('Chicago: the note "In the 1975 Original Broadway Production … removed from the licensable music" → the 1996 revival list', () => {
  assert.match(parsed('Chicago (musical)').productionList, /1996/);
  expectSong('Chicago (musical)', 'Nowadays', { singers: ['Velma Kelly', 'Roxie Hart'] });
  assert.ok(!parsed('Chicago (musical)').songs.some((s) => /Chicago After Midnight/.test(s.title)));
});

test('Next to Normal: 2009 Broadway over 2008 Off-Broadway; medley with trailing "(Reprise)" flagged', () => {
  assert.match(parsed('Next to Normal').productionList, /2009 Broadway/);
  const reprises = parsed('Next to Normal').songs.filter((s) => s.title.startsWith("Make Up Your Mind / Catch Me I'm Falling"));
  assert.ok(reprises.some((s) => s.reprise));
});

test('Robber Bridegroom: the Broadway list with singers wins over the titles-only original', () => {
  assert.match(parsed('The Robber Bridegroom (musical)').productionList, /Broadway/);
});

test('Annie: the three "Maybe (Reprise)" numbers stay three entries (the source lists three)', () => {
  const maybes = parsed('Annie (musical)').songs.filter((s) => /^Maybe/.test(s.title));
  assert.deepEqual(maybes.map((s) => [s.title, s.reprise]), [['Maybe', false], ['Maybe', true], ['Maybe (Reprise 2)', true], ['Maybe (Reprise 3)', true]]);
});

test('Mamma Mia!: "Overture/Prologue – Sophie" is sung', () => {
  expectSong('Mamma Mia! (musical)', 'Overture/Prologue', { instrumental: false, singers: ['Sophie Sheridan'] });
});

test('The Prom: reprises keep the source wording ("(Mini-Reprise)", plain "(Reprise)", "(Act 2 Reprise)")', () => {
  const lives = parsed('The Prom (musical)').songs.filter((s) => s.title.startsWith('Changing Lives'));
  assert.deepEqual(lives.map((s) => [s.title, s.reprise]), [
    ['Changing Lives', false], ['Changing Lives (Mini-Reprise)', true], ['Changing Lives', true], ['Changing Lives (Act 2 Reprise)', true]]);
});

test('gate: pages about people / bands / theme parks yield no songs', () => {
  for (const t of ['Frederick Loewe', 'Sektor Gaza']) assert.equal(parsed(t).isStageWork, false, t);
  assert.equal(parsed('Mr. Burns, a Post-Electric Play').songs.length, 0); // no list → nothing mined from prose
  assert.equal(parsed('Little Nellie Kelly (musical)').songs.length, 0);
});

// ---- invariants over every fixture ----

test('every fixture: positions 1..n, no duplicate (title, reprise), instrumentals never sung, no lyric-length titles', () => {
  for (const e of index) {
    const r = parsed(e.title);
    const seen = new Set();
    r.songs.forEach((s, i) => {
      assert.equal(s.position, i + 1, `${e.title}: position`);
      const k = `${s.title.toLowerCase()}|${s.reprise}`;
      assert.ok(!seen.has(k), `${e.title}: duplicate ${s.title}`);
      seen.add(k);
      if (s.instrumental) assert.ok(!s.singers.length && !s.ensemble, `${e.title}: ${s.title} instrumental but sung`);
      assert.ok(s.title.length <= 160 && s.title.trim() === s.title && s.title.length > 0, `${e.title}: title "${s.title}"`);
      assert.ok(s.act === null || (Number.isInteger(s.act) && s.act >= 1), `${e.title}: act`);
      for (const g of s.singers) assert.match(g, /\p{L}/u, `${e.title}: singer "${g}"`);
    });
  }
});

// ---- small units ----

test('actOf', () => {
  assert.equal(actOf('Act II'), 2);
  assert.equal(actOf('Act One'), 1);
  assert.equal(actOf('Part 3'), 3);
  assert.equal(actOf('Second Act'), 2);
  assert.equal(actOf('Prologue'), 'prologue');
  assert.equal(actOf('1975 Broadway'), null);
});

test('scoreBlock prefers current/Broadway lists with singers, never film lists', () => {
  const items = (n, withSingers) => Array.from({ length: n }, (_, i) => ({ singers: i < withSingers ? ['X'] : [], ensemble: false, instrumental: false }));
  assert.ok(scoreBlock({ label: '2012 film', items: items(20, 20) }) < scoreBlock({ label: 'Original', items: items(10, 0) }));
  assert.ok(scoreBlock({ label: 'Broadway', items: items(20, 20) }) > scoreBlock({ label: 'Off-Broadway', items: items(20, 20) }));
  assert.ok(scoreBlock({ label: 'Revised version', items: items(10, 10) }) > scoreBlock({ label: 'Original', items: items(20, 20) }));
});

test('subpageMode follows song-list pages and cast albums, never mixtapes/films/compilations', () => {
  assert.equal(subpageMode('Songs from Les Misérables'), 'songs');
  assert.equal(subpageMode('List of songs in Cats'), 'songs');
  assert.equal(subpageMode('Hamilton (album)'), 'album');
  assert.equal(subpageMode('Wicked (musical album)'), 'album');
  assert.equal(subpageMode('Dear Evan Hansen: Original Broadway Cast Recording'), 'album');
  assert.equal(subpageMode('The Hamilton Mixtape'), null);
  assert.equal(subpageMode('Les Misérables (2012 film)'), null);
  assert.equal(subpageMode('Dreamboats and Petticoats (compilation album)'), null);
  assert.equal(subpageMode('Hamilton (musical)'), null);
});

test('looksLikeSingerParen', () => {
  assert.equal(looksLikeSingerParen('Pour, oh pour, the pirate sherry (Samuel and Chorus of Pirates)'), true);
  assert.equal(looksLikeSingerParen('At a Fancy Costume Ball (Isabelle)'), true);
  assert.equal(looksLikeSingerParen('Ces soirées-là (Oh What a Night)'), false);
  assert.equal(looksLikeSingerParen('(Isabelle)'), false);
});

test('sentenceBreak ignores abbreviations and initials', () => {
  assert.equal(sentenceBreak('Mr. Cellophane'), false);
  assert.equal(sentenceBreak('St. Bridget'), false);
  assert.equal(sentenceBreak('J.D. and Students', true), false);
  assert.equal(sentenceBreak('A song. It was cut'), true);
  assert.equal(sentenceBreak('was inserted; subsequently cut', true), true);
});

test('parseItem: numbered operetta items with parenthetical singers (G&S style)', () => {
  const ctx = fakeCtx(['Samuel', 'Ruth', 'Frederic']);
  const a = parseItem('1. "Pour, oh pour, the pirate sherry" (Samuel and Chorus of Pirates)', ctx);
  assert.equal(a.title, 'Pour, oh pour, the pirate sherry (Samuel and Chorus of Pirates)'); // list-level pass splits these
  const r = parseArticle(['== Musical numbers ==', '* 1. "Pour, oh pour, the pirate sherry" (Samuel and Chorus of Pirates)',
    '* 2. "When Fred\'ric was a little lad" (Ruth)', '* 3. "Oh, better far to live and die" (Pirate King and Chorus of Pirates)',
    '== Roles ==', '* Samuel', '* Ruth', '* The Pirate King'].join('\n'), { title: 'Test' });
  assert.deepEqual(r.songs.map((s) => [s.title, s.singers, s.ensemble]), [
    ['Pour, oh pour, the pirate sherry', ['Samuel'], true],
    ["When Fred'ric was a little lad", ['Ruth'], false],
    ['Oh, better far to live and die', ['The Pirate King'], true],
  ]);
});

test('parseItem: number designations and singer-first items never put lyric lines into singers', () => {
  const ctx = fakeCtx(['Rudolph', 'Marjorie', 'Tom']);
  const a = parseItem('No. 3a – Reprise for Exit – "And this is the hand that seeks a mate"', ctx);
  assert.equal(a.title, 'Reprise for Exit');
  assert.equal(a.singersRaw, '');
  const b = parseItem('No. 6. Rudolph – "Is love a dream that fades with dawn of day, too sweet to last night night has passed away"', ctx);
  assert.equal(b, null); // a whole lyric line is not a title
  const c = parseItem('No. 3 – Marjorie – "Over the hills"', ctx);
  assert.equal(c.title, 'Over the hills');
  assert.deepEqual(c.singers, ['Marjorie']);
  const d = parseItem("Entr'acte and Woodcutters' Chorus – \"Before our broad axes, lo! they fall, the kings of the forest, old and tall!\"", ctx);
  assert.equal(d.singersRaw, '');
  const e = parseItem('Anita, Pepita, Frank and Reginald – If you see a little bag lying down upon a flag', ctx);
  assert.equal(e.singersRaw, '');
});

test('parseItem: prose and notes are not songs; notes after the separator are not singers', () => {
  const ctx = fakeCtx([]);
  assert.equal(parseItem('"Crunchy Granola Suite" – Music and Lyrics by Neil Diamond', ctx).singersRaw, '');
  assert.equal(parseItem('Fox Trot – featured the dancers Renee Adoree and Lewis Sloden', ctx).singersRaw, '');
  assert.equal(parseItem('A rendition of "Granger Danger" performed by Darren Criss is played during the credits of the YouTube version.', ctx), null);
  const m = parseItem("Entr'acte <small>- In both the 1999 premiere and the Hamburg 2001 production, a second prologue was inserted at this point; subsequently cut.</small>", ctx);
  assert.equal(m.title, "Entr'acte");
  assert.equal(m.singersRaw, '');
  assert.equal(m.instrumental, true);
  const n = parseItem('Two Sleepy People (Music and lyrics by Hoagy Carmichael and Frank Loesser', ctx);
  assert.equal(n.title, 'Two Sleepy People');
  const o = parseItem('"Growltiger\'s Last Stand" (including "The Ballad of Billy M\'Caw") – Growltiger, Griddlebone', ctx);
  assert.equal(o.title, "Growltiger's Last Stand");
  const p = parseItem('Tentacles (7:04) ("Prologue: Tradition")', ctx);
  assert.equal(p.title, 'Tentacles ("Prologue: Tradition")'.replace(/"/g, ''));
});
