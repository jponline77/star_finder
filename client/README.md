# STAR Song Finder — client

React 19 + TypeScript (strict) + Vite 7 + React Router 7 (`react-router` package, data router).
Plain CSS with custom properties, `lucide-react` icons, fonts bundled via Fontsource
(**Limelight** = marquee display face, **Nunito Variable** = body). No UI kit, no chart library.

```bash
npm install             # (npm ≥ 10 with the committed lockfile)
npm run dev             # Vite on :${VITE_PORT:-5173}, proxies /api /media /uploads → $VITE_API_TARGET || http://localhost:${PORT:-3001}
VITE_API_TARGET=http://localhost:3101 npx vite --port 5273   # point at another API
PORT=4000 VITE_PORT=5600 npm run dev   # (repo root) server on 4000; the proxy follows PORT automatically
npm run build           # tsc -b && vite build → dist/ (served by Express in production)
npm test                # vitest run (unit + component tests, jsdom)
npm run typecheck       # tsc -b
```

`@playwright/test@1.63.0` is a devDependency of the repository root (the e2e suite lives in `../e2e`).
Its browser is a separate download: run `npx playwright install chromium` from the repository root
once before the first `npm run e2e` (see the root README, "For developers").

---

## Folder map

```
client/
  index.html                 # sets data-theme before first paint (no flash)
  vite.config.ts             # proxy + vitest config (jsdom, src/test/setup.ts)
  src/
    main.tsx                 # fonts + global CSS imports, initTheme(), <App/>
    App.tsx                  # router + providers (DON'T EDIT from page agents)
    api.ts                   # typed fetch wrapper — one function per endpoint
    types.ts                 # API types (SPEC §5)
    lib/                     # pure helpers (+ *.test.ts)
    hooks/                   # generic hooks
    state/                   # providers: Toast, Auth, Songs, Festival, Audio + RequireAuth
    components/              # shared UI (+ __tests__/)
    pages/                   # ONE FILE PER ROUTE (default export) + optional <Page>.css
    styles/                  # tokens.css base.css components.css song.css comments.css layout.css festival.css
    test/                    # setup.ts, fixtures.ts (makeSong, makeFestivals…), render.tsx (renderWithProviders)
```

## Routes (src/App.tsx)

| Path | File | Notes |
|---|---|---|
| `/` | `pages/HomePage.tsx` | done |
| `/songs` | `pages/BrowsePage.tsx` | done |
| `/songs/:id` | `pages/SongDetailPage.tsx` | done, remounted per `:id` |
| `/songs/:id/edit` | `pages/SongFormPage.tsx` | done, `RequireAuth`, remounted per `:id` |
| `/add` | `pages/SongFormPage.tsx` | done, `RequireAuth` (same file as edit; `useParams().id` is undefined here) |
| `/shows` | `pages/ShowsPage.tsx` | done |
| `/shows/:slug` | `pages/ShowDetailPage.tsx` | done, remounted per `:slug` |
| `/match` `/spin` `/setlist` `/star-prep` `/stats` | `MatchPage` `SpinPage` `SetlistPage` `StarPrepPage` `StatsPage` | done |
| `/me` | `pages/MePage.tsx` | done, `RequireAuth` |
| `/admin` | `pages/AdminPage.tsx` | done, `RequireAuth` (admin check INSIDE the page); tabs Users / Comments / Festivals (`?tab=festivals`, `admin/FestivalsPanel.tsx`) |
| `/login` `/signup` | `LoginPage` `SignupPage` (+ `BackstagePass.tsx`, `AuthPages.css`) | done |
| `*` | `pages/NotFoundPage.tsx` | done |

Non-core pages are `React.lazy` loaded; `Layout` wraps `<Outlet/>` in `<Suspense>` with a skeleton.
Route errors render `components/RouteError.tsx` inside the layout.

## Conventions for page agents

1. **Replace your placeholder file wholesale**; keep a **default export**. Don't touch `App.tsx`,
   shared components or global CSS (propose changes instead). Page-specific CSS: `pages/<Page>.css`
   imported by the page, classes prefixed with the page name (`.song-detail-…`).
2. Wrap content in `<div className="container">` (or `container-narrow`); `Layout` already
   provides `<main id="main" class="page">`, header, footer, mini player, toasts.
3. Start with `useDocumentTitle('Page name')`. One `<h1>` per page (`className="page-title"`
   for the display font) — see `.page-header` / `.eyebrow` / `.page-subtitle`.
4. Data: use `useSongs()`/`useSong()`/`useShow()`/`useShows()`/`useMeta()` (cached) or
   `useApiData((signal) => apiFn(signal), deps)` for anything else. Never call `fetch` directly.
5. Writes: call the `api.ts` function, catch `ApiError` (`e.status`, `e.message`, `e.field('title')`,
   `e.details.existingId`), show `toast.error(e)` or inline errors. A 401 on a write automatically
   redirects to `/login?next=<here>`. After creating/editing/deleting a song call
   `upsertSong(song)` / `removeSong(id)` (or `reload()` if meta/shows changed).
6. Permissions: `canEdit(user, item)` (admin or creator), `canEditComment`, `isAdmin` from
   `lib/permissions`, or just render `<OwnerControls>` which hides itself.
7. `data-testid`s: keep the SPEC ones (`search-input`, `song-card`, `result-count`,
   `filter-kind-solo|duet`, `filter-range-<Range>`, `song-title`, `play-preview`, `add-song-form`,
   `submit-song`). Pattern for new ones: kebab-case `<thing>` or `<thing>-<action>`.
8. Accessibility: real `<button>`/`<a>`, labels on every input (`Field` helper), no colour-only
   meaning, respect reduced motion (global CSS already neuters animations), keep 44px targets.
9. Mobile first; nothing may cause horizontal scroll at 360px. Wide tables go in `.table-wrap`.
10. Tests: `src/pages/__tests__/<Page>.test.tsx` with `renderWithProviders` + fixtures.

---

## API (`src/api.ts`)

Every call: `credentials: 'same-origin'`; non-GET adds `X-Requested-With: star-song-finder`;
objects → JSON (`Content-Type: application/json`, POST/PUT/PATCH without a body send `{}`);
`FormData` → multipart. Errors throw `ApiError { status, message, details: Record<string,string>, code? }`
(`status 0` = network). Helpers: `isApiError(e)`, `errorMessage(e)`, `request/get/post/put/patch/del`,
`upload(path, file, {onProgress, signal, field})`, `buildQuery`, `setUnauthorizedHandler` (session
ended → AuthProvider redirects to /login), `setPasswordChangeHandler` (403 `code: 'MUST_CHANGE_PASSWORD'`
→ AuthProvider sends the user to /me). `GET /api/songs` answers at most 5,000 songs per request;
`SongsProvider` pages through `total`. `lib/chunkReload.ts` reloads once when a lazy page chunk from
an older deploy is gone (`vite:preloadError`).

| Function | Endpoint → result |
|---|---|
| `getHealth()` | GET /api/health |
| `getMeta(signal?)` | GET /api/meta → `Meta` (incl. `festivals`, `defaultFestivalSlug`) |
| `getFestivals(signal?, {all?})` | GET /api/festivals(?all=1) → `{ festivals }` (prefer `useFestival()`) |
| `getStats(signal?)` | GET /api/stats → `Stats` |
| `EXPORT_XLSX_URL` | `/api/export.xlsx` (use `<a href download>`) |
| `listSongs(query?: SongQuery, signal?)` | GET /api/songs → `{ songs, total }` |
| `getSong(id, signal?)` | GET /api/songs/:id → `SongDetail` (`Song & { similar }`) |
| `createSong(input: SongInput)` | POST /api/songs → `Song` (409 → `details.existingId`) |
| `updateSong(id, input)` | PUT /api/songs/:id → `Song` |
| `deleteSong(id)` | DELETE → void |
| `uploadSongAudio(id, file, {onProgress?})` | POST /api/songs/:id/audio (multipart `file`) → `Song` |
| `deleteSongAudio(id)` | DELETE /api/songs/:id/audio → `Song` |
| `listShows(signal?)` | GET /api/shows → `{ shows }` |
| `getShow(idOrSlug, signal?)` | GET /api/shows/:idOrSlug → `ShowDetail` |
| `createShow(input: ShowInput)` / `updateShow(id, input)` / `deleteShow(id)` | POST / PUT / DELETE |
| `uploadShowImage(id, file, opts?)` | POST /api/shows/:id/image → `Show` |
| `lookupItunes(title, show, signal?)` | GET /api/lookup/itunes → `{ candidates: ItunesCandidate[] }` |
| `lookupWikipedia(name, signal?)` | GET /api/lookup/wikipedia → `WikipediaLookupResult` |
| `signup(input)` / `login(input)` / `logout()` / `getMe()` / `updateMe(input)` | /api/auth/* (prefer `useAuth()`; `updateMe({ festivalSlug })` sets/clears the festival, `signup` may carry `festivalSlug`) |
| `listComments(target, signal?)` / `postComment(target, {body, tag})` | GET/POST …/comments (`target = {type:'song'|'show', id}`) |
| `listSongComments(id)` `listShowComments(idOrSlug)` `postSongComment` `postShowComment` | shorthands |
| `updateComment(id, {body?, tag?})` / `deleteComment(id)` | PATCH / DELETE /api/comments/:id |
| `getContributions(signal?)` | GET /api/me/contributions → `{ songs, shows, comments }` |
| `adminListUsers()` / `adminUpdateUser(id, {role?, disabled?})` / `adminResetPassword(id)` / `adminListComments(limit=100)` | /api/admin/* |
| `adminListFestivals()` / `adminCreateFestival(input)` / `adminUpdateFestival(id, patch)` / `adminDeleteFestival(id)` | GET /api/festivals?all=1 · POST/PUT/DELETE /api/admin/festivals (400 `details` per field, 409 name clash) |

Types (`src/types.ts`): `Kind, Source, Role, VocalRange, SongPart, ShowRef, SongMedia, CreatedBy,
Song, SongDetail, User, Comment, CommentTag, CommentTarget, CommentTargetType, CommentAuthor,
ShowCharacter, Show, ShowDetail, Meta, MetaShow, SubGenreMeta, Festival, FestivalKind, FestivalInput,
FestivalPatch, Stats, StatBucket,
ItunesCandidate, ItunesLookupResult, WikipediaLookupResult, SongInput, SongPartInput,
SongPreviewInput, ShowInput, SongQuery, SongSort, SignupInput, LoginInput, ProfileUpdateInput,
CommentInput, CommentPatch, Contributions, AdminUser, AdminUserPatch, ApiErrorBody`.

---

## Providers & hooks

Order: `Router → ToastProvider → AuthProvider → SongsProvider → FestivalProvider → AudioProvider → Layout`.

- **`useAuth()`** → `{ user: User|null, loading, isAdmin, login(email, pw): Promise<User>, signup({email,password,displayName}): Promise<User>, logout(), refresh(): Promise<User|null>, updateProfile({displayName?, currentPassword?, newPassword?}): Promise<User> }`.
  `user.mustChangePassword` → Layout shows a banner linking to `/me`; LoginPage routes to `/me`.
- **`<RequireAuth>`** (state/RequireAuth) — redirects to `/login?next=…`. Also
  `useLoginRedirect()` → `(next?) => void`, `useCurrentPath()`.
- **`useFestival()`** (state/FestivalProvider, SPEC §7b) → `{ festivals, regionalChoices, nationals, selected: Festival|null, source: 'url'|'account'|'local'|'default'|'none', setFestival(slug|null): Promise<boolean>, ready, loadError, retryLoad(), saving, refreshFestivals() }`
  (`loadError`: neither /api/meta nor GET /api/festivals could be loaded — show an error with `retryLoad()` instead of a skeleton).
  Festivals come from `meta.festivals` (active only; `refreshFestivals()` re-fetches GET /api/festivals, e.g. after
  an admin edit). Selection on load: `?festival=<slug>` (applied once, saved, then removed from the URL with
  `replace`, other params + hash kept; unknown slugs → a friendly toast) → the user's `festivalSlug` → localStorage
  `star.festival` → `meta.defaultFestivalSlug` → none. Only active regional/online festivals are choosable.
  `setFestival` writes localStorage at once and, when logged in, `PUT /api/auth/me { festivalSlug }` (optimistic,
  saves queued in order and compared with the last value queued, so A→B→A saves A again and the last choice
  wins; on failure the choice + storage roll back and a toast explains; a 401/403 MUST_CHANGE_PASSWORD keeps it on
  this device). Login/signup adopt the account's festival, or save this browser's choice to an account that has
  none (never the site default); no account writes while `mustChangePassword` — a choice made then (or one whose
  save found the session ended) is saved to that same account once it can be, instead of the account's old one.
  `useAuth().updateProfile` ignores an answer that arrives after a logout / another login.
  Logout keeps the choice on the device. SignupPage sends the device's choice as `festivalSlug` (retried without it
  if the server no longer offers that festival). When the list changes while nothing is chosen (e.g. an admin shows
  a hidden festival again), the account's / this device's festival is picked up without a reload.
- **`useSongs()`** → `{ songs, songsById, meta, loading, error, reload(), upsertSong(song), removeSong(id), patchSong(id, partial), getSong(id), shows, showsLoading, showsError, loadShows(force?) }`.
- **`useSong(id)`** → `{ song (cached instantly, then detail), similar, loading, refreshing, error, notFound, reload(), setSong(song) }`.
- **`useShow(slugOrId)`** → `{ show: ShowDetail|null, summary, loading, error, notFound, reload(), setShow }`.
- **`useShows()`** → `{ shows, loading, error, reload() }` (cached). **`useMeta()`** → `{ meta, loading, error }`.
- **`useToast()`** → `{ show(msg, opts), success(msg, opts), info, warning, error(msgOrError, opts), dismiss(id) }`;
  opts `{ title?, duration? (0 = sticky), action?: {label, onClick}, id? (replace), emoji? }`.
- **`useAudio()`** → `{ current: AudioTrack|null, status, playing, play(songOrTrack, source?), toggle(item?), pause(), resume(), stop(), seek(s), isCurrent(item|key), isPlaying(item|key), canPlay(song) }`.
  `songTrack(song, 'auto'|'preview'|'upload')` builds an `AudioTrack {key, src, title, subtitle?, artworkUrl?, artworkSeed?, songId?, credit?}`;
  for iTunes candidates build `{ key: \`itunes:${c.trackId}\`, src: c.previewUrl, title: c.trackName, subtitle: c.collectionName, artworkUrl: c.artworkUrl, credit: APPLE_PREVIEW_CREDIT }`.
  `useAudioProgress()` → `{ currentTime, duration }`.
- **`useSetlist()`** (lib/setlist) → `{ ids, count, has, add, remove, toggle, move(from,to), clear, replace(ids), import(ids|'1,2', 'merge'|'replace') }`.
- **`useTheme()`** (lib/theme) → `{ theme, setTheme, toggle }`.
- hooks/: `useApiData(fetcher, deps, {enabled?})` → `{ data, loading, error, reload, setData }`;
  `useDocumentTitle(title)`; `useMediaQuery(q)`, `useIsDesktop()` (≥900px), `usePrefersReducedMotion()`,
  `prefersReducedMotion()`; `useDebouncedValue(v, ms)`; `useClickOutside(ref, fn, active)`;
  `useUrlFilters()` → `{ filters, setFilters(next, {replace?, debounce?}) }` (instant local state + URL sync);
  `useLocalDay()` → a `Date` refreshed just after every local midnight (and on returning to the tab) — pass it as
  `now` to `festivalPhaseOf` / `festivalStatus` so heroes and cards change phase together with `<Countdown>`.

## Shared components (`src/components/`)

| Component | Props |
|---|---|
| `SongCard` | `{ song, query?, headingLevel?: 2|3|4, hideKind?, hideShow?, className? }` — testids `song-card`, `song-title`, `play-preview`, `setlist-heart` |
| `SongTable` | `{ songs, query?, sort?: {column, direction}|null, onSortChange?, caption? }` — `song-table`, `song-row`, `sort-<col>` |
| `RangeBadge` | `{ range, variant?: 'short'|'full', size?: 'md'|'lg' }` |
| `GenreTag` / `SubGenreTag` / `KindTag` | `{ genre | subGenre | kind, link? }` (link → filtered /songs) |
| `LengthBadge` | `{ seconds, showText?: 'auto'|'always'|'never' }` (green/amber/red + icon + text) |
| `TimeLimitBar` | `{ seconds, limit?, warn?, caption? }` (role=meter, `time-limit-bar`) |
| `MatureBadge` | `{ mature, variant?: 'full'|'compact' }` |
| `ArtworkTile` | `{ src?, seed, label?, size?, alt?, round? }` (gradient + initials fallback) |
| `ShowPoster` | `{ show: {name, imageUrl}, alt?, eager? }` (2:3, fallback poster) |
| `CharacterAvatar` / `UserAvatar` | `{ name, range?, size?: xs|sm|md|lg|xl }` / `{ name, size?, decorative? }` |
| `VoiceLadder` | `{ ranges, orientation?: 'vertical'|'horizontal', showLabels? }` |
| `PlayButton` | `{ song? | track?, source?, size?: sm|md|lg, label?, showUnavailable? }` (`play-preview`, `data-playing`) |
| `SetlistHeart` | `{ songId, songTitle?, withLabel?, toast? }` |
| `SearchBox` | `{ value, onChange, onSubmit?, placeholder?, label?, size?: 'md'|'lg', autoFocus?, shortcut? ("/"), testId? (default search-input) }` |
| `FilterPanel` | `{ filters, onChange(next, {replace?}), meta, songs, sections? }` + `KindSegmented {value, onChange}` |
| `ActiveFilterPills` | `{ filters, onChange, shows? }` (`filter-pill`, `clear-filters`) |
| `Highlight` | `{ text, query? }` |
| `EmptyState` / `ErrorState` | `{ emoji?, title, children?, actions?, level? }` / `{ title?, message?, onRetry? }` |
| `Skeleton`, `TextSkeleton`, `SongCardSkeleton`, `SongGridSkeleton`, `PageSkeleton` | sizes / `count` |
| `Marquee` | `{ children, size?: sm|md|lg, still?, as?, className?, innerClassName? }` |
| `Countdown` | `{ date: 'YYYY-MM-DD', label?, deadline?, hideSeconds?, compact? }` (`deadline`: counts to the END of `date`, then "Submissions closed") |
| `FestivalPicker` | `{ variant?: 'compact'|'select'|'inline', placeholder?, shortPlaceholder?, tone?: 'default'|'marquee', align?: 'start'|'center'|'end', label?, id?, allowClear?, announce?, onPicked?, testId? }` — compact = "📍 Surrey" / "📍 Choose your festival" chip + WAI-ARIA listbox popover (↑↓ Home End, Enter/Space, Esc, type-ahead, Tab → the "All festival dates" link, closes when focus leaves; groups "BC regional festivals" / "Online"; testIds `<testId>`, `<testId>-listbox`, `<testId>-more`, `festival-option-<slug>`); select = labelled native `<select>` with optgroups; inline = select + `FestivalSummary` (My Stuff) |
| `FestivalChips` / `FestivalSummary` | `{ labelledBy?, className? ('is-marquee' on the dark heroes), announce?, onPicked?, testId? }` one-tap `aria-pressed` chips (`festival-chip-<slug>`) / `{ festival }` name, date, venue, status, info link |
| `Confetti` / `fireConfetti(opts)` | `<Confetti fire={n} />` or imperative `fireConfetti({x?, y?, count?, duration?})` |
| `Modal` | `{ open, onClose, title, children?, footer?, wide?, closeOnBackdrop?, alert?, testId? }` (native `<dialog>`) |
| `ConfirmDialog` / `useConfirm()` | `{ open, title, children?, confirmLabel?, tone?: 'danger'|'primary', onConfirm (async ok), onCancel }` / `const {confirm, dialog} = useConfirm(); await confirm({title, message?, confirmLabel?})` (`confirm-dialog`, `confirm-button`) |
| `Drawer` | `{ open, onClose, title, children, footer?, side?: 'right'|'left', testId? }` |
| `Switch`, `SegmentedControl<T>`, `ToggleChip`, `Tabs<T>` + `TabPanel`, `Field` | in `Controls.tsx` (see JSDoc) |
| `PasswordInput` | input props (show/hide toggle) |
| `CopyButton` / `copyText(str)` | `{ text | () => text, label?, copiedLabel?, size?, testId? }` |
| `SlateBuilder` | `{ kind?, title?, show?, composer?, lyricist? }` (omit kind/title for the generic STAR Prep version) |
| `CommentsSection` | `{ target: {type:'song'|'show', id}, title?, onCountChange? }` — full Backstage Chatter (`comments-section`, `comment`, `comment-input`, `comment-tag-<tag>`, `comment-submit`, `comment-edit`, `comment-delete`, `comment-save`, `comment-login-prompt`) |
| `AddedBy` / `OwnerControls` | `{ item }` / `{ item, editTo? | onEdit?, onDelete?, noun?, confirmTitle?, confirmBody?, size? }` (`edit-button`, `delete-button`) |
| `RehearsalPlaceholder` | `{ title, emoji?, children? }` |
| Layout pieces | `Layout`, `Header` (`NAV_ITEMS`; festival chip `header-festival` in the bar from 640px — a 📍-only button at 1100–1279px where the desktop nav needs the room — and a festival `<select>` `mobile-festival` in the mobile menu), `Footer`, `MiniPlayer`, `AccountMenu`, `ThemeToggle`, `RouteError` |

## Pure helpers (`src/lib/`, all unit-tested)

- **normalize**: `fold`, `foldWithMap`, `normalizeText`, `tokenize`, `equalsLoose`, `includesLoose`, `slugify`, `compareText`, `stripLeadingArticle`.
- **festivals** (SPEC §7b; every 'YYYY-MM-DD' is a LOCAL calendar day, tested across time zones + DST):
  `FESTIVAL_STORAGE_KEY` ('star.festival'), `FESTIVAL_PARAM` ('festival'), `FestivalSource`, `FestivalPhase`
  ('upcoming'|'today'|'ongoing'|'over'|'tbd'), `FESTIVAL_KIND_LABEL/EMOJI`; dates: `isValidDateString`, `formatDay`,
  `formatDateRange` ('May 20–23, 2027', 'April 30 – May 2, 2027', cross-year), `formatFestivalDate(f, {month, weekday})`
  (deadline → dateLabel / 'Submissions close …' / short 'Closes Feb 28, 2027'; TBD → dateLabel / 'Date to be
  announced'), `festivalChipDate`, `calendarParts`, `festivalTileDate`, `festivalDateNote`, `hasFestivalDate`,
  `isDeadlineFestival` (an ONLINE festival's end date is its deadline even when it has an "Opens" day; any festival
  with only an end date too), `entriesOpenOn(f, now)`, `isOpeningOnly` (online, opening day but no deadline yet),
  `isMultiDay`, `festivalPhaseOf(f, now)`, `countdownTarget(f)` (end of the deadline day, else the start day),
  `festivalStatus(f, now)` ('In 12 days', 'Today!', 'On now!', 'Closes in 3 days', 'Opens in 5 days', 'Wrapped',
  'Date TBA'), `upcomingNationals(list, now)` (nationals not over yet, for "Next stop");
  lists: `festivalShortName` ('Surrey'), `isChoosable`, `compareFestivals`, `groupFestivals`, `regionalChoices`,
  `nationalFestivals`, `pickerGroups`, `festivalSeason` ('2026–27'); selection: `normalizeFestivalSlug`,
  `findChoosable`, `resolveFestivalSelection({festivals, url, account, local, fallback})`, `readStoredFestival` /
  `writeStoredFestival` (never throw), `festivalShareUrl(slug, origin?)`, `festivalParam`, `withoutFestivalParam`;
  admin form: `FESTIVAL_LIMITS` (incl. sort order ±1,000,000), `FestivalDraft`, `emptyFestivalDraft`,
  `draftFromFestival`, `validateFestivalDraft(draft, { incompleteDates })` (mirrors the server; a date input whose
  `validity.badInput` is set is an error, never "no date"), `festivalInputFromDraft`.
- **vocab**: `VOCAL_RANGES`, `RANGE_SHORT`, `RANGE_SLUG`, `RANGE_COLORS`, `RANGE_TEXT_COLOR`, `RANGE_INFO` (blurb+example per range), `normalizeVocalRange`, `isVocalRange`, `rangeIndex`, `rangeShort`, `rangeSlug`, `rangeColorVar`, `compareRanges`; `GENRES`, `GENRE_EMOJI`, `SUB_GENRE_EMOJI`, `genreEmoji`, `subGenreEmoji`; `KIND_LABEL`, `KIND_PLURAL`, `KIND_EMOJI`; `COMMENT_TAGS`, `COMMENT_TAG_LABEL`, `COMMENT_TAG_EMOJI`, `COMMENT_MAX_LENGTH`, `isCommentTag`; `TIME_LIMIT_SECONDS` (360), `WARN_SECONDS` (330), `TAEA_URL`, `RUBRIC_CATEGORIES`, `RUBRIC_LEVELS`. (No festival is hardcoded — see **festivals**.)
- **format**: `formatLength(s, fallback='—')`, `formatLengthLong`, `parseLength('m:ss') → s|null`, `timeStatus(s) → 'ok'|'close'|'over'|null`, `TIME_STATUS_LABEL/SHORT`, `formatDate`, `formatLongDate`, `relativeTime(iso, now?)`, `countdownParts`, `daysUntil`, `parseLocalDate`, `plural`, `formatBytes`, `percent`.
- **filters**: `FilterState`, `DEFAULT_FILTERS`, `defaultFilters(o)`, `SORT_OPTIONS`, `LENGTH_SLIDER`, `hasPlayableAudio`, `hasAnyAudio`, `searchFields`, `songMatchesQuery`, `songMatchesFilters`, `songsIgnoring`, `applyFilters`, `sortSongs(songs, SongSort)`, `sortSongsBy(songs, column, dir)`, `filtersFromSearchParams`, `filtersToSearchParams(state, base?)`, `FILTER_PARAM_KEYS`, `browseHref(partial)` (e.g. quick links), `toggleInList`, `countActiveFilters`, `isUnfiltered`, `clearFilters`, `activeFilterPills`, `highlightRanges`, `highlightSegments`, `rangeCounts`, `facetCounts`.
- **setlist**: `useSetlist`, `getSetlist`, `setSetlist`, `addToSetlist`, `removeFromSetlist`, `toggleSetlist`, `moveInSetlist`, `clearSetlist`, `importSetlist`, `parseSetlistParam`, `setlistShareUrl`, `sanitizeIds`, `SETLIST_STORAGE_KEY`.
- **slate**: `buildSlate({kind, names, school?, troupe?, title?, show?, composer?, lyricist?, placeholders?}) → { slate, closing: 'Thank you.', instruction, text, credits }`, `slateCredits`, `normalizeTroupe`, `joinNames`.
- **permissions**: `isAdmin`, `isOwner`, `canEdit`, `canContribute`, `canEditComment`, `canDeleteComment`.
- **hash**: `stableHash`, `gradientFor(seed) → {css, from, to, angle, hue}`, `initials(name, max)`, `dateKey`, `pickIndex`, `pickDaily(items, date?)`, `seededRandom(seed)`.
- **links**: `youtubeSearchUrl`, `backingTrackUrl(song)`, `performancesUrl(song)`, `sheetMusicUrl(song)`, `isSafeHttpUrl`, `isHttpsUrl`, `hostOf`, `safeNextPath`, `loginHref(next)`, `signupHref(next)`, `songPath`, `songEditPath`, `showPath`.
- **validation**: `validateEmail`, `validatePassword`, `validateDisplayName`, `passwordStrength`, limits.
- **color**: `hexToRgb`, `relativeLuminance`, `contrastRatio`, `readableTextOn`. **theme**: `useTheme`, `applyTheme`, `getTheme`.

## CSS: tokens & utility classes

Themes: `<html data-theme="dark|light">` (dark "stage" default; light "matinee"). Always use tokens:

- Colour: `--bg --bg-deep --surface --surface-2 --surface-3 --surface-glass --border --border-strong --text --text-muted --text-subtle --heading --primary --primary-hover --on-primary --primary-text --primary-soft --accent-pink(-soft) --on-pink --accent-teal(-soft) --on-teal --link --success/--warning/--danger (+ -bg, -text) --info-bg --info-text --focus --overlay --mark-bg`.
  Palette constants: `--gold-200…700 --pink-* --teal-* --plum-* --velvet-*`. Vocal ranges: `--range-soprano|mezzo|alto|tenor|baritone|bass|unknown` + `--range-text`; classes `.range-<slug>` set `--range-color`.
  Marquee (always dark): `--marquee-frame --marquee-panel --marquee-text --marquee-gold`.
- Type: `--font-display` (Limelight) `--font-body` (Nunito); fluid sizes `--step--2 … --step-5`.
- Space `--space-3xs … --space-3xl`, `--gutter`; radius `--radius-xs|sm|md|lg|xl|pill`; shadows `--shadow-sm|md|lg|glow`;
  motion `--ease-out --ease-bounce --dur-fast --dur --dur-slow`; layout `--container --header-h --mini-player-h --tap`; z `--z-header --z-player --z-drawer --z-toast`.
- Layout utilities: `.container .container-narrow .page-header .page-title .page-subtitle .eyebrow .section .section-title .stack(.stack-sm/.stack-lg) .cluster(.cluster-between) .grid-auto (--grid-min) .song-grid .song-row .spacer`.
- Text: `.muted .subtle .small .tiny .center .nowrap .truncate .line-clamp-2 .gold .text-gradient .display .emoji .visually-hidden`.
- Components: `.btn` + `.btn-primary|secondary|pink|ghost|quiet|danger|danger-ghost` + `.btn-sm|lg|block`, `.btn-icon(.btn-icon-sm .is-filled)`, `.spinner`,
  `.chip[aria-pressed]` (+ `.chip-count`, `.chip-range`, `.chip-group`), `.badge(-outline|-gold|-pink|-teal|-success|-warning|-danger|-info)`, `.count-badge`, `.pill`,
  `.card(.card-pad .card-hover .card-glow)`, `.stretched-link` + `.card-raise`, `.panel`, `.callout(-info|-warning|-danger|-success)`,
  `.field .label .hint .field-error .input .textarea .select .input-group .char-counter .fieldset`, `.switch`, `.range-slider` (set `--fill`), `.segmented`, `.tabs/.tab/.tab-panel`,
  `.table-wrap .table (.num)`, `dialog.modal`, `dialog.drawer`, `.toast`, `.skeleton`, `.empty-state`, `.marquee(-sm|-lg, .is-still) > .marquee-inner`, `.marquee-text`,
  `.tag(-genre|-subgenre|-kind)`, `.length-badge.is-ok|close|over`, `.mature-badge`, `.avatar(-xs…xl)`, `.voice-ladder`, `.play-button`, `.heart-button`, `.eq` (equalizer bars), `.menu/.menu-item`.
- Print: `.no-print` hides; header/footer/player hidden automatically.
