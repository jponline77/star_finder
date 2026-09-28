# Test fixtures

Trimmed excerpts of English Wikipedia articles, used only by the parser tests. Each file keeps the
article's first infobox, its song-list / character / cast sections (list lines, tables and short
lines, and the notes that say which list is the licensed/current version) and, from other tables
and "the cast included …" sentences, only the links (actor names). Plot summaries, prose,
quotation and poem templates and references are removed — **no lyrics**: where an article names
numbers of a work still in copyright by a line of its lyrics (Fun Home, Sweeney Todd), the fixture
has a "La la la…" placeholder instead (the parser leaves such numbers out either way). First lines
of public-domain operettas (before 1930) are kept, as the articles use them as the numbers'
titles. `index.json` lists each article with the revision the excerpt was taken from (`url` = that
exact revision; `kind: "revue"` = parsed as the build parses a revue; `year` = the year the build
uses for an article without an infobox date; `lenient` = parsed as a Wikidata-typed stage work;
`preferList` = the show's `overrides.json › preferList` label).

Source: English Wikipedia contributors, licensed under CC BY-SA 4.0
(<https://creativecommons.org/licenses/by-sa/4.0/>); the full list of authors of each article is
on its history page. These excerpts are shared under the same licence.

Regenerate with `node scripts/make-fixtures.js <spec.json>` (see the script header).
`snapshot.json` is the reviewed parser output summary for every fixture.
