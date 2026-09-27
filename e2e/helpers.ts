import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export { expect };

/** Every non-GET /api request must carry this header (SPEC §5a CSRF). */
export const CSRF = { 'X-Requested-With': 'star-song-finder' } as const;

/** Created by global-setup (signed up, then promoted with `make-admin`). */
export const ADMIN = { email: 'admin@test.local', password: 'admin-password-123', displayName: 'Stage Manager' } as const;

export interface ApiSong {
  id: number;
  kind: 'solo' | 'duet';
  title: string;
  show: { id: number; name: string; slug: string };
  genre: string | null;
  subGenre: string | null;
  lengthSeconds: number | null;
  mature: boolean;
  notes: string | null;
  parts: { position: number; character: string; vocalRange: string | null }[];
  media: { previewUrl: string | null; audioUrl: string | null; audioLink: string | null };
  source: 'spreadsheet' | 'community';
  createdBy: { id: number; displayName: string } | null;
}

export interface ApiUser {
  id: number;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
}

export interface Account {
  email: string;
  password: string;
  displayName: string;
}

let seq = 0;
/** Short unique suffix — the suite shares one database across workers and reruns. */
export function uniq(): string {
  seq += 1;
  return `${Date.now().toString(36).slice(-5)}${process.pid.toString(36)}${seq}`;
}

export function newAccount(label = 'Kid'): Account {
  const id = uniq();
  return { email: `${label.toLowerCase()}-${id}@example.com`, password: `pw-${id}-secret`, displayName: `${label} ${id}`.slice(0, 40) };
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`${what} → ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

/**
 * Sign up through the API. Pass `page.request` so the session cookie lands in the page's
 * browser context (the app then loads logged in).
 */
export async function apiSignup(api: APIRequestContext, account: Account = newAccount()): Promise<{ account: Account; user: ApiUser }> {
  const res = await api.post('/api/auth/signup', { data: account, headers: CSRF });
  const { user } = await ok<{ user: ApiUser }>(res, 'signup');
  return { account, user };
}

export async function apiLogin(api: APIRequestContext, account: { email: string; password: string }): Promise<ApiUser> {
  const res = await api.post('/api/auth/login', { data: { email: account.email, password: account.password }, headers: CSRF });
  return (await ok<{ user: ApiUser }>(res, 'login')).user;
}

export async function apiLogout(api: APIRequestContext): Promise<void> {
  await ok(await api.post('/api/auth/logout', { headers: CSRF }), 'logout');
}

export async function loginAsAdmin(page: Page): Promise<ApiUser> {
  return apiLogin(page.request, ADMIN);
}

export async function apiCreateSong(api: APIRequestContext, body: Record<string, unknown>): Promise<ApiSong> {
  return ok<ApiSong>(await api.post('/api/songs', { data: body, headers: CSRF }), 'create song');
}

export async function apiPostComment(api: APIRequestContext, songId: number, body: string, tag = 'general'): Promise<{ id: number }> {
  return ok(await api.post(`/api/songs/${songId}/comments`, { data: { body, tag }, headers: CSRF }), 'post comment');
}

export async function allSongs(api: APIRequestContext, query = ''): Promise<ApiSong[]> {
  const res = await api.get(`/api/songs${query ? `?${query}` : ''}`);
  return (await ok<{ songs: ApiSong[] }>(res, 'list songs')).songs;
}

export async function songByTitle(api: APIRequestContext, title: string): Promise<ApiSong> {
  const songs = await allSongs(api);
  const song = songs.find((s) => s.title === title);
  if (!song) throw new Error(`No song titled “${title}”`);
  return song;
}

/** A community solo owned by whoever `api` is logged in as. */
export async function apiCreateSolo(api: APIRequestContext, overrides: Record<string, unknown> = {}): Promise<ApiSong> {
  const id = uniq();
  return apiCreateSong(api, {
    kind: 'solo',
    title: `Test Solo ${id}`,
    showName: 'Hadestown',
    genre: 'Drama',
    subGenre: 'Hopeful',
    length: '2:30',
    parts: [{ character: 'Orpheus', vocalRange: 'Tenor' }],
    ...overrides,
  });
}

export interface ApiFestival {
  id: number;
  slug: string;
  name: string;
  kind: 'regional' | 'online' | 'national';
  province: string | null;
  city: string | null;
  startDate: string | null;
  endDate: string | null;
  dateLabel: string | null;
  venue: string | null;
  infoUrl: string | null;
  sortOrder: number;
  active: boolean;
}

/** GET /api/festivals (active only; `all` = hidden ones too, admins only). */
export async function apiFestivals(api: APIRequestContext, all = false): Promise<ApiFestival[]> {
  return (await ok<{ festivals: ApiFestival[] }>(await api.get(`/api/festivals${all ? '?all=1' : ''}`), 'list festivals')).festivals;
}

/**
 * What the pickers offer, in picker order (SPEC §7b): active regionals by date with "to be
 * announced" last, then online ones.
 */
export function pickerOrder(festivals: ApiFestival[]): ApiFestival[] {
  const key = (f: ApiFestival) => f.startDate ?? f.endDate;
  const byDate = (a: ApiFestival, b: ApiFestival) => {
    const ka = key(a);
    const kb = key(b);
    if (ka && !kb) return -1;
    if (!ka && kb) return 1;
    if (ka && kb && ka !== kb) return ka < kb ? -1 : 1;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  };
  const active = festivals.filter((f) => f.active);
  return [...active.filter((f) => f.kind === 'regional').sort(byDate), ...active.filter((f) => f.kind === 'online').sort(byDate)];
}

/** The visitor's festival on this device (localStorage `star.festival`). */
export async function storedFestival(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem('star.festival'));
}

/**
 * Replace HTMLMediaElement playback with a stub: play() resolves immediately and fires the
 * "playing" event, pause() fires "pause". Keeps the suite off the network (Apple previews) and
 * independent of codec support in headless Chromium. `window.__plays` records each play() src.
 */
export async function stubAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __plays: string[] };
    w.__plays = [];
    const proto = HTMLMediaElement.prototype;
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperty(proto, 'paused', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return paused.get(this) ?? true;
      },
    });
    proto.play = function play(this: HTMLMediaElement) {
      w.__plays.push(this.currentSrc || this.src);
      paused.set(this, false);
      setTimeout(() => this.dispatchEvent(new Event('playing')), 0);
      return Promise.resolve();
    };
    proto.pause = function pause(this: HTMLMediaElement) {
      paused.set(this, true);
      setTimeout(() => this.dispatchEvent(new Event('pause')), 0);
    };
    proto.load = function load() {
      /* no network */
    };
  });
}

/** Chromium logs failed fetches (e.g. an expected 401/403/404/409) as console errors — ignore those. */
const EXPECTED_CONSOLE = [/Failed to load resource: the server responded with a status of 4\d\d/];

/**
 * `test` with an automatic guard: any uncaught page error or unexpected console error in the
 * default `page` fails the test.
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (EXPECTED_CONSOLE.some((re) => re.test(text))) return;
        problems.push(`console.error: ${text}`);
      });
      await use();
      expect(problems, 'unexpected console errors / page errors').toEqual([]);
    },
    { auto: true },
  ],
});

/** Horizontal overflow check: the document must not be wider than the viewport. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
