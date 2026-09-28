# STAR Song Finder — Build Spec (shared contract)

This is the single source of truth for every agent building this project. If something here is
ambiguous, pick the option that best serves high-school students choosing a Musical Theatre
Solo/Duet for the STAR Festival, and note the decision in your final report.

## 1. What we're building

A website where students (grades 6–12) browse, search and filter musical-theatre **solos and
duets** for the **STAR Festival** (School Theatrical Arts Recognition Festivals, run by TAEA —
Theatrical Arts Education Association of Canada, https://taeacanada.ca/regional-star-fest/), and
**add more songs/shows** themselves. It should feel fun and theatrical (marquee lights, spotlights,
playful copy, emoji), while being fast, accessible, and mobile friendly.

Source data: `server/seed/star_spreadsheet.xlsx` (copied from the user's Windows Downloads).
Sheet1, row 1 = section titles ("Solos" in A1, "Duets" in J1), row 2 = headers, data from row 3.

- Solos, columns A–H: `Song, Character, Show, Genre, Sub-Genre, Vocal Range, Length, Mature Content?`
- Duets, columns J–S: `Song, Show, Character 1, Character 2, Genre, Sub-Genre, Vocal Range 1, Vocal Range 2, Length, Mature Content?`
  (NOTE: duet column order differs from solos — Show comes before the characters.)
- 87 solo rows, 35 duet rows, ~27 distinct shows. Solo and duet rows are independent (a row may have
  only a solo or only a duet).
- **Length quirk:** Excel stored lengths as time-of-day `h:mm` (e.g. `02:33:00`) but they really mean
  `m:ss`. So `hours → minutes`, `minutes → seconds`: 2:33 → 153 seconds. (exceljs returns these as
  Date objects on 1899-12-30; use UTC hours/minutes.) Also accept strings like "2:33" or numbers
  (fraction of a day: value*24 = "minutes", fraction*60 = seconds — i.e. total = round(value*24*60)).
- `Mature Content?` is "Yes"/"No" → boolean.
- Values may have trailing whitespace — always trim.

### STAR rules that matter for the UI (from the official 2026 Regional STAR Fest Program Guide)
- Musical Theatre Solo and Duet: **time limit 6:00** (timing starts after the slate). Over the
  limit risks disqualification. → Flag songs `> 360s` as "Over 6:00 — needs a cut", and songs
  `> 330s` as "Close to the limit".
- Solo = "a song written for a single character"; Duet = "a song written with vocal parts for two characters".
- Must be one song from a **published score written for a stage musical** (no film/TV-only songs).
- Performed with a **pre-recorded backing track with NO vocals** (MP3/M4A/WAV/AIFF, downloaded to a
  device). No live accompaniment, no a cappella (unless written that way).
- Performance starts with a **slate**: e.g. `"I am Heather Black from Canada Junior High School,
  (Troupe #1000,) and I'll be performing "Popular" from Wicked by Stephen Schwartz."` and ends with "Thank you."
  Duet sample: `"Our names are Lee Jones and Sam Becker from True North High School, (Troupe #999,) and we'll be performing "Anything You Can Do (I Can Do Better)" from Annie Get Your Gun by Irving Berlin and Dorothy and Herbert Fields."`
- Dress: all black, minimal accessories, no costumes/props/theatrical makeup.
- Set pieces allowed: Solo = up to 1 chair + 1 table; Duet = up to 2 chairs + 1 table.
- Rubric (4 Advanced / 3 Proficient / 2 Developing / 1 Emerging) on: Expression, Characterization,
  Staging/Choreography, Singing Technique, Transitions, Execution. It's "not a competition" —
  students are scored against the rubric, not each other.
- Approved publishers/licensors include: Music Theatre International (MTI), Rodgers & Hammerstein,
  Tams-Witmark, Concord Theatricals / Samuel French (some playwright exclusions — plays), Theatrical
  Rights Worldwide (TRW — needs a free festival licence request), Dramatic Publishing (listed titles
  only), Pioneer Drama, Playscripts, Dramatists Play Service, Eldridge, Heuer, CPA Theatricals,
  Stage Partners, Uproar Theatrics, YouthPLAYS, Theatrefolk, Playwrights Guild of Canada, public domain.
- 2026–27 Vancouver Regional STAR Fest: **December 11, 2026 at SFU School for the Contemporary Arts (SFU SCA)**.
  (Other BC regionals: Victoria Dec 10 @ UVic; Burnaby Jan 22 2027; Surrey Jan 29 2027; Fraser Valley Dec 4 2026; Prince George Nov 20 2026.)

## 2. Stack & layout

- **Frontend:** TypeScript + React 19 + Vite + React Router (`client/`). Plain CSS with CSS custom
  properties (no Tailwind, no UI kit). Icons: `lucide-react`. No chart library — draw charts with
  CSS/SVG. Strict TS (`"strict": true`), no `any` unless unavoidable.
- **Backend:** plain **JavaScript** (ESM, `"type": "module"`), Node 22, Express 5, `better-sqlite3`,
  `exceljs` (xlsx import/export), `multer` (uploads), `helmet`, `express-rate-limit`. (`server/`)
- **Database:** SQLite file at `server/data/star.db` (WAL mode, foreign_keys ON).
- **Tests:** server: `node --test` + `supertest`. client: `vitest` for pure logic (filters,
  formatting), `tsc --noEmit`. E2E: `@playwright/test@1.63.0` with its matching Chromium (installed
  once per machine with `npx playwright install chromium`; no other browsers are needed).
- Ports: API `3001` (env `PORT`), Vite dev `5173` with `/api`, `/media`, `/uploads` proxied to 3001.
  In production (`npm start`) Express serves `client/dist` + SPA fallback on port 3001.

```
star_website/
  package.json        # root: scripts setup/dev/build/start/test (uses `concurrently`)
  README.md
  SPEC.md
  server/
    package.json
    src/ index.js app.js db.js schema.sql routes/*.js lib/*.js
    scripts/ import-xlsx.js enrich.js export-seed.js (as needed)
    seed/ star_spreadsheet.xlsx corrections.json shows.json media.json
    media/            # seed images (show posters, album art) downloaded by `npm run fetch-media` (gitignored)
    uploads/          # user uploads (gitignored)
    data/             # star.db (gitignored)
    test/
  client/
    package.json vite.config.ts tsconfig*.json index.html
    src/ main.tsx App.tsx api.ts types.ts lib/ components/ pages/ styles/
  e2e/ (playwright tests + config) — may live at root
```

## 3. Database schema (server/src/schema.sql)

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- stored trimmed + lowercased
  display_name  TEXT NOT NULL,                         -- shown publicly (emails are NEVER public)
  password_hash TEXT NOT NULL,                         -- node:crypto scrypt: 'scrypt$N$r$p$saltB64$hashB64'
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  disabled      INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 0,     -- set after an admin reset
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,                  -- sha256(hex) of the random cookie token; raw token never stored
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS shows (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  slug          TEXT NOT NULL UNIQUE,
  composer      TEXT,            -- music by
  lyricist      TEXT,            -- lyrics by
  book_writer   TEXT,            -- book by
  year          INTEGER,         -- year of first major production (Broadway/West End/premiere)
  licensor      TEXT,            -- e.g. "Music Theatre International (MTI)"; NULL if unknown/not licensed
  licensing_note TEXT,           -- e.g. "Not yet available for amateur licensing — check with your teacher"
  description   TEXT,            -- 1–3 sentence kid-friendly blurb
  wiki_url      TEXT,
  image_path    TEXT,            -- '/media/shows/<slug>.jpg' or '/uploads/images/<file>' or NULL
  image_credit  TEXT,            -- attribution text, e.g. "Poster via Wikipedia (fair use)"
  image_source_url TEXT,
  source        TEXT NOT NULL DEFAULT 'spreadsheet' CHECK (source IN ('spreadsheet','community')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- NULL for spreadsheet rows
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS songs (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('solo','duet')),
  title           TEXT NOT NULL,
  show_id         INTEGER NOT NULL REFERENCES shows(id) ON DELETE RESTRICT,
  genre           TEXT,
  sub_genre       TEXT,
  length_seconds  INTEGER CHECK (length_seconds IS NULL OR (length_seconds > 0 AND length_seconds < 3600)),
  mature          INTEGER NOT NULL DEFAULT 0 CHECK (mature IN (0,1)),
  notes           TEXT,
  -- auto-found media (iTunes Search API). preview_url is a 30-second Apple preview, streamed not stored.
  preview_url     TEXT,
  artwork_path    TEXT,          -- local cached album art '/media/art/<hash>.jpg'
  apple_music_url TEXT,
  recording_name  TEXT,          -- e.g. "Hadestown (Original Broadway Cast Recording)"
  recording_artist TEXT,
  itunes_track_id INTEGER,
  -- community-provided audio
  audio_path      TEXT,          -- uploaded file '/uploads/audio/<file>'
  audio_link      TEXT,          -- external https link (YouTube, Spotify, etc.)
  source          TEXT NOT NULL DEFAULT 'spreadsheet' CHECK (source IN ('spreadsheet','community')),
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- NULL for spreadsheet rows
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (kind, show_id, title COLLATE NOCASE)
);

-- Comments attach to exactly one song OR one show.
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY,
  song_id     INTEGER REFERENCES songs(id) ON DELETE CASCADE,
  show_id     INTEGER REFERENCES shows(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  tag         TEXT NOT NULL DEFAULT 'general' CHECK (tag IN ('general','tip','question','performed')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((song_id IS NULL) != (show_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_comments_song ON comments(song_id);
CREATE INDEX IF NOT EXISTS idx_comments_show ON comments(show_id);

CREATE TABLE IF NOT EXISTS song_parts (
  id          INTEGER PRIMARY KEY,
  song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position IN (1,2)),
  character   TEXT NOT NULL,
  vocal_range TEXT,              -- one of VOCAL_RANGES or NULL
  UNIQUE (song_id, position)
);
CREATE INDEX IF NOT EXISTS idx_songs_show ON songs(show_id);
CREATE INDEX IF NOT EXISTS idx_parts_song ON song_parts(song_id);
```
Solos have exactly 1 part (position 1); duets exactly 2 parts (positions 1 and 2). Enforce in the
API layer (and in import).

**Migration v2** (`server/src/db.js`, `PRAGMA user_version` 2; schema.sql stays the v1 baseline):
- `songs.import_key`, `shows.import_key` (TEXT, unique when not NULL): a stable key built from the
  raw spreadsheet values, so a re-import recognises spreadsheet rows an admin renamed or moved.
- `import_tombstones (kind 'song'|'show', import_key, deleted_at)`: spreadsheet rows an admin
  deleted; a re-import doesn't bring them back (unless `--overwrite-edits`).
- `songs.edited_at`, `shows.edited_at`: set only when a PUT really changes a data field (uploads
  and no-op saves don't). The import keeps admin-edited spreadsheet rows as they are.
- `users.temp_password_expires_at`: an admin-issued temporary password (and sessions made with
  it) stops working after 72 hours.
- `admin_email_listings (email, first_listed_at)`: when each `STAR_ADMIN_EMAILS` address was first
  seen (see §5a).
- Existing all-digit show slugs are renamed (`13` → `13-show`, see §4).

## 4. Controlled vocabularies & normalization (server/src/lib/vocab.js, mirrored in client/src/lib/vocab.ts)

- `VOCAL_RANGES` (ordered high → low): `Soprano, Mezzo-soprano, Alto, Tenor, Baritone, Bass`.
  Normalize case-insensitively: "mezzo", "mezzo soprano", "mezzo-soprano" → "Mezzo-soprano";
  "sop" → "Soprano"; etc. Unknown values → validation error (400) on API writes.
- `GENRES` suggested: `Comedy, Drama, Romantic` (API accepts any trimmed string ≤ 40 chars, but
  normalizes case to match an existing genre if one matches case-insensitively).
- Sub-genres: free text ≤ 40 chars, normalized to an existing value case-insensitively.
  Seed normalizations (apply in import): `"Tongue & Cheek" → "Tongue-in-Cheek"`,
  `"Intimidating/angry" → "Intimidating / Angry"`. Keep the rest as-is.
- `slugify(name)` (server + client + seed files must agree): NFD-fold accents, lowercase, delete
  apostrophes (`'` and `’`), replace every run of chars outside `[a-z0-9]` with `-`, trim leading/
  trailing `-`. E.g. "Les Misérables" → `les-miserables`, "Something's Afoot" → `somethings-afoot`,
  "A Gentleman's Guide to Love and Murder" → `a-gentlemans-guide-to-love-and-murder`. On collision append `-2`, `-3`…
  A new show's slug that would be empty becomes `show`, and an all-digit slug gets `-show`
  ("13" → `13-show`), because `/api/shows/:idOrSlug` reads a number as an id. Clients should link
  with the `slug` the API returns rather than recomputing it.
- Show names / character names / song titles: typo corrections come from `server/seed/corrections.json`
  (see §6). Search must be **accent-insensitive and case-insensitive** (e.g. "les miserables"
  matches "Les Misérables"; "dantes" matches "Dantès").

## 5. HTTP API (all JSON; errors: `{ "error": string, "details"?: Record<string,string> }`)

Response shapes (camelCase):
```ts
type Kind = 'solo' | 'duet';
interface SongPart { position: 1 | 2; character: string; vocalRange: string | null }
interface ShowRef { id: number; name: string; slug: string; imageUrl: string | null }
interface SongMedia {
  previewUrl: string | null;      // 30s preview (Apple)
  artworkUrl: string | null;      // local: /media/art/... (seed art from `npm run fetch-media`) or /uploads/art/... (fetched for website rows)
  appleMusicUrl: string | null;
  recordingName: string | null;
  recordingArtist: string | null;
  audioUrl: string | null;        // uploaded file URL (/uploads/audio/...) — playable
  audioLink: string | null;       // external link (open in new tab)
}
interface Song {
  id: number; kind: Kind; title: string; show: ShowRef;
  genre: string | null; subGenre: string | null;
  lengthSeconds: number | null; mature: boolean; notes: string | null;
  parts: SongPart[];              // sorted by position
  media: SongMedia;
  source: 'spreadsheet' | 'community';
  createdBy: { id: number; displayName: string } | null;  // null for spreadsheet rows / deleted users
  commentCount: number;
  createdAt: string; updatedAt: string;
}
interface User {            // the logged-in user (own email visible only to self and admins)
  id: number; email: string; displayName: string; role: 'user' | 'admin';
  mustChangePassword: boolean; createdAt: string;
}
interface Comment {
  id: number; body: string; tag: 'general' | 'tip' | 'question' | 'performed';
  author: { id: number; displayName: string; role: 'user' | 'admin' };   // never the email
  target: { type: 'song' | 'show'; id: number; title: string };        // song title or show name
  createdAt: string; updatedAt: string; edited: boolean;               // edited = updatedAt > createdAt
}
interface Show {
  id: number; name: string; slug: string;
  composer: string | null; lyricist: string | null; bookWriter: string | null;
  year: number | null; licensor: string | null; licensingNote: string | null;
  description: string | null; wikiUrl: string | null;
  imageUrl: string | null; imageCredit: string | null;
  source: 'spreadsheet' | 'community';
  createdBy: { id: number; displayName: string } | null;
  commentCount: number;
  songCount: number; soloCount: number; duetCount: number;
  characters?: { name: string; vocalRanges: string[]; songIds: number[] }[]; // only on detail
  songs?: Song[];                                                             // only on detail
}
```
Endpoints:
- `GET  /api/health` → `{ ok: true }`
- `GET  /api/meta` → `{ vocalRanges: string[], genres: string[], subGenres: {name:string, genre:string|null, count:number}[], shows: {id,name,slug}[], counts: {songs, solos, duets, shows}, timeLimitSeconds: 360, warnSeconds: 330, festivals: Festival[], defaultFestivalSlug: string | null }` (see §7b)
- `GET  /api/songs` → `{ songs: Song[], total: number }`. Optional query filters (all combinable, AND
  semantics; multi-values comma-separated → OR within that field):
  `q` (accent/case-insensitive substring over title, show name, characters, genre, subGenre),
  `kind` (solo|duet), `show` (slug or id), `genre`, `subGenre`, `range` (a duet matches if ANY part
  has the range), `maxSeconds`, `minSeconds`, `hideMature=1`, `hasAudio=1` (preview or upload or link),
  `sort` = `title|show|length|-length|newest` (default `title`). Returns all matches up to 5,000 per request (`total` is the full count); `limit` (1–5000) / `offset` page further.
- `GET  /api/songs/:id` → `Song & { similar: Song[] }` (up to 6: same sub-genre or overlapping vocal range, same kind preferred, excluding itself). 404 if missing.
- `POST /api/songs` → 201 `Song`. Body:
  `{ kind, title, showId? , showName?, genre?, subGenre?, lengthSeconds? , length? ("m:ss"), mature?, notes?, parts: [{character, vocalRange?}], audioLink?, preview?: {previewUrl, artworkUrl, appleMusicUrl, recordingName, recordingArtist, itunesTrackId} }`
  - Either `showId` (existing) or `showName` (finds existing case/accent-insensitively, else creates a community show).
  - `parts` length must be 1 for solo and 2 for duet. Character required (≤ 80 chars).
  - `title` 1–120 chars. Duplicate (kind, show, title) → 409 with the existing song id in `details.existingId`.
  - `audioLink` must be an https URL. `preview.previewUrl` must be https on `*.itunes.apple.com` or `*.mzstatic.com`; `preview.artworkUrl` must be https on `*.mzstatic.com` — server downloads it (metadata stripped) into its own file under `/uploads/art/` (deleted when replaced or when the song is deleted). A local `artworkUrl` is accepted only if it is the song's current art or a seed `/media/art/` file that is on disk.
  - Non-admins may add at most 50 songs and 20 shows per day (`STAR_DAILY_SONG_LIMIT` / `STAR_DAILY_SHOW_LIMIT`) → 429.
  - `source` is always set to `'community'` for API-created rows.
- `PUT  /api/songs/:id` → `Song` (same body as POST; full replace of editable fields, parts replaced).
- `DELETE /api/songs/:id` → 204. A non-admin owner gets 409 while other people have commented on it (deleting would delete their comments); admins may always delete.
- `POST /api/songs/:id/audio` multipart field `file` (mp3/m4a/aac/wav/aiff/ogg, ≤ 25 MB) → `Song`. Stored in `server/uploads/audio/<random>.<ext>` (the content must really be audio; MP3/AAC lose their ID3 tags). Limits: 413 file too big or the account's 200 MB upload space is used up; 429 more than 2 uploads at once per account; 503 too many site-wide uploads at once; 507 the disk is nearly full.
- `DELETE /api/songs/:id/audio` → `Song` (removes uploaded file).
- `GET  /api/shows` → `{ shows: Show[] }` (sorted by name, with counts).
- `GET  /api/shows/:idOrSlug` → `Show` with `songs` and `characters`.
- `POST /api/shows` → 201 `Show`. Body `{ name, composer?, lyricist?, bookWriter?, year?, licensor?, description?, wikiUrl?, imageUrl? }`. If `imageUrl` is given it must be https on `upload.wikimedia.org` or `*.mzstatic.com`; server downloads it (≤ 5 MB, image/* only, metadata stripped) into its own file under `/uploads/shows/`. Duplicate name → 409.
- `PUT  /api/shows/:id` → `Show`.
- `DELETE /api/shows/:id` → 204 only if the show has no songs, else 409. A non-admin owner also gets 409 while other people have commented on the show.
- `POST /api/shows/:id/image` multipart `file` (jpeg/png/webp/gif ≤ 5 MB; NO svg; EXIF/XMP/comments stripped, JPEG orientation kept) → `Show`. Same 413/429/503/507 limits as audio.
- `GET  /api/lookup/itunes?title=&show=` → `{ candidates: {trackId, trackName, collectionName, artistName, previewUrl, artworkUrl, appleMusicUrl, durationSeconds, score}[] }` (server-side call to `https://itunes.apple.com/search`, country CA then US fallback, entity=song, limit 25; scored & sorted, top 8; cached in memory 1h).
- `GET  /api/lookup/wikipedia?name=` → `{ found: boolean, title?, description?, extract?, imageUrl?, wikiUrl? }` (Wikipedia REST `page/summary`, try "<name> (musical)" first, then "<name>"; only accept pages whose description/extract mentions musical/opera/play/theatre; send a descriptive User-Agent).
- `GET  /api/stats` → `{ byGenre, bySubGenre, byRange, byShow, byKind, lengthBuckets, mature: {yes,no}, overLimit: number, withPreview: number }` (each `{label, count}[]`).
- `GET  /api/export.xlsx` → downloads a workbook with two sheets "Solos" and "Duets" using the original column headers (+ an "Added by" column: Spreadsheet/Community), lengths as `m:ss` text.
- Static: `/media/*` → `server/media` (seed art/posters downloaded by `npm run fetch-media`; the website never writes here; a missing file is a plain 404 and the client shows its gradient fallback), `/uploads/*` → `server/uploads` (`audio/`, `images/` uploaded posters, `art/` and `shows/` images fetched from Apple/Wikipedia) (with `X-Content-Type-Options: nosniff`, long cache for media).
- Other status codes any endpoint may return: 429 rate limits (reads 1,200/min, exports 10/min, writes 60/min, …), 503 + `Retry-After` when the database is locked by another process, 400 for a malformed URL. In production, unknown paths under `/assets/` or with a file extension are a real 404 (not the SPA's index.html).

### 5a. Accounts, sessions & permissions (email + password)

Browsing is public: every GET endpoint above works without login (and never exposes emails).
Adding/editing/deleting songs & shows, uploading, and commenting require login.

- `POST /api/auth/signup` `{ email, password, displayName }` → 201 `{ user: User }` + session cookie.
  email: valid format, ≤ 254 chars, trimmed + lowercased; password: 8–200 chars; displayName: 2–40
  chars, trimmed, no emails/URLs in it. Duplicate email → 409 `{error:"An account with that email already exists"}`
  (these 409s are rate-limited per IP: 20/hour). Signup and login **never** grant admin (nobody
  proves they own an email address). The first admin is made with the `make-admin` CLI (§5c).
  `STAR_ADMIN_EMAILS` (comma-separated, case-insensitive) is applied only at server startup, and
  only to accounts that already existed when that email was first listed (`admin_email_listings`);
  a later account with a listed email is not promoted (the server logs a warning). Demoting a listed
  admin from the Admin page → 409 (disabling still works).
- `POST /api/auth/login` `{ email, password }` → `{ user }` + cookie. Wrong email OR password →
  401 `{error:"Email or password is incorrect"}` (same message & similar timing for both). Disabled
  account → 403 `{error:"This account has been disabled — talk to your teacher"}`. Rate limit: 10
  failed attempts / 15 min per IP+email → 429.
- `POST /api/auth/logout` → 204 (deletes session row, clears cookie).
- `GET  /api/auth/me` → `{ user: User | null }` (200 either way).
- `PUT  /api/auth/me` `{ displayName?, currentPassword?, newPassword? }` → `{ user }` (changing the
  password requires currentPassword; clears must_change_password; other sessions of that user are revoked).
  The new password must differ from the current one. Wrong current passwords are rate-limited per
  account (same limit as login) → 429.
- **Temporary password** (after an admin reset, `mustChangePassword: true`): reads still work, but
  every write except `PUT /api/auth/me`, login, logout and signup → 403
  `{ error: "Please choose a new password first", code: "MUST_CHANGE_PASSWORD" }` (the client sends
  the user to /me). An unused temporary password, and sessions made with it, expire after 72 hours.
- Session: random 32-byte token (base64url) in cookie `star_sid` — `HttpOnly`, `SameSite=Lax`,
  `Path=/`, `Max-Age` 30 days, `Secure` when the request is HTTPS (`req.secure`, `trust proxy` set
  from env `TRUST_PROXY`). DB stores only sha256(token). Expired sessions are purged on startup and
  hourly. Passwords hashed with `crypto.scrypt` (N=16384, r=8, p=1, 16-byte salt, 64-byte key),
  verified with `timingSafeEqual`. No extra auth dependencies.
- **CSRF:** every non-GET `/api/*` request must carry header `X-Requested-With: star-song-finder`
  (the client's fetch wrapper always adds it; a custom header forces a CORS preflight that
  cross-site pages can't pass). Missing → 403. JSON endpoints also require `Content-Type: application/json`.
- **Permissions** (enforced server-side; client hides controls accordingly):
  - Not logged in → any write = 401 `{error:"Please log in first"}`.
  - Songs & shows: the creator (`created_by`) may edit/delete/upload media for their own rows;
    admins may do anything to any row (including spreadsheet rows, whose `created_by` is NULL).
    Otherwise 403 `{error:"You can only edit songs you added"}` (or "shows you added").
  - Any logged-in user may add songs/shows (new rows get `source='community'`, `created_by=user.id`)
    and may create a new show implicitly via `showName`.
  - Comments: any logged-in user may post; authors may edit/delete their own; admins may delete
    (and edit) any comment. Deleting a comment is a hard delete.
  - Deleting a user's account is not exposed; admins can disable accounts instead (disables login
    and revokes sessions; their songs/comments stay unless an admin removes them).
- Error for invalid input: 400 `{ error: "…", details: { field: "message" } }`.
- User text (names, titles, comments…) has Unicode bidi control characters removed (ZWJ/ZWNJ are
  kept), and the client renders display names in `<bdi>`, so nobody can make their text display as
  something else.

### 5b. Comments
- `GET  /api/songs/:id/comments` / `GET /api/shows/:idOrSlug/comments` → `{ comments: Comment[] }` (oldest first; public).
- `POST /api/songs/:id/comments` / `POST /api/shows/:idOrSlug/comments` `{ body, tag? }` → 201 `Comment` (login required; body trimmed 1–1000 chars; tag default 'general').
- `PATCH /api/comments/:id` `{ body?, tag? }` → `Comment` (author or admin).
- `DELETE /api/comments/:id` → 204 (author or admin).
- Comment write rate limit: 20/min per user.

### 5c. My stuff & admin
- `GET  /api/me/contributions` (login) → `{ songs: Song[], shows: Show[], comments: Comment[] }` created by the current user.
- Admin only (else 403 `{error:"Admins only"}`):
  - `GET  /api/admin/users` → `{ users: (User & { disabled: boolean; lastLoginAt: string|null; songCount: number; showCount: number; commentCount: number })[] }` (admins see emails).
  - `PATCH /api/admin/users/:id` `{ role?: 'user'|'admin', disabled?: boolean }` → the updated user. Refuse (409) to demote/disable the last remaining active admin, to disable yourself, or to demote an admin listed in `STAR_ADMIN_EMAILS`.
  - `POST /api/admin/users/:id/reset-password` → `{ temporaryPassword, expiresAt }` (random, readable ~12 chars; sets must_change_password=1; revokes their sessions; unused, it stops working at `expiresAt`, 72 hours later). The client shows it once for the admin to pass on. Resetting your own password → 409 (use My stuff).
  - `GET  /api/admin/comments?limit=100` → `{ comments: Comment[] }` newest first (moderation feed).
- CLI: `npm --prefix server run make-admin -- someone@example.com` (or `npm run make-admin -- …` at the root) promotes an existing user and prints their display name and sign-up date; it refuses to create a missing database.

General: Rate-limit writes (e.g. 60/min/IP) and lookups (30/min/IP). JSON body limit 100kb.
Use prepared statements everywhere. Every text input trimmed; empty string → null.

## 6. Seed data files (server/seed/) — produced by the data/enrichment agents, consumed by import

**corrections.json** — explicit, reviewable typo fixes applied during import (the original
spreadsheet is never modified):
```json
{
  "shows":      { "<raw spreadsheet show name>": "<canonical name>" },
  "characters": { "<raw show name>|<raw character>": "<canonical character>" },
  "titles":     { "<raw show name>|<raw song title>": "<canonical title>" },
  "subGenres":  { "Tongue & Cheek": "Tongue-in-Cheek", "Intimidating/angry": "Intimidating / Angry" },
  "vocalRanges": { "Mezzo": "Mezzo-soprano" },
  "parts": { "<kind>|<raw show>|<raw title>": [{ "character": "<canonical>", "vocalRange": "<range or null>" }] },
  "notes": { "<kind>|<raw show>|<raw title>": "a data-quality / STAR-eligibility note shown on the song page, e.g. 'This song was written for the TV series and may not be in the stage version — check with your teacher'" }
}
```
Keys use the RAW (trimmed) spreadsheet values so the mapping is stable. `parts` is a verified
factual override of who sings a specific song (e.g. a song attributed to the wrong character); it
replaces that song's parts entirely (canonical names — no further character mapping applied).
Order of application: titles/shows/characters maps → vocalRanges/subGenres maps → parts override → notes.
Only include corrections that are verified (official spelling/credits from the show's licensor,
cast album, published score, or Wikipedia). Uncertain issues go in `notes`, not in fixes.
Every correction must be listed in the final report to the user.

**shows.json** — array, one entry per canonical show name:
```json
[{ "name": "Hadestown", "composer": "Anaïs Mitchell", "lyricist": "Anaïs Mitchell", "bookWriter": "Anaïs Mitchell",
   "year": 2019, "licensor": "Music Theatre International (MTI)", "licensingNote": null,
   "description": "kid-friendly 1–3 sentences, written in our own words",
   "wikiTitle": "Hadestown", "wikiUrl": "https://en.wikipedia.org/wiki/Hadestown",
   "imageFile": "hadestown.jpg", "imageCredit": "Poster via Wikipedia (fair use)", "imageSourceUrl": "https://upload.wikimedia.org/..." }]
```
Show images live at `server/media/shows/<imageFile>`. They are third-party artwork and **not in the
repository**: `npm run fetch-media` (part of `npm run setup`) downloads each `imageSourceUrl` to its
`imageFile`. The import stores `/media/shows/<imageFile>` even when the file isn't there yet (one
summary warning counts the missing images), so fetching them later needs no re-import.

**media.json** — object keyed by `"<kind>|<canonical show>|<canonical title>"`:
```json
{ "solo|Hadestown|Flowers": { "itunesTrackId": 123, "previewUrl": "https://audio-ssl.itunes.apple.com/...",
  "artworkFile": "a1b2c3.jpg", "artworkUrl": "https://is1-ssl.mzstatic.com/.../600x600bb.jpg",
  "appleMusicUrl": "https://music.apple.com/...", "recordingName": "...",
  "recordingArtist": "...", "confidence": "high|medium|verified", "verifiedBy": "note" } }
```
Album art lives at `server/media/art/<artworkFile>` (600×600; the name is `sha256(artworkUrl)[:16]` when
enrich downloaded it, but it is only a cache key). Like the posters it is not in the repository:
`npm run fetch-media` downloads each `artworkUrl` to its `artworkFile`. A key mapped to `null` means "verified no
good match — don't show a preview". Wrong audio is worse than no audio: only keep matches where
the track is clearly the same song from a cast recording (or film/concert recording) of that show.

**Import** (`npm run import` in server; idempotent): creates schema, upserts shows (from shows.json +
spreadsheet), upserts spreadsheet songs keyed by `import_key` (then (kind, show, canonical title)),
replaces their parts, applies corrections, notes and media. Never deletes or modifies
`source='community'` rows. `--reset` flag deletes the DB file first (after confirming it's not in use).
- Spreadsheet rows an admin edited (`edited_at`) or deleted (tombstone) are left as they are unless
  `--overwrite-edits`. A poster uploaded on the website is kept.
- The header row is located, not assumed. A file with no song rows, or the site's own export, is
  refused before anything changes. An import that would remove more than max(5 songs, 10%) stops
  unless `--allow-deletions`.
- If a community show has the same name as a spreadsheet show, the import stops and names it unless
  `--adopt-community` (the show becomes the official one; the students' songs stay theirs).

## 7. Frontend (client/) — pages & features

Global: sticky top nav ("🌟 STAR Song Finder" logo with marquee-bulb border; links: Browse, Shows,
Matchmaker, Spin, My Setlist, STAR Prep, Stats, + Add Song button), global bottom **mini audio
player** (only one preview plays at a time; shows art, title, progress, pause/close), toast
notifications, dark "stage" theme by default (deep indigo/plum background, warm gold marquee accents,
spotlight radial gradients) with a light theme toggle (respects `prefers-color-scheme`, remembered in
localStorage), `prefers-reduced-motion` respected, visible focus rings, keyboard accessible, mobile
first (works at 360px wide, filters become a slide-over drawer).

Consistent visual language (in `client/src/lib/vocab.ts`):
- Vocal range colours + emoji-free short labels (S, Mz, A, T, Bar, B) on pill badges; a small
  "voice ladder" graphic highlighting the range(s) on a 6-step vertical/horizontal scale.
- Genre emoji: Comedy 😂, Drama 🎭, Romantic 💘 (fallback 🎵). Sub-genre emoji map (e.g. Satire 🃏,
  Slapstick 🍌, Tongue-in-Cheek 😏, Irony 🙃, Longing 🌙, Confident 💪, Frustration 😤,
  Intimidating / Angry 🔥, Hopeful 🌅, Reflective 🪞, Scared 😱, Power ⚡, Conflict ⚔️, In Love 😍,
  Cheated 💔, Missing 🥀; fallback ✨).
- Song artwork fallback: generated gradient tile (hash of show name) with show initials.
- Character "avatar": initials disc coloured by vocal range (no photos of real performers).
- Time badge: green ≤ 5:30, amber 5:31–6:00, red > 6:00 ("Over STAR's 6:00 limit").
- Mature badge: "Mature themes" (🔞 not used — use a discrete ⚠️ label). "Hide mature" filter.

Pages / routes:
1. `/` Home — marquee hero with animated bulbs, countdown for the visitor's chosen festival (see §7b), big search box (Enter → `/songs?q=`), quick-pick chips
   ("Soprano solos", "Tenor solos", "Comedy duets", "Under 3 minutes", "No mature content"),
   "Spotlight Song of the Day" (deterministic from date), feature cards to other pages, stats teaser.
2. `/songs` Browse — instant client-side filtering of the full list (fetch once): search box
   (accent-insensitive, highlights matches), Solo/Duet/All segmented control, vocal range chips
   (multi), genre chips, sub-genre chips (grouped by genre), show dropdown, max-length slider with a
   6:00 marker, "Hide mature" toggle, "Has audio preview" toggle, sort select, grid ↔ table view
   toggle, active-filter pills + "Clear all", result count with a fun empty state. **Filter state
   synced to the URL query string** (shareable/back-button friendly). Song cards: artwork, ▶ play
   preview, title, show, characters w/ range badges, genre/sub-genre tags, length badge, mature
   badge, ♥ add-to-setlist. Table view: sortable columns.
3. `/songs/:id` Song detail — hero (album art + show poster), title/show/composer, parts (character
   avatar, vocal range badge, voice ladder), genre/sub-genre, length vs 6:00 limit bar, mature flag,
   preview player (+ uploaded audio player, + external link), recording credit ("Preview courtesy of
   Apple Music — <recording>"), link buttons: Apple Music, "Find a backing track (no vocals)"
   (YouTube search `"<title>" "<show>" karaoke instrumental`), "Watch performances" (YouTube search),
   "Sheet music" (Musicnotes search), **Slate Builder** (inputs: your name(s), school, troupe # →
   live slate text using composer/lyricist from the show; copy button; details kept in sessionStorage
   unless the student ticks "Remember my details on this device" (then localStorage); logout clears
   them), STAR checklist for this song
   (time ✓/✗, solo/duet fit, licensor if known w/ caveat "confirm with your teacher"),
   data notes, similar songs row, ♥ setlist, Edit / Delete (confirm dialog).
4. `/shows` — poster wall grid (poster or gradient fallback), search box, counts.
   `/shows/:slug` — poster, description, credits, year, licensor + note, Wikipedia link (image
   credit shown), "Cast of characters" (avatar, vocal ranges, their songs), songs split into Solos/Duets.
5. `/add` and `/songs/:id/edit` — Song form: Solo/Duet toggle; show combobox (existing shows +
   "Add new show"; for new shows a "✨ Fetch info from Wikipedia" button fills description/poster via
   `/api/lookup/wikipedia` and posts `imageUrl`); title; character + vocal range per part; genre
   (select + custom) and sub-genre (datalist of existing); length `m:ss` (validated); mature toggle;
   notes; "🔎 Find a 30-sec preview" → `/api/lookup/itunes` candidates list each with ▶ and "Use this";
   audio upload (file) and/or audio link. Inline validation messages; server errors surfaced. Requires
   login (redirect to `/login?next=…` otherwise); the edit route shows a friendly "You can only edit
   songs you added" state if the user isn't the owner/admin. On success:
   confetti burst (CSS/canvas, no library) + navigate to the song page.
6. `/match` Song Matchmaker quiz — 5 playful steps (Solo or duet? → Your voice type (with a short
   "not sure?" helper explaining ranges) → What vibe? (genre/sub-genre moods) → How long? → Mature
   themes OK?) → ranked results with a match % and "why it matched" chips. Back/restart.
7. `/spin` Spin the Spotlight — slot-machine/roulette animation that lands on a random song from the
   (optionally filtered: kind + range + hide mature) pool; "Spin again", open song, add to setlist.
8. `/setlist` My Setlist — favourites in localStorage (ids), total running time, remove, reorder
   (optional), share link (`/setlist?ids=1,2,3`) that imports, print-friendly style.
9. `/star-prep` STAR Prep — friendly summary of the rules above (6:00 limit, backing track with no
   vocals, slate format, dress code, set pieces, rubric categories), a **rehearsal timer** (start/stop/
   reset, turns amber at 5:30, red at 6:00), slate builder (generic), link to the official TAEA page.
10. `/stats` By the Numbers — CSS/SVG bar charts: songs by genre, sub-genre, vocal range, top shows,
    length histogram (with 6:00 marker), mature share, preview coverage.
11. 404 page with a theatrical joke ("This scene was cut in previews").
12. `/login` and `/signup` — "Backstage Pass" themed cards (ticket-stub styling). Signup: display
    name ("shown next to your songs & comments — don't use your full name"), email, password (+
    show/hide, strength hint). Login supports `?next=` redirect. Friendly errors. If the user
    `mustChangePassword`, route them to `/me` with a banner prompting a new password.
13. Header account menu: "Log in" button when logged out; when logged in, an avatar chip (initials)
    with menu: My stuff (`/me`), Admin (`/admin`, admins only, with a crown badge), Log out.
14. `/me` My Stuff — profile (display name edit, change password), my songs, my shows, my comments
    (each linking to where it lives, with edit/delete).
15. `/admin` Admin (admins only; others see a polite "Admins only" page) — tabs: **Users** (table:
    display name, email, role toggle, disabled toggle, #songs/#comments, last login, "Reset
    password" → shows the temporary password once with a copy button) and **Comments** (moderation
    feed newest first with target link and a Remove button + confirm).
16. **Comments** section on song detail and show detail pages ("Backstage Chatter"): list with
    author display name (+ "Admin" badge), tag chip (💡 Tip, ❓ Question, 🎤 I performed this!,
    💬 General), relative time, "edited" marker; composer form for logged-in users (textarea with
    1000-char counter + tag picker) or a "Log in to join the conversation" prompt; authors can edit
    / delete their own; admins can delete any (confirm dialog). Comment counts appear on song cards
    (💬 n) and show cards.
17. Ownership UI: community songs/shows show "Added by <displayName>". Edit/Delete buttons render
    only when `user && (user.role === 'admin' || user.id === item.createdBy?.id)`. Spreadsheet rows
    show a small "From the STAR spreadsheet" note and are editable by admins only.

Auth on the client: `AuthProvider` + `useAuth()` → `{ user, loading, login, signup, logout,
refresh, updateProfile }`, loaded from `/api/auth/me` at startup; `api.ts` always sends
`credentials: 'same-origin'` and header `X-Requested-With: star-song-finder` on non-GET requests;
a 401 on a write sends the user to `/login?next=<current path>`. A `RequireAuth` route wrapper and
a `canEdit(user, item)` helper live in `lib/permissions.ts`.

Client code conventions: `client/src/api.ts` (typed fetch wrapper, throws `ApiError` with
`status`, `message`, `details`), `client/src/types.ts` (types above), `client/src/lib/` pure
helpers (`normalize.ts` accent folding, `filters.ts` filter+sort logic + URL (de)serialization,
`format.ts` m:ss, `vocab.ts`, `setlist.ts`, `slate.ts`) with vitest unit tests, `components/`,
`pages/`, `styles/` (tokens.css, base.css, component CSS). Use `data-testid` on key elements for
e2e: `search-input`, `song-card`, `result-count`, `filter-kind-solo`, `filter-kind-duet`,
`filter-range-<Range>`, `song-title`, `play-preview`, `add-song-form`, `submit-song`.

## 7b. Selectable festival (location) — added 2026-09-27

Goal: students anywhere in BC (not just Vancouver) pick **their** regional STAR Fest; everything
festival-specific (home countdown, STAR Prep dates, "your festival" highlights) follows that choice.
Nothing is hardcoded to Vancouver any more.

**Data** — new table (migration v3; `schema.sql` stays the v1 baseline, append a migration in `db.js`):
```sql
CREATE TABLE festivals (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,              -- slugify(name-ish), e.g. 'surrey', 'online', 'star-fest-west'
  name        TEXT NOT NULL,                     -- 'Surrey Regional STAR Fest'
  kind        TEXT NOT NULL CHECK (kind IN ('regional','online','national')),
  province    TEXT,                              -- 'BC' (NULL for online)
  city        TEXT,
  start_date  TEXT,                              -- 'YYYY-MM-DD' or NULL when TBD
  end_date    TEXT,                              -- multi-day festivals; for 'online' = submission deadline
  date_label  TEXT,                              -- free text shown instead of/alongside dates ('Date to be announced')
  venue       TEXT,
  info_url    TEXT,                              -- https only
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),   -- inactive = hidden from pickers
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
ALTER TABLE users ADD COLUMN festival_id INTEGER REFERENCES festivals(id) ON DELETE SET NULL;
```
Seed file `server/seed/festivals.json` (`{ festivals: [...] }`, camelCase fields as in the table).
The server seeds the table from it at startup **when the table is empty** (so upgrading an existing
deployment needs no re-import); `npm run import` upserts by slug but never overwrites rows edited on
the website (`updated_at > created_at`) unless `--overwrite-edits`. Festival leaders' personal
contact details are NOT stored.

**API** (camelCase JSON):
```ts
interface Festival {
  id: number; slug: string; name: string; kind: 'regional' | 'online' | 'national';
  province: string | null; city: string | null;
  startDate: string | null; endDate: string | null; dateLabel: string | null;
  venue: string | null; infoUrl: string | null; sortOrder: number; active: boolean;
}
```
- `GET /api/festivals` → `{ festivals: Festival[] }` — public, active only, ordered by
  `sort_order, start_date, name`. Admins may pass `?all=1` to include inactive ones.
- `/api/meta` — REMOVE the old single `festival` object; ADD `festivals: Festival[]` (active) and
  `defaultFestivalSlug: string | null` (from env `STAR_DEFAULT_FESTIVAL`; ignored with a startup
  warning if it doesn't match an active regional/online festival).
- `User` gains `festivalSlug: string | null`. `PUT /api/auth/me` accepts `festivalSlug`
  (`null` clears; must be an ACTIVE festival of kind `regional` or `online`, else 400
  `details.festivalSlug`). Allowed even while `mustChangePassword` is set? No — same rules as other
  profile writes.
- Admin only: `POST /api/admin/festivals` (201), `PUT /api/admin/festivals/:id` (partial update),
  `DELETE /api/admin/festivals/:id` (204; users pointing at it get NULL). Validation: name 3–80,
  slug auto from name on create (unique; 409 on clash), kind enum, dates `YYYY-MM-DD` real calendar
  dates with `endDate >= startDate` when both set, dateLabel ≤ 120, venue/city ≤ 120, province ≤ 40,
  infoUrl https ≤ 500, sortOrder integer. Same CSRF/content-type/rate-limit rules as other writes.

**Client behaviour**
- `FestivalProvider` + `useFestival()` → `{ festivals, regionalChoices, selected: Festival|null,
  setFestival(slug|null), source }`. Selection priority: `?festival=<slug>` in the URL (applied
  once, persisted, then removed from the URL with `replace`) → the logged-in user's
  `festivalSlug` → localStorage `star.festival` → `meta.defaultFestivalSlug` → none. Changing it
  updates localStorage and, when logged in, `PUT /api/auth/me` (optimistic; toast on failure). On
  login/signup: if the account has a festival, adopt it; if not and the browser has one, save it to
  the account. Unknown/inactive slugs are ignored gracefully.
- `FestivalPicker` (accessible: native `<select>` or a proper listbox popover): regionals grouped
  "BC regional festivals" (date order, TBD last) and "Online"; each option shows name/city + date.
  Reachable from every page (header on wide screens and inside the mobile menu, as a compact
  "📍 Surrey" chip / "📍 Choose your festival"), plus prominent on Home, STAR Prep and My Stuff.
- **Home hero:** selected → "<name> · <date>", "Curtain up at <venue> in…" + countdown (online:
  "Online entries close in…" — see deviations; TBD: "Date to be announced — check with your teacher"; today:
  "Curtain up today!"; past: "That's a wrap! 🎉" + a nudge toward nationals — list `national`
  festivals, e.g. STAR Fest West May 20–23, 2027 at UBC). None selected → "Where are you
  performing?" with one-tap chips for each BC regional + Online (no countdown until chosen).
- **STAR Prep:** hero countdown for the selected festival; the regional list comes from the API
  (not hardcoded) with a "Your festival" badge + "Make this mine" buttons; an "After regionals:
  National STAR Festivals" block from `kind='national'` rows; keep the "confirm dates with your
  teacher" caveat and the TAEA link.
- **My Stuff:** "My festival" setting (picker). **Admin:** new "Festivals" tab — table/cards with
  add, edit (modal form), hide/show (active), delete (confirm).
- Share links: a "Share a link for this festival" copy button (e.g. on STAR Prep) producing
  `<origin>/?festival=<slug>` so teachers can send classes a pre-set link.
- Multi-day dates render as ranges ("May 20–23, 2027"). Date helpers must treat 'YYYY-MM-DD' as a
  local calendar day (existing `parseLocalDate`).

**As built — deviations and decisions (2026-09-27)** (the rest of §7b holds as written):
- **Data:** `festivals.json` follows TAEA's 2026/27 table exactly; Victoria (`2026-12-10`) and the
  Online Regional deadline (`2027-02-28`) have no year there, so the season's years are inferred
  (noted in the file's `_about`). Nanaimo is `dateLabel: "Date and venue to be announced"`, no venue.
  STAR Fest West's `infoUrl` is TAEA's national page.
- **Online wording:** the hero says "Online entries close in…" / "Online entries close today!", not
  "Video submissions…": TAEA's table only says "Closes February 28th" and nothing on its pages says
  the entries are videos. The countdown runs to the END of the deadline day, then "Submissions closed".
- **Schema:** extra column `festivals.edited_at` (set when an admin creates or really changes a
  festival, like songs/shows). `npm run import` treats a row as website-edited when `edited_at` is set
  or `updated_at > created_at`; a save that changes nothing doesn't count. Festivals missing from the
  file are never deleted; `--reset` reloads them from the file. Startup seeding runs only while the
  table is empty.
- **Deleted festivals stay deleted** (migration v4): `DELETE /api/admin/festivals/:id` records the slug in
  `festival_tombstones(slug TEXT PRIMARY KEY, deleted_at TEXT NOT NULL)` (`import_tombstones` only takes
  songs/shows). `npm run import` and startup seeding skip tombstoned slugs (the import counts them as
  `skippedDeleted`, prints "not re-created (deleted on the website)" and warns) unless `--overwrite-edits`,
  which re-creates them and clears the tombstone; an admin `POST` that makes the same slug clears it too.
- **Slugs:** made from the name with parentheses and the "Regional STAR Fest" / "STAR Fest(ival)"
  ending dropped ("Kelowna Regional STAR Fest" → `kelowna`), max 60 chars; a clash is 409 (`error`
  and `details.name` name the festival that has it, plus `existingId`); the slug never changes on
  PUT, so share links survive renames. Slugs in links / `PUT /auth/me` are trimmed + lowercased.
- **Ordering:** the API orders by `sort_order`, then dated before undated, `start_date`, name. The
  client re-sorts every list for display by date ("to be announced" last) with `sortOrder` breaking
  ties — so that's what students and admins see.
- **Extra endpoints/fields:** `GET /api/admin/festivals` (admin alias of `?all=1`); admin write
  endpoints return the bare `Festival`; `POST /api/auth/signup` accepts an optional `festivalSlug`
  (same rules as `PUT /auth/me`), and the client sends the visitor's own (url/local, never default)
  choice, retrying without it if refused.
- **Temporary password:** the server lets `PUT /auth/me` set `festivalSlug` like the display name
  ("same rules as other profile writes"); the client keeps the choice on the device until the new
  password is chosen, then saves it to the account — even if the account already had one (a choice made
  while it couldn't be saved beats the account's older value; the same goes for a save that found the
  session ended, when that same user logs back in; another user logging in gets their own festival).
- **Saves in flight:** the client compares a new choice with the last value queued for the account (not
  the possibly stale `user.festivalSlug`), so A→B→A sends A again and the last choice wins; a save that
  answers after a logout / another login doesn't put that user back into the page.
- **Festival checked at write time:** signup and `PUT /auth/me` (with a password change) validate
  `festivalSlug`, wait for scrypt, then look the festival up again right before the write; a festival
  hidden/deleted meanwhile → 400 `details.festivalSlug` (a foreign-key failure maps to the same 400, and only
  a UNIQUE clash on the email is the signup 409).
- **Online "Opens" day:** for `kind='online'`, `end_date` is the submission deadline even when
  `start_date` (the admin form's "Opens") is set — the countdown, phase and status follow the deadline
  ("Online entries open <day> and close in…" before opening). An online festival with only an opening day
  counts to it, then reads "Online entries are open now" (never "wrapped").
- **Phases at midnight:** heroes and cards re-check the phase at every local midnight (`useLocalDay`), so
  the copy changes together with the countdown; the "Next stop" nationals nudge lists only nationals that
  aren't over (none left → "See you next season!").
- **`STAR_DEFAULT_FESTIVAL`:** trimmed, case-insensitive, re-checked on every `/api/meta` (admins can
  hide it); an invalid value is warned about once at startup (and again only if it becomes invalid).
  A default is never stored in localStorage or pushed to an account. The e2e server runs without it
  (the first-visit chips are tested); its client side is tested by answering `/api/meta` with a default.
- **Hidden / deleted festivals:** a user's hidden festival is still returned as `festivalSlug`; the
  client ignores it (falls back to this device → default → the chips) and picks it up again, without a
  reload, if it's shown again while nothing else is chosen. If the device has another valid choice,
  that one is re-saved to the account. `DELETE` sets `users.festival_id` to NULL.
- **Links:** `?festival=` works on any route; other params and the hash are kept when it's removed;
  a success toast names the festival, an unknown/national slug gets a polite note. The copy button is
  labelled "Copy a link for this festival" and shows the URL. National rows in Admin → Festivals
  have no share link and a "Listed" switch (their `active` only controls whether they're listed).
- **Header:** the chip is in the bar from 640px (a 📍-only button at 1100–1279px, where the desktop
  nav needs the room); below 640px the picker is a native `<select>` in the mobile menu.

## 7c. Show & song catalog, smart suggestions, easy art/audio — added 2026-09-27

Goal: when someone adds a song they **pick it from a comprehensive catalog first**; the form is then
pre-filled with **suggestions** (each labelled with where it came from and how sure we are), and
attaching **album art and audio** is one click or one drag-and-drop. The site is live: every schema
change is an additive migration, the catalog loads itself on deploy, and community data is never
touched by catalog loads.

### Catalog data (built offline, shipped in the repo)
Built by `npm run catalog:build` (root script → `tools/catalog/`, a separate maintainer tool
with its OWN package.json/node_modules so it never touches server deps; network; raw responses
cached in `tools/catalog/.cache/` (gitignored); deterministic output) from:
- **Wikidata** (CC0) — every stage musical (instance/subclass of musical Q2743 and its stage-work
  subclasses: rock musical, jukebox musical, sung-through, musical comedy, rock opera staged as a
  musical, etc.; EXCLUDE musical films/TV) that has an English Wikipedia article: title, alt
  titles, composer / lyricist / librettist, year of first performance, genres, short description.
- **English Wikipedia** (CC BY-SA 4.0) — the song list of each show ("Musical numbers" / "Songs" /
  "Song list" sections, act headings, tables or bullet lists, and "List of songs in …" sub-pages
  when linked) with **who sings each song** (characters), reprise/instrumental flags; plus the
  "Characters"/"Roles" section when present (character names, voice types if stated).
Output: `server/seed/catalog/catalog.json.gz` (+ `server/seed/catalog/README.md` with sources,
build date, counts and the data licence: Wikipedia-derived content CC BY-SA 4.0, Wikidata CC0 —
the code stays MIT). Format (gzip of one JSON document):
```jsonc
{
  "version": "2026-09-27.1",          // bump on every rebuild; the server reloads when it changes
  "generatedAt": "ISO datetime",
  "sources": { "wikidata": "...", "wikipedia": "..." },
  "shows": [{
    "key": "Q192111",                  // Wikidata QID (stable key); "wp:<enwiki title>" if no QID
    "title": "Les Misérables",
    "altTitles": ["Les Mis"],          // may be []
    "wikiTitle": "Les Misérables (musical)",
    "wikidataId": "Q192111" | null,
    "composer": "Claude-Michel Schönberg" | null,
    "lyricist": "Herbert Kretzmer" | null,   // English lyrics where the article says so
    "bookWriter": "Alain Boublil, Claude-Michel Schönberg" | null,
    "year": 1980 | null,               // first performance
    "genres": ["sung-through"],        // lowercase free text from Wikidata/Wikipedia, may be []
    "description": "musical" | null,   // Wikidata short description (CC0), not Wikipedia prose
    "characters": [{ "name": "Jean Valjean", "voiceType": "Baritone" | null }],   // may be []
    "songs": [{
      "title": "Bring Him Home",
      "act": 2 | null, "position": 17,           // order within the show list (1-based)
      "singers": ["Jean Valjean"],               // parsed character names ([] if unknown)
      "singersRaw": "Valjean",                   // text as written in the source ("" if none)
      "ensemble": false,                          // chorus/company/ensemble/townspeople take part
      "reprise": false, "instrumental": false    // overture, entr'acte, underscoring → instrumental
    }]
  }]
}
```
Quality bar (verified by sampling against the live source pages): song titles ≥ 98% exact,
singer attribution ≥ 95% correct where the source names singers, no instrumental tracks marked
as sung, no duplicate songs within a show (reprises kept but flagged).

### Database (migration v5, additive)
```sql
CREATE TABLE catalog_shows (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, alt_titles TEXT NOT NULL DEFAULT '[]',
  wiki_title TEXT, wikidata_id TEXT, composer TEXT, lyricist TEXT, book_writer TEXT, year INTEGER,
  genres TEXT NOT NULL DEFAULT '[]', description TEXT, characters TEXT NOT NULL DEFAULT '[]',
  itunes_collection_id INTEGER,          -- cast album found on demand, cached for everyone
  song_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE catalog_songs (
  id INTEGER PRIMARY KEY, show_id INTEGER NOT NULL REFERENCES catalog_shows(id) ON DELETE CASCADE,
  title TEXT NOT NULL, act INTEGER, position INTEGER, singers TEXT NOT NULL DEFAULT '[]', singers_raw TEXT,
  ensemble INTEGER NOT NULL DEFAULT 0, reprise INTEGER NOT NULL DEFAULT 0, instrumental INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'wikipedia' CHECK (source IN ('wikipedia','recording')),
  UNIQUE (show_id, title COLLATE NOCASE, reprise)
);
CREATE VIRTUAL TABLE catalog_fts USING fts5(song_title, show_title, alt_titles, singers,
  tokenize = 'unicode61 remove_diacritics 2');      -- rowid = catalog_songs.id; shows indexed via a
                                                   -- separate catalog_show_fts(title, alt_titles, credits)
CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT);   -- 'version', 'loadedAt', counts
ALTER TABLE shows ADD COLUMN catalog_show_id INTEGER REFERENCES catalog_shows(id) ON DELETE SET NULL;
ALTER TABLE songs ADD COLUMN catalog_song_id INTEGER REFERENCES catalog_songs(id) ON DELETE SET NULL;
```
- **Loader** (`server/src/lib/catalog.js`): at startup, if the seed file's `version` differs from
  `catalog_meta.version` (or tables are empty), reload the catalog in one transaction (fast bulk
  insert; must stay well under ~10 s for ~100k songs), preserving rows with `source='recording'`
  and `itunes_collection_id` values by `key`, then re-link site shows/songs
  (`catalog_show_id`/`catalog_song_id`) by accent/case-folded title (+ alt titles; songs within the
  linked show, ignoring punctuation and "(Reprise)" differences). Never modifies community
  rows' other fields. Missing seed file → log a warning and keep going (catalog features show an
  empty state). Also `npm --prefix server run catalog:load` (force reload) for maintainers.
- Adding/editing a site song sets `catalog_song_id` when the form came from the catalog (client
  sends `catalogSongId`); new site shows created from the catalog get `catalog_show_id` and are
  pre-filled with the catalog credits/year (and Wikipedia poster via the existing lookup flow).

### API (public GETs + one logged-in write; lookup rate limits apply to anything that calls Apple)
- `GET /api/catalog/search?q=&limit=20` → `{ results: CatalogHit[] }` — typeahead over songs AND
  shows (FTS5 prefix search on every token, accent/case-insensitive; user input must be escaped
  into safe FTS5 syntax — never passed raw to MATCH). Ranking: exact title > prefix > bm25; songs
  from shows already on the site get a small boost. `q` < 2 chars → empty results.
  ```ts
  type CatalogHit =
    | { type: 'song'; id: number; title: string; show: { id: number; title: string; year: number|null };
        singers: string[]; reprise: boolean; ensemble: boolean; onSite: { songId: number } | null }
    | { type: 'show'; id: number; title: string; year: number|null; composer: string|null; songCount: number;
        onSite: { showId: number; slug: string } | null };
  ```
- `GET /api/catalog/shows/:id` → show details + `songs` (instrumentals excluded by default,
  `?all=1` includes them), each with `onSite`. If the show has no songs, the response includes
  `recordingTracksAvailable: true` when a cast album can be found.
- `POST /api/catalog/shows/:id/recording-tracks` (logged in + CSRF header) → finds (and caches in
  `itunes_collection_id`) the show's cast album on Apple via the existing iTunes album-scan logic and
  returns its tracks as catalog songs, persisting them with `source='recording'` (singers unknown) so
  later users get them instantly → `{ album, added, saved: true, songs }`. `GET` on the same path is
  read-only: the saved tracks, or a preview (`saved: false`, songs with `id: null`) that saves nothing
  (see "As built" below).
- `GET /api/catalog/songs/:id/suggestions` → pre-fill data (fast, no Apple calls):
  ```ts
  interface Suggested<T> { value: T; source: string; confidence: 'high'|'medium'|'low'; note?: string; alternatives?: T[] }
  interface CatalogSuggestions {
    catalogSong: { id; title; act; singers: string[]; singersRaw: string; ensemble; reprise };
    existingSong: { id: number; title: string; kind: Kind } | null;    // already on the site
    show: { siteShow: { id; name; slug } | null; catalogShowId: number; name: string;
            composer; lyricist; bookWriter; year; wikiTitle };
    title: Suggested<string>;
    kind: Suggested<Kind> | null;               // 1 singer → solo, 2 → duet; null + note if 0 or 3+/ensemble
    parts: Suggested<{ character: string; vocalRange: string|null; rangeSource?: string }[]>;
    genre: Suggested<string> | null; subGenre: Suggested<string> | null; mature: Suggested<boolean> | null;
  }
  ```
  Sources, in priority order: vocal range ← same show+character already on the site (most common
  value; 'high' if unanimous) ← catalog character voiceType ('medium') ← none. Genre/mood/mature
  ← other site songs from the same show ('medium', alternatives = the others) ← catalog show genres
  mapped (comedy→Comedy, tragedy/drama→Drama, romance→Romantic) ('low') ← none. Every `source`
  string is human-readable, e.g. "from 3 other Les Misérables songs on the site", "from the
  Wikipedia song list", "from the Original Broadway Cast Recording".
- `GET /api/catalog/songs/:id/recordings` → `{ candidates: ItunesCandidate[] }` (best first; uses
  the show's cached cast album first, falls back to song search; each candidate includes
  `durationSeconds`, `artworkUrl`, `previewUrl`, album/artist) — the client derives the length
  suggestion ("3:21 from <album>") from the chosen candidate.
- `POST /api/songs` / `PUT /api/songs/:id` accept optional `catalogSongId` (must exist).
- **Song artwork upload**: `POST /api/songs/:id/artwork` multipart `file` (jpeg/png/webp/gif ≤ 5 MB,
  magic-byte checked, metadata stripped like other image uploads) → `Song`; stored under
  `/uploads/art/`, replaces the previous uploaded art (old file deleted); `DELETE /api/songs/:id/artwork`
  → `Song` (removes the uploaded image; falls back to the recording art if the song has one, else none).
  Owner-or-admin, same CSRF/rate-limit/quota rules as audio uploads. `SongMedia` gains
  `artworkSource: 'recording' | 'upload' | null`.

### Client
- **Add a song = "Find your song" first** (`/add`): a big catalog search (typeahead, keyboard
  friendly; results show song title, show + year, singers, badges "Solo"/"Duet"/"Ensemble" guess,
  "Already on the site ✓" with a link). Choosing a **song** → `/add?catalogSong=<id>`: the form opens
  pre-filled; each pre-filled field shows a small suggestion chip ("✨ from the Wikipedia song list",
  "✨ from 3 other songs in this show") with the confidence, and alternatives as one-tap chips; the
  user can change anything. Choosing a **show** → a song list for that show to pick from (with
  "Load songs from the cast album" when the catalog has none), plus "My song isn't listed" →
  manual entry with the show pre-filled. "Can't find it? Enter it manually" always available.
  If the chosen song is already on the site: friendly callout "Already in the songbook — open it"
  (still allow adding a different kind, e.g. a duet version, if not a true duplicate).
- **Recording picker** (reused on the form and on the song page for owners): loads
  `/recordings` asynchronously after the form opens, auto-selects the best match (art + 30-sec
  preview + suggested length), shows alternatives in a scrollable strip with ▶ preview, and "No
  recording" option. Choosing one updates the length suggestion.
- **Album art & audio made easy**: in the form's last step and on the song page (owner/admin) —
  artwork: current image with "Use recording art" / "Upload my own" (drag-and-drop or click, image
  preview, client-side type/size checks) / "Remove"; audio: drag-and-drop "Add your backing track
  (no vocals)" with progress + remove, plus the audio link field. Song page shows friendly empty
  states for owners ("Add album art", "Add a backing track") where media is missing.
- Attribution: wherever catalog data is shown, a small "Song list from Wikipedia (CC BY-SA)"
  credit; README gets a "Catalog data" section.

**As built — deviations and decisions (2026-09-27)** (the rest of §7c holds as written):
- **Catalog build** (`tools/catalog`): a version string is never issued twice for different content —
  every version is recorded with the SHA-256 of its content in `tools/catalog/versions.json`
  (+ `.cache/versions-issued.json`); identical content keeps its version. **Vandalism gate**
  (`src/review-gate.js`): before the seed file is replaced the build writes a readable diff against it
  (`.cache/diff-<version>.txt`) and stops (exit 2, nothing written) when new or changed text looks like
  vandalism (strong profanity/slurs, "… is gay"-style phrases, links/e-mail/handles, keyboard mashing,
  emoji, shouting) or a song list was mostly blanked / the catalog shrank by > 10%; `--accept-review`
  after a human check. Songs that only a later production list has are added in place (the licensed
  list stays primary); songs named in list notes likewise. The file has no `mature` field (mature is
  suggested only from the site's own songs of the show). Measured on v2026-09-27.28 against 150 live
  articles: titles 99.49% exact, singers 99.23% supported by the source text, 0 duplicates, 0
  instrumentals marked as sung.
- **Migration v6** (additive, after v5): `shows.catalog_link` / `songs.catalog_link`
  (`NULL` = automatic, `'manual'` = chosen by someone who may edit the row, `'none'` = "not in the
  catalog"), `catalog_shows.retired`, `itunes_collection_name` (v5), `itunes_checked_at`,
  `itunes_check_found`, `itunes_saved_at`, `itunes_saved_by`, and
  `catalog_rejected_albums(show_key, collection_id, rejected_at, rejected_by)`.
- **Loader:** reloads when the file's **SHA-256** differs from the loaded one (`catalog_meta.fileHash`;
  older databases without it compare version + `generatedAt`), not only the version. Refuses (keeps the
  loaded catalog, logs a warning) a file with no shows, less than half the loaded shows or songs, many
  keyless shows, > 50 MB packed or > 256 MB unpacked; `catalog:load -- --force` overrides. A show that
  leaves the file but still holds site data (cast-album songs, a cached album, chosen links) is
  **retired** (hidden from search and matching) instead of deleted. Cast-album songs of a show that now
  has a Wikipedia list are removed (linked site songs move to the matching listed song).
- **Linking:** ties between same-named catalog shows are broken by year, composer and the site show's
  own songs — otherwise the show is left unlinked; a title and another show's alt title count equally.
  Family names shared by several characters (Thénardier) never match a part on their own. Chosen links
  (`catalog_link='manual'`) and "not in the catalog" (`'none'`) stick across reloads; `catalogSongId: null`
  on a song sticks too. `PUT /api/shows/:id` accepts `catalogShowId`: a number (owners: a catalog show
  with the same name; admins: any), `null` ("not in the catalog") or `'auto'`. "(Reprise 2)" only
  matches "(Reprise 2)".
- **Recording tracks:** saving is `POST` (above). For clients from before the POST, a logged-in user's
  same-site `GET` still saves (deprecated). At most 60 tracks are saved, explicit albums and tracks are
  skipped, an album that another same-named show may own is refused, and every save is logged with
  the user id. Show pages (`GET /api/catalog/shows/:id`) never save an album: `recordingTracksAvailable`
  comes from one CA-store check kept in the database for a week (a failure for 2 minutes), and is
  `null` ("couldn't check") past the limits — never a 429. `castAlbum` is set only once an album is saved.
- **Admin:** `GET /api/admin/catalog/recordings` lists saved cast albums / cast-album songs (who, when);
  `DELETE /api/admin/catalog/shows/:id/recording` removes them and rejects that album for the show
  (`?reject=0` to allow it again); `npm --prefix server run catalog:clear-recording -- <id|key>`
  (`-- --list`) does the same from the shell. The client has an **Admin → Cast albums** tab, and the
  Edit show modal a **Song catalog** field (keep / match by name / not in the catalog / link to another
  catalog show).
- **Apple budget:** every call to Apple's iTunes API shares one site-wide token bucket
  (`STAR_APPLE_LIMIT`, default 20/min, short queue); when it's spent, lookups answer **503 +
  Retry-After** (the client says how long to wait, and a background recording lookup retries once).
- **Search:** its own limit (`STAR_SEARCH_LIMIT`, 120/min per user or IP); queries of only one-letter
  words return nothing; very common words and a trailing single letter only filter; results are cached
  (1,000 entries, cleared when the catalog changes). A show without a song list goes after the songs
  unless its name is exactly the query ("frozen" → Frozen, its songs, then "Frozen – Live at the Hyperion").
- **Suggestions** (extras beyond the interface above): `kindNote`, `existingSongs` (every site version
  of the song), parts with `catalogName` / `rangeConfidence` / `rangeAlternatives`; the song itself is
  never counted among "other" songs; duets are `'medium'` and, unless the site already has the song only
  as a duet, offer `alternatives: ['solo']` with a note (the second listed singer may only have a line);
  a group number takes the kind of the version already on the site. A new solo/duet that duplicates one
  already in the show (same catalog song, or same title ignoring punctuation, same kind) → **409** with
  the existing id.
- **Recordings:** a candidate that isn't on a recognised recording of the show must score ≥ 60 and is
  never a karaoke/cover/tribute or foreign-language cast album. The client auto-picks only a clear match
  (a cast album, or ≥ 85 with an album label); weaker ones are "Possible matches — listen first".
- **Images:** uploads (album art, posters, downloads) are limited to 8192 px a side, 25 megapixels, 300
  animation frames / 50 MP total; PNG/WebP/GIF keep only the chunks needed to draw the image (C2PA and
  private chunks go), JPEG also loses JFIF/JFXX thumbnails.

## 8. Root scripts (package.json at repo root)
- `npm run setup` → install server + client deps, run import (creates `server/data/star.db`).
- `npm run dev` → concurrently: server (`node --watch src/index.js`) + client (vite).
- `npm run build` → client build. `npm start` → production server on 3001 serving client/dist.
- `npm test` → server tests + client unit tests. `npm run e2e` → playwright.
- `npm run enrich` → (network) find previews/art/show info for anything missing, update DB + seed files.
- `npm run backup [-- dir]` → consistent copy of the database + `server/uploads/` into `backups/star-<date>/`.
  `npm run make-admin -- email` → see §5c. `npm --prefix server run clean-uploads [-- --delete]` → list/remove unreferenced upload files.
- `npm start` = `node server/src/index.js --production` (works on Windows). Relative paths in
  `STAR_DB_PATH`/`STAR_UPLOADS_DIR`/`STAR_MEDIA_DIR` and CLI arguments resolve from the directory `npm`
  was run in (`INIT_CWD`). Node `>=22.12.0 <27`.
