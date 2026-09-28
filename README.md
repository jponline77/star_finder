# 🌟 STAR Song Finder

A website that helps high-school students (grades 6–12) choose a **musical-theatre solo or duet**
for the **STAR Festival** (School Theatrical Arts Recognition, run by TAEA —
<https://taeacanada.ca/regional-star-fest/>). Students anywhere in BC pick **their** regional STAR
Fest (Prince George, Fraser Valley, Victoria, Vancouver, Burnaby, Surrey, Nanaimo) or the Online
Regional, and the countdown and STAR Prep dates follow that choice (see
[Festivals](#festivals-choosing-a-location)).

Students can:

- **Browse and search** 122 solos and duets from the STAR song spreadsheet (plus anything the
  community adds): filter by solo/duet, voice type, genre, mood, length and "hide mature themes".
- **Listen** to a 30-second Apple Music preview of almost every song.
- Check each song against **STAR's rules**: the 6:00 time limit, one or two characters, the
  licensor, and whether it has mature themes. A **slate builder** writes out the spoken
  introduction for them.
- Find songs with the **Matchmaker** quiz or **Spin the Spotlight**, keep a **setlist**, and
  practise with the **rehearsal timer** on the STAR Prep page.
- **Choose their festival** (📍 in the header): the home page counts down to it, and STAR Prep shows
  its date and venue. Teachers can send a class a link that picks it for them.
- **Add songs and shows** that are missing, and share tips in the comments ("Backstage Chatter").

Everyone can browse without an account. Adding songs and commenting need a free account.

> This is a student-friendly fan project. It is not affiliated with or endorsed by TAEA. Always
> confirm song eligibility and licensing with your teacher.

---

## Quick start

You need **Node.js 22.12 or newer** (up to Node 26; Node 22.0–22.11 can't build or test the
client). The first setup downloads packages and images, so it needs internet access. `better-sqlite3`
normally downloads a ready-made binary from github.com; if it can't (an unusual platform, a very new
Node, or a network that blocks GitHub) it compiles itself and then needs build tools: Python 3,
`make` and a C++ compiler (Xcode Command Line Tools on macOS, "Desktop development with C++" from
Visual Studio Build Tools on Windows, `build-essential` on Debian/Ubuntu).

```bash
npm run setup      # installs everything, downloads the posters and album art, builds the song database (server/data/star.db)
npm run dev        # development mode → open http://localhost:5173
```

The first setup also downloads the **show posters** (from Wikipedia) and the **album art** (from
Apple) into `server/media/`. They're other people's artwork, so they aren't in this repository (see
[Third-party content](#third-party-content)). Offline, the setup still finishes — the site just shows
colourful gradient placeholders instead — and you can run **`npm run fetch-media`** any time later to
download whatever is missing (images already there are kept; no re-import needed).

To run it the way it runs on a real server:

```bash
npm run build      # build the website
npm start          # production server → open http://localhost:3001
```

`npm start` serves both the website and the API from one port (3001, or `PORT`). It works the same
on Windows, macOS and Linux (it runs `node server/src/index.js --production`).

### Making the first admin

Admins can edit or delete anything, moderate comments, and manage accounts. The site never checks
that someone owns the email address they sign up with, so **an email address alone never makes an
account an admin** — otherwise a student could sign up with the teacher's address before the
teacher does. Instead:

1. The teacher **signs up on the site first**, with their own password. (If they get "An account
   with that email already exists", someone else may have registered their address — don't promote
   it. Sign up with another address, promote that one, and disable the other account from the
   Admin page.)
2. Whoever runs the server promotes that account: `npm run make-admin -- teacher@school.ca`. It
   prints the account's display name and sign-up date so you can check it's really theirs.

After that, admins can promote other users from the **Admin** page.

`STAR_ADMIN_EMAILS` does the same as `make-admin`, at every server start, for accounts that
**already existed when the email was first added to the list**. An account created with a listed
email *after* it was listed (possibly by someone else) is not promoted; the server log says so and
tells you to check it and use `make-admin`. Signing up or logging in never promotes anyone. A listed
admin can't be demoted from the Admin page (it would come back at the next start) — remove the
email from `STAR_ADMIN_EMAILS` first, or disable the account.

---

## Accounts & permissions

| Who | Can do |
|---|---|
| Anyone (no account) | Browse, search, listen, use the Matchmaker, Spin, Setlist, STAR Prep and Stats, download the spreadsheet |
| Logged-in user | Everything above, plus add songs and shows, upload practice audio, and comment. They can edit or delete **only the songs, shows and comments they added** |
| Admin | Everything, including editing the original spreadsheet songs and shows, removing any comment, promoting or disabling accounts, resetting passwords, editing the festival list (**Admin → Festivals**), and removing cast albums saved for catalog shows (see [Catalog data](#catalog-data-shows--songs-to-pick-from)) |

- Songs from the original spreadsheet say "From the STAR spreadsheet" and only admins can change them.
  Songs added by users say "Added by *display name*" and get a Community ribbon.
- **Forgotten password:** there is no email reset. An admin opens **Admin → Users → Reset
  password** and gets a temporary password to pass on. When the student logs in with it they must
  choose a new one (a different one) before they can change anything else, and an unused temporary
  password stops working after **3 days**. Admins change their own password in **My stuff**, not
  with Reset.
- **Deleting:** deleting a song or show also removes its comments, so a student can only delete
  their own song or show while nobody else has commented on it; after that, an admin can remove it.
- Admins can **disable** an account instead of deleting it. That user is logged out and can't log
  back in, but their songs and comments stay until an admin removes them.
- The server refuses to disable or demote the last active admin, and admins can't disable themselves.
- Each account can add up to 50 songs and 20 shows a day, and store up to 200 MB of uploads
  (admins have no limits). See the `STAR_*` settings below.

### Privacy

- **Email addresses are never shown publicly.** Only the account owner and admins can see an email.
  Everyone else sees only the display name.
- Students should pick a **nickname as their display name, not their full name**. The signup form
  tells them this.
- Passwords are stored as salted `scrypt` hashes. Sessions use an HTTP-only cookie, and the
  database stores only a hash of the session token.
- A student's chosen festival is kept in their browser, and in their account when they're logged in
  (so it follows them to another device). Only they and admins can see it; it's never shown on
  songs, comments or anywhere public.
- The setlist and the slate builder's name/school fields are kept **only in the student's own
  browser**, never on the server. The slate details last only until the tab is closed, unless the
  student ticks **"Remember my details on this device"** (there's also a "Clear my details" button).
  Logging out clears them, and clears any unsaved form drafts, so nothing is left behind on a shared
  school computer.
- If a session ends while a student is typing a song or a comment, what they typed is kept in that
  tab for up to 6 hours and comes back after they log in again (only for the same account).
- Uploaded photos are published **without their hidden metadata** (GPS location, camera serial
  numbers, timestamps, comments); only the "which way up" setting is kept. Uploaded MP3/AAC files
  lose their ID3 tags (which can hold names and cover photos).
- Invisible text-direction characters are removed from names, titles and comments, so nobody can
  make their name display as something else (like a website address).

---

## Adding a song

1. **Find it.** "Add a song" opens **Find your song**: start typing a song or a show. Pick a song and
   the form is filled in for you; pick a show to see its song list (grouped by act, with who sings
   each song and a Solo / Duet / Ensemble guess). Songs already on the site say so, with a link. If a
   show has no song list yet, **Load songs from the cast album** gets the track list from Apple
   Music. **Enter it manually** is always there for anything that isn't in the catalog.
2. **Check it.** Every filled-in field has a small note saying where it came from ("from the
   Wikipedia song list", "from 3 other Les Misérables songs on the site") and how sure we are
   (*sure*, *pretty sure*, *a guess*). Tap an alternative to use it instead, or just change the
   field. A song whose list names two singers is guessed as a duet — if one of them only has a line
   or two, tap **Solo** and pick the character who really sings it.
3. **Art and audio** (the last step of the form, and later on the song page for the song's owner or
   an admin) — see below. Then save.

### Adding album art and audio

- **Recording:** for a song picked from the catalog, the form finds recordings on Apple Music by
  itself. It only picks one when it's clearly this song from this show's cast recording ("Best
  match — picked for you"); otherwise it shows **Possible matches — listen first**. Press ▶ to hear
  the 30-second preview, tap a card to choose it, or choose **No recording**. The chosen
  recording gives the song its preview, its album art and a suggested length (the cast recording's
  length — your version may differ). On the song page, owners use **Change recording**.
- **Album art:** by default the song shows the recording's album cover. **Upload my own** (or drag
  an image onto the box) to use your own picture instead — JPEG, PNG, WebP or GIF, up to 5 MB.
  Hidden photo data (like GPS location) is removed when it's uploaded. **Use recording art** or
  **Remove** goes back to the recording's cover.
- **Backing track:** drag an audio file onto **Add your backing track (no vocals)**, or choose one —
  MP3, M4A, AAC, WAV, AIFF or OGG, up to 25 MB. You'll see the upload progress, and you can remove
  it later. You can also paste a link to a backing track (e.g. on YouTube) instead.
- Only upload images and audio you're allowed to share. Uploads count toward your upload space
  (200 MB) and are deleted with the song.
- If Apple Music is busy (lots of people looking up recordings at once), the form says how long to
  wait and tries again by itself; you can always save the song first and add a recording later.

---

## Configuration (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3001` | Port for the server |
| `HOST` | all interfaces | Address to listen on. Use `127.0.0.1` behind a reverse proxy |
| `NODE_ENV` | — | `production` makes the server serve the built website from `client/dist` (`npm start` passes `--production`, which does the same) |
| `STAR_ADMIN_EMAILS` | — | Comma-separated emails whose **existing** accounts are made admins at startup (see [Making the first admin](#making-the-first-admin)) |
| `TRUST_PROXY` | off | Set when running behind a reverse proxy / HTTPS terminator: `true` = trust a proxy on this machine (`loopback`), a number = that many hops, or an Express value like `10.0.0.0/8` or `loopback, uniquelocal` (a proxy in another container) |
| `STAR_DB_PATH` | `server/data/star.db` | SQLite database file |
| `STAR_UPLOADS_DIR` | `server/uploads` | Everything added on the website: uploaded audio and posters, and album art/posters fetched from Apple/Wikipedia |
| `STAR_MEDIA_DIR` | `server/media` | Posters and album art of the spreadsheet shows/songs, downloaded by `npm run fetch-media` (the website never writes here) |
| `STAR_CATALOG_PATH` | `server/seed/catalog/catalog.json.gz` | The show & song catalog the server loads at startup (see [Catalog data](#catalog-data-shows--songs-to-pick-from)) |
| `STAR_WRITE_LIMIT` | `60` | Changes per minute (per logged-in user, or per IP when logged out) |
| `STAR_READ_LIMIT` | `1200` | API page loads per minute (per user, or per IP) |
| `STAR_EXPORT_LIMIT` | `10` | Spreadsheet downloads per minute |
| `STAR_COMMENT_LIMIT` | `20` | Comments per minute per user |
| `STAR_LOOKUP_LIMIT` | `30` | Apple Music / Wikipedia lookups per minute (per user, or per IP). Catalog show pages never get a "too many" error: past this they just say they couldn't check for a cast album |
| `STAR_APPLE_LIMIT` | `20` | Calls to Apple's iTunes API per minute for the **whole site** (Apple allows about 20 per client, and the server is one client — going over gets it blocked for everyone). Past it, lookups answer "busy, try again in a minute" (HTTP 503) |
| `STAR_SEARCH_LIMIT` | `120` | "Find your song" catalog searches per minute (per user, or per IP) |
| `STAR_LOGIN_LIMIT` | `10` | Failed logins per 15 minutes per IP + email; also wrong "current password" tries per account |
| `STAR_SIGNUP_LIMIT` | `100` | Sign-ups per hour per IP (a whole class often shares one school IP) |
| `STAR_SIGNUP_CONFLICT_LIMIT` | `20` | "That email already has an account" answers per hour per IP (stops guessing classmates' emails) |
| `STAR_DAILY_SONG_LIMIT` / `STAR_DAILY_SHOW_LIMIT` | `50` / `20` | New songs / shows per account per day (admins exempt; `0` = no limit) |
| `STAR_UPLOAD_QUOTA_MB` | `200` | Upload space per account (admins exempt; `0` = no limit) |
| `STAR_UPLOAD_CONCURRENCY` / `STAR_UPLOAD_TOTAL_CONCURRENCY` | `2` / `16` | Uploads one account / the whole site can run at the same time |
| `STAR_MIN_FREE_MB` | `256` | Uploads pause when the disk has less free space than this |
| `STAR_SHUTDOWN_GRACE_MS` | `20000` | On stop, how long to let running requests (e.g. uploads) finish |
| `STAR_ACCESS_LOG` | off | `1` logs every request (time, method, path, user id, status, duration) |
| `STAR_DEFAULT_FESTIVAL` | — | The festival a first-time visitor starts with, by its link name (e.g. `surrey`, `online`; see [Festivals](#festivals-choosing-a-location)). Must be a shown regional or online festival, otherwise it's ignored and the server log says so. Unset = visitors choose their own |

Relative paths (in `STAR_DB_PATH`, `STAR_UPLOADS_DIR`, `STAR_MEDIA_DIR`, `STAR_CATALOG_PATH` and
the import/backup/catalog-load arguments) are resolved from the directory you run `npm` in — the
project folder for the root scripts — the same way for `npm start`, `npm run dev`, `npm run import`,
`npm run fetch-media`, `make-admin`, `backup` and `catalog:load`.

In development (`npm run dev`), the Vite dev server runs on port 5173 (`VITE_PORT`) and forwards
`/api`, `/media` and `/uploads` to the API on the same `PORT` the server uses (so `PORT=4000 npm run
dev` just works). `VITE_API_TARGET` points it at a different API instead. See `client/README.md`.

---

## Where the data comes from

```
server/seed/star_spreadsheet.xlsx   the original STAR list (never modified)
        │
        │  + corrections.json   reviewed typo fixes, re-attributed songs, notes
        │  + shows.json         composer / lyricist / year / licensor / description / poster per show
        │  + media.json         the Apple Music preview + album art matched to each song
        │  + festivals.json     the STAR festivals (dates, venues) students can choose from
        ▼
npm run import  ─────────────►  server/data/star.db  ◄──── songs, shows & comments added on the website

npm run fetch-media  ────────►  server/media/shows/, server/media/art/   (posters + album art named in
                                shows.json / media.json, downloaded from Wikipedia and Apple)
```

- **`npm run import`** rebuilds the spreadsheet songs from the seed files. It is safe to run again
  at any time:
  - **Songs, shows and comments added on the website are never changed or deleted.**
  - Every spreadsheet row remembers which spreadsheet row it came from, so a song or show an admin
    renamed or moved on the website is recognised (no duplicates, same ids and links).
  - Spreadsheet songs and shows that an admin edited on the website are kept as they are, and ones
    an admin deleted stay deleted — unless you add `--overwrite-edits`. Uploading practice audio or
    a poster, or saving without changing anything, doesn't count as an edit (corrections still
    apply); a poster uploaded on the website is kept.
  - A spreadsheet song that has disappeared from the spreadsheet is removed, unless it has
    comments, uploads or website edits. If an import would remove more than a few songs (over 10%),
    it stops without changing anything — check the file, and add `--allow-deletions` if it's right.
  - If a student already added a show with the same name as a spreadsheet show, the import stops and
    names it. Add `--adopt-community` to make that show the official one (only admins can edit it
    afterwards; the student's own songs stay theirs), or rename/delete it first.
  - Posters and album art named in the seed files are linked even if they haven't been downloaded
    yet; one warning says how many are missing. Once `npm run fetch-media` has fetched them they
    simply appear — no second import needed.
  - `npm run import -- --reset` starts from an empty database. **This deletes all accounts,
    community songs and comments**, so back up first (see below).
  - `npm run import -- path/to/new.xlsx` imports a different copy of the spreadsheet (same layout:
    one sheet, a header row with "Song … Show", solos in columns A–H, duets in J–S). A file with
    no song rows, or the "Download the list" file from the website (a different layout), is refused
    without changing anything.
- **`npm run fetch-media`** (needs internet; part of `npm run setup`) downloads the show posters
  (`imageSourceUrl` in `shows.json`, saved as its `imageFile`) and album covers (`artworkUrl` in
  `media.json`, saved as its `artworkFile`) into `server/media/shows/` and `server/media/art/`. It
  follows the same rules as the website's own image downloads (https only, `upload.wikimedia.org` or
  `*.mzstatic.com`, a real JPEG/PNG/WebP/GIF, 5 MB at most), goes two at a time with a pause between
  requests, retries politely, and skips images that are already there. If a site doesn't answer at
  all three times in a row (you're offline, or it's down), the rest of its images are skipped, so an
  offline run takes seconds. Options: `--force` (download
  everything again), `--dry-run` (just list what's missing), `--strict` (exit with an error if
  anything couldn't be downloaded — by default it only warns, so an offline setup still works),
  `--media-dir <dir>`, `--seed-dir <dir>`.
- **`npm run enrich`** (needs internet) finds 30-second previews and album art for spreadsheet songs
  that don't have one yet, and records them in `media.json` (with each cover's `artworkUrl`, so
  `fetch-media` can download it on another computer). Matching is careful: it prefers the
  show's cast recording and rejects karaoke, covers and instrumentals, because wrong audio is worse
  than none. Useful options: `--dry-run` (just show what it would do), `--show <name>`,
  `--song <id>`, `--shows` (also fetch missing show posters from Wikipedia), `--community`
  (also fill songs users added). Songs marked "verified" in `media.json` are never changed.
- **Spreadsheet export:** the "Download the list (.xlsx)" link (`/api/export.xlsx`) gives an Excel
  file with separate **Solos** and **Duets** sheets (headers in row 1, the original column names),
  plus an **Added by** column (Spreadsheet or Community). It's for reading and sharing; it can't be
  imported back (use the original spreadsheet layout for that).

### Catalog data (shows & songs to pick from)

When students add a song they first **pick it from a catalog** of stage musicals and their song
lists ("Find your song" on the Add page). The form is then filled in for them — title, solo or
duet, the characters and their voice types, genre, mood and mature flag — and every suggestion says
where it came from ("from the Wikipedia song list", "from 3 other Les Misérables songs on the site")
and how sure it is. They can change anything.

- **What's in it:** every stage musical with an English Wikipedia article (not film/TV musicals),
  with its composer, lyricist, book writer, year and genres, its characters (and voice types where
  Wikipedia gives them), and its song list with who sings each song, acts, reprises and
  instrumentals.
- **Where it lives:** `server/seed/catalog/catalog.json.gz`, with `server/seed/catalog/README.md`
  (sources, build date, counts) and `stats.json`. Maintainers rebuild it with `npm run catalog:build`
  (needs the internet; the tool in `tools/catalog/` has its own packages, so the website's aren't
  affected; see `tools/catalog/README.md`). The build caches every Wikipedia/Wikidata answer, gives
  identical output for identical sources, and never issues a version number twice for different
  content (`tools/catalog/versions.json`). Before it replaces the file it writes a **readable diff**
  of what changed (`tools/catalog/.cache/diff-<version>.txt` — review it before committing, since the
  `.gz` can't be diffed) and **stops if anything new looks like vandalism** (swearing or slurs added
  to a song list, links, keyboard mashing, a song list that was blanked …), with a link to the exact
  Wikipedia revision it read; `-- --accept-review` builds anyway once you've checked.
- **Sources and licences:**
  - Song lists, who sings what, characters and voice types come from **English Wikipedia**
    (<https://en.wikipedia.org>), licensed **CC BY-SA 4.0**
    (<https://creativecommons.org/licenses/by-sa/4.0/>). The catalog file is a derived database, so
    it is shared under the same licence: if you reuse it, credit Wikipedia's contributors and keep
    the licence. Every show in it keeps its article title (`wikiTitle`), which is how each list links
    back to its source. The site shows "Song list from Wikipedia (CC BY-SA)", linking to the show's
    article, wherever it shows a catalog song list; lists loaded from a cast album say "Track list
    from Apple Music" instead.
  - Show facts (which works are stage musicals, alternative titles, credits when the article has
    none, years, genres, the short description) come from **Wikidata** (<https://www.wikidata.org>),
    **CC0** (no conditions).
  - The code stays MIT. See [Third-party content](#third-party-content).
- **It loads itself on deploy:** at startup the server compares the file with the one it loaded
  last (its contents, not just its `version` — a rebuild that reused a version number still counts).
  If it changed (or nothing is loaded yet) it loads the file in one transaction — about 3 seconds
  for 100,000 songs — before it starts answering. So updating the catalog on a server is: put the
  new file there and restart. An unchanged file costs a few milliseconds.
- **A bad file can't wipe it:** a file with less than half the shows or songs that are loaded (a
  broken build, a truncated file, the small test catalog pointed at a real database), one where
  many shows have no key or title, one with no shows, or one that is implausibly big (over 50 MB, or
  over 256 MB unpacked) is refused with a warning, and the loaded catalog stays.
  `catalog:load -- --force` accepts a smaller file on purpose.
- **It never touches the community's data:** songs, shows, accounts and comments are left as they
  are. Only the site's links to the catalog are refreshed: a site show/song is linked to the catalog
  entry with the same title (ignoring accents, case, punctuation, a leading "The" and "(Reprise)";
  "(Reprise 2)" only matches "(Reprise 2)"; "Dog Eats Dog" matches "The Sewers/Dog Eats Dog").
  When several catalog shows share a name ("Parade" 1960 and 1998, "The Phantom of the Opera"),
  the year, composer and the site show's own songs decide — if they can't, the show isn't linked
  automatically. A link someone chose (picking a catalog song on the form as the show's owner, or
  an admin's pick) is kept, and so is "not from the catalog". Catalog entries keep their ids from
  one version to the next; a show that leaves the catalog but still has site data (songs saved from
  its cast album, a chosen link) is kept, hidden from search, instead of deleted.
- **Cast albums:** a show whose Wikipedia article has no song list can offer "Load songs from the
  cast album": the server finds the show's cast recording on Apple Music (the same careful album
  rules as `npm run enrich`; an album that belongs to another show of the same name is refused, and
  so are explicit albums and tracks) and saves up to 60 of its track names in the catalog for
  everyone. Saving needs a logged-in user (`POST /api/catalog/shows/:id/recording-tracks`) and is
  logged with who did it; anyone else only gets a preview. Show pages only check whether an album
  exists (CA store, answer kept for a week) and never save one.
  - **What gets stored** (in `star.db`, not in the catalog file): each track name as a catalog song
    of that show (the title with "(Original Broadway Cast Recording)"-style notes removed, its
    position, and reprise/instrumental guessed from the name — no singers, since track lists don't
    say), the album's Apple id and name, and — for admins only, never shown publicly — which account
    saved it and when. No audio, artwork or other Apple data is stored; previews still stream from
    Apple. The answer to "does Apple have a cast album?" is kept too (for a week), so show pages
    don't ask Apple again for every visitor. Separately, when a logged-in student opens the recording
    picker for a song and Apple clearly has the show's **original** cast album, that album is
    remembered for the show so later lookups start from it.
  - The songs and albums saved are kept when a new catalog version is loaded — until the show gets a
    Wikipedia song list, which replaces them.
  - **Admins** check them in **Admin → Cast albums** (which album, how many songs, who saved it and
    when) and can remove a show's saved album and songs there — the removed album is never picked for
    that show again, unless they tick "let it be found again". The same from the API
    (`GET /api/admin/catalog/recordings`, `DELETE /api/admin/catalog/shows/:id/recording[?reject=0]`)
    or the shell: `npm --prefix server run catalog:clear-recording -- <show id or key>`
    (`-- --list` lists them).
- **Fixing a wrong link:** the **Edit show** window has a "Song catalog" field: keep the link, match
  it by name again, mark the show as "not in the catalog" (never linked automatically — e.g. a
  student's own show that shares a famous show's name), or link it to another catalog show (admins:
  any show; the show's owner: one with the same name).
- **Missing or broken file:** the server logs a warning and keeps going (with the catalog it already
  had, or with an empty "Find your song" search on a brand-new install).
- **Loading by hand:** `npm --prefix server run catalog:load` reloads the catalog now, even if the
  file is the same (`-- path/to/catalog.json.gz` for another file, `-- --if-changed` to only load
  a changed file, `-- --force` to accept a file with far fewer shows or songs). It's safe while the
  server runs: website changes wait a few seconds meanwhile.
- **Apple Music:** all the site's calls to Apple share one budget (`STAR_APPLE_LIMIT`, 20 a minute),
  so busy days can't get the server blocked by Apple; past it, lookups say "busy, try again in a
  minute".

### Festivals (choosing a location)

The site isn't tied to one city: every visitor chooses their festival (📍 in the header — in the ☰
menu on phones — or on the Home, STAR Prep and My stuff pages). Until they do, Home asks "Where are
you performing?" instead of showing a countdown. The list is the **festivals** table, which starts from
`server/seed/festivals.json` — the 2026–27 BC regionals from
<https://taeacanada.ca/regional-star-fest/>, the Online Regional (entries close February 28,
2027) and STAR Fest West, the national festival (May 20–23, 2027 at UBC). Only regional and online
festivals can be chosen; national ones are shown as "what comes after regionals". Festival leaders'
contact details are deliberately not stored.

- **Admin → Festivals** (admins only): add a festival, edit its dates, venue, city, link or date
  note (e.g. "Date to be announced"), **hide/show** it, or delete it. Dates are real calendar days,
  and an end date (a multi-day festival, or the Online Regional's entry deadline) can't be before
  the start date. The site lists festivals in date order ("to be announced" last); the "sort order"
  number only breaks ties. National festivals have a "Listed" switch instead of "In pickers" (they
  are never pickable, so they have no share link).
  - Hiding a festival takes it out of every list; students who chose it are asked "Where are you
    performing?" again, but their account keeps the choice and gets it back if the festival is shown
    again (unless they pick another one in the meantime). Deleting it clears their choice for good,
    and the site remembers the deletion: `npm run import` and the first-start fill don't bring it back
    (unless `--overwrite-edits`, or an admin adds a festival with the same name again).
  - Each festival gets a **link name** from its name when it's added ("Kelowna Regional STAR Fest"
    → `kelowna`). It never changes afterwards, even if the festival is renamed, so shared links keep
    working. Adding a festival whose link name is already taken is refused — choose a different name.
- **Links for a class:** `https://<your site>/?festival=<link name>` (e.g. `/?festival=surrey`)
  opens the site with that festival already chosen (on any page — the `festival` part is then
  removed from the address bar, and an unknown or national link name just shows a polite note). Once
  a festival is chosen, STAR Prep shows its link with a **"Copy a link for this festival"** button;
  Admin → Festivals shows each festival's link too.
- **Upgrading an existing site:** the first start after the update fills the empty festivals table
  from `festivals.json` by itself — no re-import needed. (Festivals an admin deleted are skipped, so
  deleting every festival leaves the list empty; `--reset` or `--overwrite-edits` brings them back.)
- **`npm run import`** also updates the festivals from `festivals.json`, matched by link name (the
  `slug` field). Festivals **added, changed or deleted on the website are kept that way** unless you
  add `--overwrite-edits` (which also restores deleted ones), and festivals that aren't in the file
  are never deleted. It prints how many were created, updated, unchanged, kept and not re-created
  (deleted on the website). `--reset` loads them again from the file.
- **`STAR_DEFAULT_FESTIVAL`** (optional) picks the festival for visitors who haven't chosen one yet —
  handy when the site is run for one school. A student's own choice always wins.

### Data corrections applied (please review)

The original spreadsheet is never edited. All fixes are listed in `server/seed/corrections.json`,
and each one has a source recorded under `_evidence` (the licensor's page, the cast album, the
published score or Wikipedia). Anything uncertain became a **note** on the song page, not a change.
To undo a correction, delete its line and run `npm run import`.

**Show names (7):** SPAMalot → *Monty Python's Spamalot* · Shrek → *Shrek The Musical* ·
Into The Woods → *Into the Woods* · A Gentlemans Guide… → *A Gentleman's Guide to Love and Murder* ·
Smash! → *Smash* · Les Miserables → *Les Misérables* · Mr. Burns → *Mr. Burns, a Post-Electric Play*

**Song titles (22):**
- **Capitals and punctuation:** Grow for Me, Feed Me (Git It), Suddenly, Seymour,
  Any Way the Wind Blows, Hey, Little Songbird, On the Steps of the Palace, When Love Is True,
  When We Are Kings, I Know Those Eyes / This Man Is Dead, Into the Fire, Who Am I?,
  Franklin Shepard, Inc., I Never Met a Wolf Who Didn't Love to Howl, Mr. & Mrs. Smith
- **Official or full titles:**
  - Diva's Lament → *Diva's Lament (What Ever Happened to My Part?)*
  - Prologue: What Have I Done → *What Have I Done?*
  - Dinghy → *Problematical Solution (The Dinghy Song)*
- **Spelling fixes:**
  - The Man With the Ginger Mustache → *Moustache*
  - Don't Say Yes Until I'm Finished Talking → *…Until I Finish Talking*
  - The Just Keep Moving the Line → *They Just…*
  - Don't Tell Mamma → *Don't Tell Mama*
  - Independantly Owned → *Independently Owned*

**Character names (20):**
- **Spelling:** Gallahad → Galahad · Patsey → Patsy · Seymore → Seymour · Euridice → Eurydice ·
  Pheobe → Phoebe · Dantés → Dantès · Geoffery → Geoffrey · Reqruiter → Recruiter ·
  Young Cossette → Young Cosette · Mr. Thenardier → Thénardier
- **Full or official names:** Lady of the lake → The Lady of the Lake · Farquaad → Lord Farquaad ·
  Little Red Riding Hood → Little Red Ridinghood · The Bakers Wife → The Baker's Wife ·
  The Prince → Cinderella's Prince · The Other Prince → Rapunzel's Prince ·
  Faria → Abbé Faria · Shirley → Colonel Gillweather · Manley-Prowe → Lady Manley-Prowe ·
  Carmen → Carmen Bernstein

**Songs re-attributed to the right character (5):**
- *When the World Was Mine* (Monte Cristo) → Mercédès (Alto). The spreadsheet had Dantès.
- *Pretty Lies* (Monte Cristo) → Valentine de Villefort (Soprano)
- *Where's the Girl* (Scarlet Pimpernel) → Chauvelin (Baritone)
- *I Believe* (Book of Mormon) → Elder Price (Tenor)
- *Baptize Me* (Book of Mormon) → Elder Cunningham (Tenor) & Nabulungi (Alto)

**Moods and voice types:** "Tongue & Cheek" → *Tongue-in-Cheek*,
"Intimidating/angry" → *Intimidating / Angry*, "Mezzo" → *Mezzo-soprano*.

**Notes shown on song pages (33):** these flag things a student should check with their teacher:
- **Songs that aren't really solos or duets**, and whose other singers' lines need cutting:
  Who I'd Be, Any Way the Wind Blows, Inside Out, That Horrible Woman, Into the Fire,
  Thinking of Him, Show People, Corn.
- **Smash songs:** all seven were written for the TV series and later used in the 2025 Broadway
  musical, which isn't released for licensing yet.
- **Mr. Burns:** it's a play with music, not a musical.
- **Oh What a Lovely War:** the songs are real WWI-era songs, not written for the show.
- **Version differences:**
  - Only Love has been replaced in the licensed Scarlet Pimpernel, and Little People is much shorter
    in today's licensed Les Mis.
  - Mein Herr, Maybe This Time and I Don't Care Much are only in some versions of Cabaret.
  - In Married (1998 Cabaret), a verse is sung in German.
- **Alternate titles and credits:** The Legal Heir, The Dinghy Song, The Man With the Ginger Moustache,
  and I Miss the Music (John Kander wrote the lyric too).
- **Vocal ranges to double-check in the score:** Someday (Esmeralda), When the World Was Mine,
  and I Know Those Eyes (Dantès).
- **Over the 6:00 limit** (needs a cut): Corn.
- **The preview is a different number:** on the studio cast album, Out There (Hunchback) starts with
  Frollo's "Sanctuary", so the 30-second preview is Frollo, not Quasimodo — play the full track to
  hear the solo.

`shows.json` also records composer, lyricist, book writer, year, licensor and a licensing note for
each of the 21 shows. Examples:
- Hadestown: only the Teen Edition can be licensed.
- TRW shows (Spamalot, Curtains) need a free festival licence request.
- Cabaret: three licensed versions.
- Mr. Burns: a play with music.
- Not yet released for licensing: Smash, Shucked and The Book of Mormon.

The Count of Monte Cristo, Smash, Shucked and The Book of Mormon have no licensor listed, so the site
tells students to check with their teacher.

### Media credits

- **30-second previews** are streamed directly from Apple Music (the iTunes Search API) and never
  stored or re-hosted. Every preview is labelled "Preview courtesy of Apple Music" and links to the
  recording. Album art for spreadsheet songs is downloaded from Apple into `server/media/art/` by
  `npm run fetch-media` (it isn't in the repository); art for songs added on the website is kept
  with the uploads. **All 122 matches have been independently verified by a
  person** (marked "verified" in `media.json`, so `npm run enrich` never changes them). One was
  replaced after that check: *Grow for Me* (Little Shop) now plays the main New Cast Album track
  instead of a bonus-track version by a different singer.
- **Show posters** come from Wikipedia and are used under fair use for identification. Each show
  page shows the image credit and links to the source. Posters of the spreadsheet shows are
  downloaded from Wikipedia into `server/media/shows/` by `npm run fetch-media` (they aren't in the
  repository); posters for shows added on the website are kept with the uploads.
- Show descriptions are written in our own words. The song list comes from the STAR spreadsheet.
  See [Third-party content](#third-party-content) for who owns what.
- Users may upload practice audio (MP3/M4A/AAC/WAV/AIFF/OGG, up to 25 MB), show posters and
  **album art for their songs** (JPEG, PNG, WebP or GIF, up to 5 MB, at most 8192 pixels on a side
  and 25 megapixels; animations at most 300 frames). The server checks that a file really is audio
  or an image (the bytes decide, not the file name; SVG is never accepted) and removes hidden photo
  data from images: only the parts needed to draw the picture are kept, so GPS position, camera
  details, comments, "content credentials" (C2PA) and any other embedded data are gone. Uploaded album art
  is shown instead of the recording's cover; removing it brings the recording's cover back. Uploads
  count toward the owner's upload space and are deleted with the song. The forms ask them to only
  share files they're allowed to share.

---

## Deploying

- **Use HTTPS.** Put the app behind a reverse proxy (Caddy, nginx, a platform load balancer) that
  terminates TLS and forwards to `npm start`. Set **`TRUST_PROXY=true`** so login cookies are marked
  `Secure` and rate limits see real client IPs, and **`HOST=127.0.0.1`** so only the proxy can reach
  the Node port (or firewall port 3001). `true` trusts only a proxy on the same machine; if the proxy
  runs elsewhere (another container or host), set `TRUST_PROXY` to its address or subnet instead.
  Never let clients reach the Node port directly while `TRUST_PROXY` is set — they could fake their
  IP address and dodge the login rate limit (the server warns about this at startup).
- Make the first admin with `npm run make-admin` after the teacher has signed up (see
  [Making the first admin](#making-the-first-admin)).
- The server must be able to reach `itunes.apple.com` and `en.wikipedia.org` for the "find a
  preview", "fetch from Wikipedia" and "load songs from the cast album" buttons. Visitors' browsers
  stream previews from Apple.
- Shipping a new `server/seed/catalog/catalog.json.gz` is all it takes to update the song catalog:
  the next start loads it (see [Catalog data](#catalog-data-shows--songs-to-pick-from)).
- Process managers: the server exits with a non-zero code if it can't start (e.g. the port is
  taken), so `Restart=on-failure` works. On SIGTERM/SIGINT it lets running requests finish for up
  to `STAR_SHUTDOWN_GRACE_MS` (20 s; give your supervisor a longer stop timeout), then closes the
  database cleanly and exits 0 — or exits 1 if it had to cut requests off.
- If the database is busy (e.g. an import or a manual SQL session holds a lock), requests get a
  "try again in a few seconds" 503 instead of an error page.

### Upgrading a live site

1. **Back up first:** `npm run backup` (safe while the server runs — see [Backups](#backups)).
2. **Get the new version:** `git pull`.
3. **Install packages:** `npm install && npm --prefix server install && npm --prefix client install`.
   (`npm run setup` does this too, plus `fetch-media` and `import`, which are safe to run on a live
   database — they never change what students added — but aren't needed just to upgrade.)
4. **Build the website:** `npm run build`.
5. **Restart the server** (your process manager, or stop `npm start` and start it again).

The first start after an upgrade does the rest by itself, before it answers any request:

- **Database migrations** run automatically and only add tables and columns — nothing students
  added is rewritten. This release adds **migration v5** (the song catalog tables, the site's links to
  the catalog, uploaded album art) and **v6** (where each catalog link came from, cast albums saved
  from Apple and who saved them, rejected albums).
- **The song catalog loads** from `server/seed/catalog/catalog.json.gz` (a few seconds; it then
  links existing site shows and songs to it by title), and again whenever a later release ships a
  changed file. See [Catalog data](#catalog-data-shows--songs-to-pick-from).
- Festivals are filled in if the table is empty (see [Festivals](#festivals-choosing-a-location)).

If something goes wrong, stop the server and restore the backup (below) together with the previous
code (`git checkout <previous tag or commit>`, then install and build again). An older version
ignores the added tables and columns, but a database that a newer version has migrated can't be
"un-migrated" — restoring the backup is the clean way back.

### Backups

`server/seed/` is part of the project, so keep it in version control. `server/media/` only holds the
downloaded posters and album art, so it doesn't need a backup (`npm run fetch-media` gets them
again). Everything else that matters is created on the website:

- `server/data/star.db`: accounts, community songs and comments.
- `server/uploads/`: uploaded audio, posters and album art, and the album art and posters fetched
  from Apple/Wikipedia for songs and shows added on the website.

The song catalog comes from `server/seed/catalog/`, so it doesn't need a backup of its own (the
cast-album track lists found on the website are in `star.db`).

Back both up regularly, e.g. nightly with **`npm run backup`** (or `npm run backup -- /path/to/dir`).
It's safe while the server is running: it makes a consistent copy of the database (no `sqlite3`
tool needed) and copies the uploads, into `backups/star-<date>/`.

**To restore:**

1. Stop the server.
2. **Delete `server/data/star.db-wal` and `server/data/star.db-shm`** if they exist. (Otherwise
   SQLite replays those leftover changes on top of the restored database — undoing the restore or
   corrupting it.)
3. Copy the backup's `star.db` to `server/data/star.db`, and replace `server/uploads/` with its
   `uploads/` folder.
4. Start the server.

Files that no song or show uses any more (left behind by older versions) can be listed with
`npm --prefix server run clean-uploads`, and removed with `… -- --delete`.

---

## For developers

| | |
|---|---|
| Frontend | `client/`: React 19, TypeScript (strict), Vite, React Router, plain CSS with custom properties, `lucide-react` icons. See `client/README.md` |
| Backend | `server/`: Node 22.12+, Express 5 (ESM JavaScript), `better-sqlite3`, `exceljs`, `multer`, `helmet`, `express-rate-limit` |
| Contract | `SPEC.md`: schema, API and page list |

```bash
npm test          # server tests (node --test + supertest) and client tests (vitest)
npm run e2e       # Playwright end-to-end tests (builds the client and runs a production server)
npm --prefix client run typecheck
npm --prefix tools/catalog test   # the catalog builder's parser tests (offline, own packages)
```

**End-to-end tests** (`playwright.config.ts`, `e2e/*.spec.ts`):
- `npm run e2e` builds the client, imports a **fresh database from the committed seed files** into
  `test-results/e2e.db` (your own database isn't read, so local edits can't affect the tests), and
  starts a production server on port **3501** (`E2E_PORT`) with its own uploads/media folders
  (`E2E_DATA_DIR` moves them). The admin account (`admin@test.local`) signs up and is promoted with
  `make-admin`. Your real database and uploads are never touched.
- The media folder is a copy of whatever `server/media/` holds. The suite passes without the
  downloaded posters and album art too (gradient placeholders); `E2E_MEDIA_SRC=<an empty folder>
  npm run e2e` checks that.
- **Before your first run**, download the browser the tests use (once per machine, needs the
  network): `npx playwright install chromium` from the repository root. On Linux, `npx playwright
  install --with-deps chromium` also installs the system libraries Chromium needs (it asks for
  `sudo`). Without it, `npm run e2e` stops with "Executable doesn't exist … Please run: npx
  playwright install". The browser build matches the pinned `@playwright/test` version (1.63.0), so
  run the command again after that version changes.
- Apple Music and Wikipedia lookups are mocked, and audio playback is stubbed, so once the browser
  is installed the suite runs offline. The e2e server loads the small fixture catalog
  (`server/test/fixtures/catalog.json.gz`, via `STAR_CATALOG_PATH`) instead of the full one.
- `/add` opens "Find your song" (the catalog search); specs that type a song in by hand start at
  `/add?manual=1` (e.g. `/add?manual=1&show=hadestown&kind=duet`).
- Tests that compare the page with live song counts run first (project `read-only`). The tests that
  sign up, add songs and comment run after them (project `accounts-and-writes`).
- Festivals: `e2e/festivals.spec.ts` (read-only: the "Where are you performing?" chips, header and
  mobile-menu pickers, `?festival=` links, STAR Prep, and every countdown state — upcoming, today,
  over + nationals, to be announced, online — with the browser clock pinned) and
  `e2e/festival-accounts.spec.ts` (the choice saved to the account and restored in a new browser,
  signup/login and temporary-password hand-overs, and Admin → Festivals add / edit / hide / show /
  delete, on a festival the test creates). The e2e server runs **without** `STAR_DEFAULT_FESTIVAL` (the first visit must show
  the chips); a site default is simulated in the browser, and the server side of it is covered by
  `server/test/festivals.test.js`.
- Run `npm run setup` once first (it installs the packages).

Useful scripts: `npm run import -- --reset`, `npm run fetch-media -- --dry-run`, `npm run enrich -- --dry-run`,
`npm run make-admin -- someone@example.com`, `npm run backup`,
`npm --prefix server run clean-uploads`, `npm --prefix server run catalog:load`,
`npm --prefix server run catalog:clear-recording -- --list`.

Server tests use a small catalog in the real format, `server/test/fixtures/catalog.json.gz` (its
readable source `catalog.json` sits next to it — regenerate the `.gz` with
`gzip -9 -n -c catalog.json > catalog.json.gz` after editing, a test checks they match). Point a dev
server at it with `STAR_CATALOG_PATH=server/test/fixtures/catalog.json.gz` to skip the full catalog.

---

## Contributing

Issues and pull requests are welcome on GitHub: <https://github.com/jponline77/star_finder>. Before
you open a pull request, please run `npm test` and `npm run e2e` (both work offline; before your
first `npm run e2e`, run `npx playwright install chromium` once — see [For developers](#for-developers)).
Please keep changes friendly to the students who use the site. Song data fixes usually belong in
`server/seed/corrections.json` rather than in the spreadsheet.

## License

The code is released under the **MIT License** — see [`LICENSE`](LICENSE) (© 2026 jponline77). The
license doesn't cover the third-party content below.

## Third-party content

- **Show posters** are copyrighted artwork belonging to their owners. The site shows them under fair
  use for identification, the same way Wikipedia does, with a credit and a link to the source. They
  are downloaded from Wikipedia when you set the project up and are **not redistributed in this
  repository**.
- **Album art and the 30-second previews** are © their record labels / Apple. They come from Apple's
  iTunes Search API and are used under its terms: previews are streamed straight from Apple and
  labelled "Preview courtesy of Apple Music" with a link to the recording, and the album art is
  downloaded from Apple at setup (not stored in this repository).
- **Show descriptions** are original text written for this project.
- **The song list** comes from the owner's STAR spreadsheet (`server/seed/star_spreadsheet.xlsx`).
- **The show & song catalog** (`server/seed/catalog/`) is derived from English Wikipedia (song
  lists and characters, **CC BY-SA 4.0** — the derived data is shared under the same licence) and
  Wikidata (show facts, **CC0**). The site credits Wikipedia wherever it shows catalog song lists.
- **"STAR", "STAR Fest" and TAEA** are the names of TAEA and its festivals. This is an independent
  fan project; it is not affiliated with or endorsed by TAEA.
