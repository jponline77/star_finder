# Show & song catalog

`catalog.json.gz` is the catalog the site uses for "Find your song" and the add-a-song
suggestions (SPEC §7c). It is **generated** — do not edit it by hand; fix the sources or the
builder (`tools/catalog/`) and rebuild.

| | |
|---|---|
| Version | `2026-09-27.28` |
| Built | 2026-09-27T23:49:52.508Z |
| Shows | 2,927 (1,890 with a song list, 1,320 with singers) |
| Songs | 39,932 (22,777 with named singers, 1,055 instrumental, 2,929 reprises) |
| Characters | 19,968 in 1,572 shows (1,998 with a voice type) |
| File size | 1.21 MB gzipped |

Detailed counts: [`stats.json`](stats.json).

## Sources and licences

- **Wikidata** (<https://www.wikidata.org>) — which works are stage musicals (including operettas
  and revues), composer / lyricist / librettist (fallback), year of first performance (with the
  article's infobox and categories: the earliest wins),
  genres, short descriptions and alternative titles. Wikidata is **CC0 1.0** (public domain).
- **English Wikipedia** (<https://en.wikipedia.org>) — song lists ("Musical numbers" / "Songs" /
  "Song list" sections and linked "Songs from …" / cast-recording pages), who sings each song,
  characters and voice types, infobox credits (or, where the infobox and Wikidata have none, the
  credits stated in the article's opening sentences) and premiere dates, and the "YYYY musicals" /
  operetta / comic opera categories. A show's song list is one production list of its article
  (the licensed / current one where the article says so); numbers that only a later production
  list or the list's notes name (Grease's "Hopelessly Devoted to You", The Sound of Music's
  "Something Good") are added in their place (138 songs). Numbers the articles name only by a line of lyrics of a work
  still in copyright are left out. This content is
  licensed **CC BY-SA 4.0** (<https://creativecommons.org/licenses/by-sa/4.0/>): the catalog data
  derived from it is shared under the same licence. **Attribution:** "Song lists and characters
  from English Wikipedia contributors, CC BY-SA 4.0". Each show's article is
  `https://en.wikipedia.org/wiki/<wikiTitle>` (its full list of contributors is on the article's
  history page); the site shows this credit wherever catalog data appears.
- No lyrics are included — only song titles, character names and credits.
- The builder's code (`tools/catalog/`) is MIT like the rest of the project; the data keeps the
  licences above.

## Format

gzip of one JSON document: `{ version, generatedAt, sources, shows: [{ key, title, altTitles,
wikiTitle, wikidataId, composer, lyricist, bookWriter, year, genres, description, characters:
[{ name, voiceType }], songs: [{ title, act, position, singers, singersRaw, ensemble, reprise,
instrumental }] }] }` — see SPEC §7c. `key` is the Wikidata QID (or `wp:<enwiki title>` for the
few articles without a Wikidata item). Shows are sorted by title; songs are in show order.

## Rebuilding

```sh
npm run catalog:build            # from the repo root (installs tools/catalog, then builds)
# or, inside tools/catalog:
npm run build -- --refresh       # re-download everything instead of using the cache
npm run build -- --offline       # rebuild only from tools/catalog/.cache (no network)
npm test                         # parser tests
npm run verify                   # sample-check titles against live Wikipedia pages
```

The builder sends a descriptive User-Agent, batches Wikipedia requests (50 pages per request,
≤ 4 requests/second, `maxlag=5`) and caches every raw response in `tools/catalog/.cache/`
(gitignored), so a rebuild from a warm cache makes no requests and gives the same output. A
first build takes a few minutes. The `version` (`YYYY-MM-DD.N`) changes whenever the content
changes (the server reloads the catalog when it sees a new version); a rebuild that produces
identical content keeps the previous version, and a version string is never issued twice for
different content (every version is recorded with its content's SHA-256 in
`tools/catalog/versions.json`; this file's hash is `b85f24dbc6db9903…` in `stats.json`). Manual include/exclude corrections live in
`tools/catalog/overrides.json`.
