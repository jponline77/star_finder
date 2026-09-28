# Catalog builder (`tools/catalog`)

Maintainer tool that builds `server/seed/catalog/catalog.json.gz` — every stage musical (plus
operettas and revues) that has an English Wikipedia article, with its song list, who sings each
song, characters and voice types (SPEC §7c). It has its own `package.json` (no runtime
dependencies, Node ≥ 22) so it never touches the server's dependencies.

```sh
npm run catalog:build              # from the repo root
npm run build [-- --refresh|--offline|--only "Title|Title"|--out DIR|--accept-review]   # from here
npm test                           # parser tests (offline, fixtures in test/fixtures)
npm run verify                     # sample-check the built catalog against live Wikipedia pages
```

- `--refresh` re-downloads everything; by default every raw API response is reused from
  `.cache/` (gitignored), so a rebuild is fast and gives identical output.
- `--offline` never touches the network (fails if something is missing from the cache).
- `--only` builds a few articles into `.cache/out-only/` for debugging.
- `--out DIR` writes the catalog files to another directory (a trial build).
- **Vandalism gate** (`src/review-gate.js`): before the seed file is replaced, the build compares
  the new content with it and writes a readable diff to `.cache/diff-<version>.txt` (shows added and
  removed, credits changed, songs added/removed, singers changed) — review it before committing a
  rebuild, since the `.gz` itself can't be diffed. Anything **new or changed** that looks like
  vandalism (strong profanity or slurs, "… is gay"/"hacked by"-style phrases, links, e-mail
  addresses or handles, keyboard mashing, emoji, shouting, a song list that lost most of its songs,
  or a catalog that shrank by more than 10%) stops the build with exit code 2 and nothing written;
  the console lists each flag with a link to the exact Wikipedia revision the build read. If it is
  vandalism, wait for the article to be reverted and build with `--refresh` (or add an override); if
  the text is genuine (e.g. a new show whose real song titles swear), build again with
  `--accept-review`. Text that was already in the previous catalog is never flagged again, and a
  first build (no previous file) is not gated.
- Review lists (what was excluded and why, redirects, pages rejected as not-a-stage-work,
  fallback additions, unknown templates, page revisions used) go to `.cache/review.json`;
  `npm run verify` writes `.cache/verify-report.json`.
- `overrides.json` holds manual corrections keyed by Wikidata QID, each with its reason:
  `forceInclude`, `forceExclude`, and `preferList` (which production list of an article to use when
  the article's own notes can't tell the parser — e.g. Shrek's licensed US-tour list).

Network etiquette: every request sends the User-Agent
`STARSongFinderCatalogBuilder/1.0 (https://github.com/jponline77/star_finder)`; Wikidata queries
run one at a time (≥ 1.5 s apart) and are retried on 429/Retry-After or a truncated body;
Wikipedia requests are batched (50 titles), sent ≤ 4 per second with `maxlag=5`, and honour
Retry-After.

## Pipeline (`src/build.js`)

1. **Select** (`wikidata.js`, `queries/select.rq`, `rules.js`) — items whose form of creative work
   (P7937), genre (P136) or class (P31) is a musical/operetta/revue form, plus "dramatico-musical
   works" whose English description or title says musical/revue/operetta; all with an enwiki
   article. `rules.js` keeps staged works and drops films, TV (also "television/TV musical"
   descriptions and disambiguators), songs, albums, people, groups, genre/term articles, theme-park
   attractions, list and umbrella articles ("… adaptations of …") (class flags from
   `queries/class-flags.rq`). Operas are not included.
2. **Fallback** — articles in the Wikipedia "YYYY musicals" categories and a few others
   (Broadway/West End/Off-Broadway musicals, operettas, revues …) that Wikidata misses (mostly
   new shows), filtered with the same rules (`queries/item-info.rq`); then `overrides.json`
   (every override exclusion is logged in `review.json` with its reason). Comic operas that
   Wikidata types only as "opera" (Iolanthe, The Sorcerer, Orpheus in the Underworld …) come from
   the Gilbert & Sullivan / Savoy / English comic opera / opéra bouffe / "Operettas by …" categories;
   an article found only through an opera category is kept only when it is a comic opera (category
   or description), never a grand/romantic opera or a genre article.
   **Rescue** — an article dropped only because of its Wikidata class is kept when its first
   infobox is an `{{Infobox musical}}` with a dated premiere/productions line, or when it has no
   infobox, sits in a "YYYY musicals" category and its lead says it "is a … musical" (Get Up, Stand
   Up!, Mr. Cinders) — never when the opening calls it a podcast, film, TV or album work ("a 2017
   musical podcast"); `review.json › rescued` lists them (`rules.js › rescueStageArticle`).
3. **Check pages** (`wikipedia.js`) — resolve every title; drop sitelinks that redirect elsewhere,
   duplicates and disambiguation pages; read categories and incoming redirects.
4. **Facts** — credits, dates, genres, characters (`queries/statements.rq`) and labels/aliases/
   descriptions (`queries/labels.rq`) for all items.
5. **Parse** each article (`parse-songs.js`, `parse-characters.js`, `normalize.js`), follow a
   linked "Songs from …"/cast-recording page when the article has no list.
6. **Assemble** (`shows.js`) and write `catalog.json.gz` (validated by `format.js`), `stats.json`
   and `README.md`. The version (`YYYY-MM-DD.N`) only changes when the content changes, and a
   version string is **never issued twice for different content** (`src/version.js`): every
   version is recorded with the SHA-256 of its content in `versions.json` (committed; builds into
   `server/seed/catalog`) and `.cache/versions-issued.json` (every build, trial builds with `--out`
   included). N is one more than the highest N issued that (UTC) day in either ledger or in the file
   being replaced — so restoring an older `catalog.json.gz` can't make the next build reuse a number
   (round 3: ".7" had been issued twice, and databases that had loaded the first never reloaded).
   Content issued before keeps its version. Do not edit or trim the ledgers.

Show fields: title = enwiki title without its "(… musical)" disambiguator; alternative titles =
Wikidata label/aliases, a "… the Musical"-less variant and Wikipedia redirects that share a word
with the title; composer/lyricist/book = the article's infobox (the English lyricist when the
infobox marks languages; `composer`/`librettist` of an opera infobox), else Wikidata (never
"Various", "Revue basis" or remarks); year = the first performance, i.e. the earliest of the
infobox premiere date / "productions" list (film, recording, workshop and concert lines ignored),
Wikidata's first performance (P1191) and the "YYYY musicals/operettas/revues/operas" category —
tryouts and regional premieres count (Newsies 2011, Jersey Boys 2004), but a year the infobox
itself marks as a concept album, a private preview or a reading is not a premiere (Jesus Christ
Superstar 1971, The Phantom of the Opera 1986); else Wikidata's publication/inception year
(`review.json › yearConflicts` lists sources that disagree by more than two years, including an
earlier year in the Wikipedia/Wikidata short description, which is never used on its own); a
composer credit that lumps the lyricist in is split, and an English comic opera's librettist is
its lyricist; alternative titles never include character, tour, concert, fan or typo redirects;
genres = useful Wikidata genres
+ categories such as "Sung-through musicals", "Jukebox musicals", "Rock musicals"; description =
the Wikidata description (CC0). Credits the infobox and Wikidata both lack are taken from the
article's opening sentences ("with music by [[A]] and lyrics by [[B]]", "book and lyrics by …",
"[[Richard Rodgers]] (music) and [[Lorenz Hart]] (lyrics)"; never "based on the book by …"; a
surname alone takes the full name written earlier; `shows.js › leadCredits`). A title with "&"
also gets its "and" form as an alternative title ("& Juliet" → "And Juliet"), and a redirect that
names a part of the show ("Florodora girl", "Florodora sextette") is not an alternative title.
Wikidata character lists lose chorus lines ("SATB Chorus, Cupids …, Soldiers") and qualifiers.

## How the parser works

The parser reads wikitext (no HTML) and never mines plot summaries or prose.

1. **Gate** — a page whose first infobox is about a person, band, film, TV show, venue … is not a
   stage work (for Wikidata-typed stage works an album/book infobox is tolerated); nor is a circus,
   ice or magic show (`{{Infobox stage production}}` with genre "Contemporary circus": Love, Mad
   Apple — unless the short description calls it a musical: Paramour).
2. **Find the song section** — headings "Musical numbers", "Songs", "Song list", "Numbers",
   "Principal songs", "List of songs", "Musical program(me)" … also with qualifiers ("Songs
   (Broadway)", "1927 song list", "Musical numbers (English adaptation)"; English lists before
   other-language ones). The first one with ≥ 3 items wins — unless another sits under a heading
   named after the show ("1996: ''By Jeeves''" after "1975: ''Jeeves''"); then a weak
   "Music"/"Score" heading if most items name singers or it holds a table with a title column. Headings about cut/deleted/additional songs, recordings, albums, films,
   charts, analysis are skipped. Nested matching headings belong to their parent. If the article
   has no list: a linked "Songs from …"/cast-recording page, else the article's own cast-recording
   track listing (titles only; `{{Track listing}}`, numbered lists or tables — never cast lists).
3. **Split into production lists and acts** — sub-headings, `;definition` lines, bold lines
   (also when glued to `{{col-begin}}`, or followed by `{{sfn}}` footnotes), plain "Act 1" lines,
   "* Act 1" bullets and full-width table rows label acts ("Act II", "Act One", "Prologue") and
   productions ("1975 Original Broadway Production", "Revised version", "2009 Broadway"). When the
   act structure starts again ("; Chicago" / "; Act I" after the Broadway list's Act II) a new list
   begins, labelled by the line before it; italic lines ("''Guthrie Theater''") and a prose line
   such as "The current version is as follows:" label lists too, as do bullets that are only a bold
   production label ("*'''1978 Broadway production'''"), a plain production line between two lists
   ("Boston") and a list's intro line ("… on the cast album:"). Two lists written one after the
   other with no label between them are split where the same run of titles starts again, so they
   never merge into fake reprises. Notes/legend/cut-song blocks,
   "History of revisions"/"Changes"/"Notes" subsections and discography/chart tables are skipped.
   The best production list wins: a note next to a list that it is the standard/licensed version
   wins (Grease 1972); a note that names a list whose songs were "removed from the licensable music"
   loses (Chicago 1975); current/revised/licensed labels and Broadway beat Off-Broadway,
   workshops, tours and (slightly) revivals; recording/concept-album lists ("1994 Complete Works")
   lose; a list that notes say was an earlier version loses; film lists never win; lists with
   singers beat titles-only lists; "1998 onwards" counts as current (The Fix); a list labelled
   with the show's own title beats lists labelled with its earlier titles ("Road Show, 2008 …" over
   "Bounce, 2003 …"); an `overrides.json › preferList` entry decides when nothing else can (Shrek's
   US tour, Carrie's rewritten 2012 revival).
   **Numbers from other lists** (`addFromOtherLists`): the chosen list stays the song list, and a
   number that only a *later* production list of the article has (a revival, a revised or current
   version — Grease's "Hopelessly Devoted to You", "You're the One That I Want", "Sandy") is added
   after the number it follows in its own list (its act and position come from there). Never from
   an earlier list (numbers cut from the licensed version stay out: Shrek's "Donkey Pot Pie",
   Chicago 1975), a film/recording/workshop/tryout/concert/published-edition list, a list in
   another language or one sharing < 30% of its numbers, and never in a revue; reprises,
   instrumentals, generic numbers, curtain-call medleys, numbers with no singers in a list that
   names them, and spelling variants or longer names of a number the list has ("I Love A Little
   Town" = "A Little Town") are not added. A number listed twice in the other list is taken where
   it has the fewest singers (the number itself, not a reprise). The notes under a list add the
   numbers they say productions use (`addFromNotes`): "† Sometimes replaced by "Something Good""
   (after the marked number, with its singers), "Many stage revivals have also included "I Have
   Confidence"…" — never a single staging's ("In the 2018 Seattle production …"), a cut or a
   film-only number. `review.json` does not list them; `res.addedFromOtherLists` does (tests).
4. **Items** — bullet and numbered lists (nested bullets under a "Group:" header; "1." / "No. 3"
   numbering removed), wikitables (title and performer columns found by header, rowspan/colspan
   honoured, recording/writer columns ignored; layout tables that only arrange bullet columns are
   read as plain lines; bilingual tables use the English-title column), `{{Track listing}}`,
   `{{Ordered list}}`/`{{ubl}}`/`{{plainlist}}`, "Title - Singers" or "2. Title (Singers)" lines
   without bullets, "Title ..... Singers", lists that give singers in a trailing parenthetical
   ("Pour, oh pour, the pirate sherry (Samuel and Chorus of Pirates)") — unless the parenthetical
   is a credit ("Note: composers in parentheses") or links to source songs/films (then it is
   dropped from the title) —, and old operetta / musical-comedy lists: "Rudolph – "…"",
   "N. Song with Trio – "Be wise in time …" (Dorothy, Lydia)", "Duet – Susan & Gigg – "If ever I
   marry …"", "Song: Omar and Chorus – "When I am King"", "Duet (Rosette, Vincent) – Title
   (gloss)": the kind of number ("Song with Trio", "Act I Finale") is a label, the quoted number is
   the title; Spanish/Italian/German form labels ("Preludio", "Seguidillas", "Couplets", "Terzett")
   and nested quotes ('"Duet – 'X'"') are read the same way. A first line of lyrics is used as a title only for works first performed before 1930
   (public domain; cut at a phrase break if long); in later works a number known only by a lyric
   excerpt ("Sometimes my father appeared …", "'…Lift Your Razor High…'") is left out
   (`review.json › lyricTitlesDropped`). In such lists the numbers without a quoted title and
   without singers (introductions, entrance music, dances) are instrumental. A list-level
   "Aria: Glitter and Be Gay" / "Duet: Oh, Happy We" prefix is dropped (not a single "Tango: Maureen").
   Also (round 3): bilingual lines "Original "title" – "translation" – Singers" (the last part is
   the singers; a French/Italian/German form label before the quoted title goes: 'Air de Pâris "Au
   mont Ida"', 'Duo Hélène-Pâris "Oui c'est un rêve"'; the label names the singers when nothing
   else does: 'Couplets (Atala) "Petit bébé"'); combined Gilbert & Sullivan lines '"A" (Captain
   and Ensemble) and "B" (Boatswain and Ensemble)' (one number, all the singers — only when each
   bracket names a character or the chorus: not '"X" (Backstreet Boys) / "Y" (NSYNC)'); songbook
   revues '"A", "B" and "C" from ''Show'' (1937)' (three numbers, the source note goes); "(Singers)
   – "first line"" (The School Girl); '"Title", Pt. 2' ("Title (Pt. 2)", not a reprise); a version
   qualifier before the title ("22. (original) …", "(replaced) …"); "Cut song: …" items dropped;
   a hyphen glued to the singers after a closing quote ('" -Mary Jane'); a label inside the opening
   quote ('"Finale: "A" / B" – Company'); a remark after the title's bracket ("Timid Frieda (Les
   Timides) tune also used in …"); danced numbers ('– (Dancers)', '– Dance of Metal Imps', '– featured
   the dancers …') are instrumental. Tables whose header names no title column are read by content
   (the leftmost column that is not numbers, credits, singers, kinds of number or notes is the
   title; a singers column after it, a "Chœur"/"Couplets" column before it names numbers that have
   no title: The Arcadians, La Périchole); "Title + Performer", "First line in English" and
   "Musical item" columns are title columns; one column per version ("1858 version | 1874
   version") makes one production list per column (not when the cells are notes: Anything Goes).
   A list whose items are one per line with slash-separated titles and singers ("A Miracle Would
   Happen/When You Come Home to Me – Jamie/Cathy") gives one number per part when each part has its
   own characters.
5. **Clean-up** (`normalize.js`) — refs, comments, footnote markers (†, ‡, *, …), links (the label
   wins), formatting and entities are removed; `<br>` becomes " / ". The title/singers separator
   is the first dash (–, —, " - ", "--", −) outside quotes and parentheses. Quoted segments joined
   by "/" or "and" form a medley "A / B". Credit notes ("(music by …)", "(Ashman/Rice)"),
   version notes ("(added in 1987)", "(2004–2009)" — a number replaced by a "(2009–present)" one
   is left out), explanations ("(including …)", "(includes …)", "(which is …)", "(short)",
   "(Theme Song from …)", "(new song)"), `<small>` translation glosses ("Inútil (Useless)"),
   editorial [notes], writer credits after a quoted title ("… " by [[A]] & [[B]] – singers") and
   durations are dropped; "(2012 film only)" items are dropped. Footnote markers include runs of
   "*" / "#" after a word ("Overture*#"; "#1" stays). "/" becomes " / " between medley parts but
   not inside short tokens ("AC/DC", "30/90"). Prose bullets, production notes after the dash
   ("Included in all stage versions"), italic source-show titles after the dash (Side by Side by
   Sondheim, when most of the list does it) and quoted lyric lines are never kept as titles or
   singers. '"A" … "B"' is one number. Translation glosses: when most bracketed parts of a list
   translate a French/Spanish/German/Italian title into English ("Mangeons vite (Let us eat and drink
   quickly)", '"Quand on arrive en ville" ("When We Come to Town")') they are dropped; when they give
   the original of an English title and would otherwise be read as singers ("Marathon (Les
   Flamandes)", "Alone (Seul)" — Jacques Brel) they are dropped too; an italic bracket after a title
   is its translation. "(known as "…")" keeps the other name in the title; "(Les Preludes by Franz
   Liszt)", "(in Mandarin)" and "()" left by a dropped template go; "(Reprise I)" → "(Reprise 1)".
6. **Flags** — *reprise*: any "(Reprise…)", "– Reprise", "(…) reprise", "(reprise of …)"; bare
   markers are removed from the title (their number is kept: "(reprise 6)" → "(Reprise 6)"),
   qualified ones ("Prince Ali (Jafar Reprise)", "(Mini-Reprise)") stay; in a medley the marker
   stays on its part ("No Matter What (Reprise) / Wolf Chase") and the number is a reprise when its
   first part (or every part) is one; a medley listed again as a whole is a reprise of it. *instrumental*: "(Instrumental)", "(INST)", "– Instrumental", "Orchestra/Band …", "Danced by …", a bare
   "Dance"/"Ballet" number (even with dancers named), or an overture/entr'acte/playoff/bows title
   (every part of "X and Y" must be one: "Prelude and Simply Heavenly" is sung) or a dance label
   ("Dance at the Gym", not "Dance With Me") with nobody named — never when a character sings
   ("Overture/Prologue – Sophie"); a medley with one singer group per part ("Golden Bangkok / One
   Night in Bangkok – Instrumental / Freddie") is sung. *ensemble*: company/chorus/ensemble or a
   group ("Townspeople", "Ladies of River City", "The Jets", "Year 11", "Kit Kats", "Delta Nus",
   "Mission Band", "Paparazzi", "Workmen", "VC (virtual community)", "Secretaries to Mr. X").
7. **Singers** — split on `, ; & / + and with`; a role of the character list wins over group
   words ("The Fates") — but a role that is several people ("The Fates", "Elle's Parents", "The
   Twins": a plural or collective head noun, `isGroupRole`) also makes the number an ensemble one, so
   it is never guessed as a Solo or a Duet; groups become the ensemble flag (round 3 lexicon:
   "Associates", "The Sixth Form", "Fifth and Sixth Forms", "The Manhattan Comedy Four", "Metal
   Imps", "Cherubs", "Jitterbugs", "Doubles", "Employees", "Court Personnel", "T-Birds", "Henderson's
   Razorbacks", "Soli"; a bracketed chorus part "Kitty Savary, (Gentlemen)"; "(as other Students)"
   is a note; "Peter and Trio" keeps Peter; "1st & 2nd Congressmen" → First and Second Congressman) ("Sergeant of Police" is a role: the head of
   "X of Y" decides); "Soloist", "Act I", "Concerted number" are dropped; each remaining name is
   matched to the Characters/Roles section (exact, "H. Chandler" → Heather Chandler, "J.D."
   nickname, first + last name ignoring middle names/initials/nicknames, "Mr. Hawkins" → Tom
   Hawkins, "Kevin G" → Kevin Gnapoor, a unique first/last name — "Valjean" → Jean Valjean,
   never a "Young …" variant —, a short form "Cliff" → Clifford Bradshaw, a shared surname → the
   protagonist unless ambiguous: Evita's "Eva and Perón" stays two people, a name written in full
   elsewhere in the list "Lee" → "Charles Lee"; "Mark's Mother" → Mrs. Cohen; "Madam" = Madame;
   first names of a longer name "Carl-Magnus" → Count Carl-Magnus Malcolm; last resort, one letter
   apart: "Jamerson" → J. Jonah Jameson, "Cecil B. DeMile" → Cecil B. DeMille, English forms of
   accented or classical names "Helen" → Hélène, "Menelaus" → Ménélas, "Orestes" → Oreste — never
   "Louis" → Louise or "The Shirelles" → Shirelle); two different names in one item never become the
   same person ("Audrey and Audrey II"); unknown minor roles are kept as written. When the names
   are actors (cast/awards tables, "played by …", "the cast included [[A]], [[B]] …", a revue's
   Cast section, or a note that the list names performers), singers are cleared for the whole show
   and `singersRaw` keeps the text; a performer the cast list maps to a role ("Lee Kernaghan as the
   Balladeer") is replaced by that role. Suffixes and particles stay with the name ("Corey Jr.",
   "D'Artagnan"), "Joan 1, 2 and 3" is three roles, "Lead Vocals"/"N/A" are not singers, and a group
   word ("Tribe", "Whos", "Suspects") is the ensemble unless the character list has it as a role.
8. **Characters** (`parse-characters.js`) — from "Characters"/"Roles"/"Cast" sections (tables and
   lists, nested `:*` bullets); voice types as stated: a voice-type column, a trailing voice link,
   "Name (tenor)", "vocal range: [[soprano]]", "Voice type: [[Tenor]]", "Role - Actor - Baritone"
   (compound types kept: mezzo-soprano, bass-baritone, boy soprano; the first of "(tenor or
   baritone)"); aliases ("Anya / Anastasia", "X, posing as Y") match singers but are not separate
   roles; ALL-CAPS lists are title-cased; doubling lists and "; Principals"-type labels are skipped;
   dual roles split ("Jekyll / Hyde", "Coricopat and Tantomile", "Mr. and Mrs. Jefferson",
   "Sisters Berthe, Margaretta and Sophia"); variants merged ("Diana" → "Diana Goodman",
   "Countess Natasha Rostova" = "Natasha Rostova") but never numbered or aged roles ("Audrey II",
   "Young Ben") or different titles ("Duke of X" / "Duchess of X"); groups removed except rows of a
   cast table ("The Fates"); actors ("[[Actor]] – Anna, Thea", "[[Actor]]: [[Role]]" cast lists —
   the side that repeats across productions is the role), creative-team rows, "Alternate for …",
   quoted song titles (Godspell) and prose ("In Larson's script") removed. In a cast list written
   "Actor as Role" or "Actor (Role)" (judged per subsection), a bare name, "A / B (double cast as
   the rival)", "Actor as rival" and "Actor: description" lines are actors, not roles. Which side
   of a dashed cast list names the performers is judged per subsection (`actorSideOf`): links to
   person articles on one side only ("[[Janis Paige]] – Doris Walker" in Here's Love; "Role—[[Actor]]"
   with an em dash in The Tik-Tok Man of Oz; "Role ... Actor" in The Midnight Sons), or personal
   names opposite short role lists ("Gene Curty – Judge, OCS Sergeant" in The Lieutenant — not a
   list of roles with descriptions); "[[Actor]] starred as The Lieutenant" names a role; a role
   linked in the productions prose ("as Zeke/the [[Cowardly Lion]]") is not an actor. An italic
   description after a name goes ("Richard Dauntless ''His Foster-Brother''"; "''Disguised as Robin
   Oakapple''" makes Robin an alias); a voice type written after the name is the voice ("Nini
   soprano"); "; Mortals"-type labels, cover rows ("Spider-Man Alternate", "Others") and chorus lines
   are not roles; "Cee Cee Bloom" = 'Cecelia Carol "Cee Cee" Bloom'; a character table's "Inez
   Alvarez (Mamita)" makes Mamita an alias. A casting-history or production-cast section ("Casting",
   "Historical casting", "Broadway cast") is read only when no character list came before it. If
   the article has none, Wikidata's character list is used.
9. **Numbering** — nothing is merged: every numbered item of the source list is one entry. A song
   listed again (an encore, a finale) is a reprise; a reprise keeps the source's number or wording
   ("Carrying the Banner (Reprise 2)", "(Mini-Reprise)"), a repeated one gets the next free
   "(Reprise N)" — a reprise never turns a solo into a false duet; two generic numbers ("Dance",
   "Quartet", "Finale") become "Dance (Act 2)" / "Dance (3)". Titles are unique per show + reprise
   (titles in other scripts keep their own letters in the key, so "戦車" and "合戦" stay two songs).

## Tests

`test/fixtures/` holds trimmed, lyric-free excerpts of 250 real articles (infobox, song/character/
cast sections, version notes and the links of other tables; see `test/fixtures/README.md` for
sources and licence). `scripts/make-fixtures.js` rebuilds them, replaces lyric excerpts used as
number names in works still in copyright by a "La la la…" placeholder, and refuses to write a
fixture that parses differently from the full article. `test/audit-r1.test.js`,
`test/audit-r2.test.js` and `test/audit-r3.test.js` pin the fixes for every defect class of the three quality audit
rounds (a fixture entry may carry the show's `preferList`); `test/regression.test.js` snapshots every
fixture's output — after reviewing an intended change run `UPDATE_SNAPSHOTS=1 npm test`.

`npm run verify` also checks item structure over the whole catalog (offline): generic titles
("Quartet", "Song") repeated in a show, leftover markers/notes in titles, acts going backwards,
labels read as singers, singer names that match no character or group word, shows with 4+
songs in a row listed again (two lists merged?), plural-looking names kept as singers and legend
markers left in singer text; the title sample is stratified (a third operettas and revues).
`--catalog <file>` checks another build (e.g. one written with `--out`).
