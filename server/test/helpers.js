// Shared test helpers: temp DB/dirs, a supertest agent that sends the CSRF header, fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));
/** Small song catalog in the real catalog.json.gz format (SPEC §7c); catalog.json is its readable source. */
export const CATALOG_FIXTURE = path.join(FIXTURES, 'catalog.json.gz');

export const CSRF = { 'X-Requested-With': 'star-song-finder' };
export const silentLogger = { info() {}, warn() {}, error() {} };
export const PASSWORD = 'correct horse 42';

/** fetch that fails loudly — tests never hit the network. */
export const noNetwork = async (url) => {
  throw new Error(`network disabled in tests: ${url}`);
};

/**
 * Fresh app on a temp DB + temp uploads/media dirs. Rate limits are raised unless overridden in env.
 * The festivals table is seeded from the real seed/festivals.json unless `festivalsSeedPath` says
 * otherwise (null = start with no festivals). `dbFile` reuses an existing database file.
 * The song catalog isn't loaded unless `catalogPath` is given (e.g. CATALOG_FIXTURE).
 * @param {{ env?: Record<string,string>, fetchImpl?: typeof fetch, logger?: object, festivalsSeedPath?: string|null, dbFile?: string,
 *   catalogPath?: string|null }} [opts]
 */
export function makeTestApp({ env = {}, fetchImpl = noNetwork, logger = silentLogger, festivalsSeedPath, dbFile, catalogPath = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-test-'));
  const db = openDb(dbFile ?? path.join(dir, 'test.db'));
  const uploadsDir = path.join(dir, 'uploads');
  const mediaDir = path.join(dir, 'media');
  const app = createApp({
    db,
    uploadsDir,
    mediaDir,
    fetchImpl,
    env: {
      STAR_WRITE_LIMIT: '100000', STAR_COMMENT_LIMIT: '100000', STAR_LOOKUP_LIMIT: '100000', STAR_SIGNUP_LIMIT: '100000',
      STAR_READ_LIMIT: '100000', STAR_EXPORT_LIMIT: '100000', STAR_DAILY_SONG_LIMIT: '100000', STAR_DAILY_SHOW_LIMIT: '100000',
      STAR_MIN_FREE_MB: '0', STAR_SEARCH_LIMIT: '100000', STAR_APPLE_LIMIT: '100000',
      ...env,
    },
    logger,
    catalogPath,
    ...(festivalsSeedPath !== undefined ? { festivalsSeedPath } : {}),
  });
  const cleanup = () => {
    app.locals.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { app, db, dir, uploadsDir, mediaDir, cleanup };
}

/** A cookie-keeping client that always sends the CSRF header on writes. */
export function client(app) {
  const agent = request.agent(app);
  return {
    agent,
    get: (url) => agent.get(url),
    post: (url, body) => (body === undefined ? agent.post(url).set(CSRF) : agent.post(url).set(CSRF).send(body)),
    put: (url, body) => agent.put(url).set(CSRF).send(body ?? {}),
    patch: (url, body) => agent.patch(url).set(CSRF).send(body ?? {}),
    del: (url) => agent.delete(url).set(CSRF),
    upload: (url, buffer, filename, contentType = 'application/octet-stream') =>
      agent.post(url).set(CSRF).attach('file', buffer, { filename, contentType }),
  };
}

let userCounter = 0;
/** Sign up a new user and return a logged-in client + the user. */
export async function signup(app, { email, password = PASSWORD, displayName } = {}) {
  userCounter++;
  const c = client(app);
  const res = await c.post('/api/auth/signup', {
    email: email ?? `user${userCounter}@example.com`,
    password,
    displayName: displayName ?? `Tester ${userCounter}`,
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  c.user = res.body.user;
  return c;
}

/** Make an existing account an admin, like `npm run make-admin` (signup never grants admin). */
export function promoteToAdmin(db, userId) {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userId);
}

/** Sign up and promote to admin; returns the logged-in client (c.user.role === 'admin'). */
export async function signupAdmin(app, db, opts = {}) {
  const c = await signup(app, opts);
  promoteToAdmin(db, c.user.id);
  c.user = { ...c.user, role: 'admin' };
  return c;
}

/** Insert a show directly (spreadsheet by default). Returns its id. */
export function insertShow(db, name, { slug, source = 'spreadsheet', createdBy = null, composer = null } = {}) {
  const s = slug ?? name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return Number(db.prepare('INSERT INTO shows (name, slug, source, created_by, composer) VALUES (?, ?, ?, ?, ?)').run(name, s, source, createdBy, composer).lastInsertRowid);
}

/**
 * Insert a song directly. parts: [[character, range], ...]
 * @returns {number} song id
 */
export function insertSong(db, {
  kind = 'solo', title, showId, genre = null, subGenre = null, lengthSeconds = null, mature = false,
  parts = [['Someone', null]], source = 'spreadsheet', createdBy = null, previewUrl = null, audioLink = null,
}) {
  const id = Number(db.prepare(`INSERT INTO songs (kind, title, show_id, genre, sub_genre, length_seconds, mature, source, created_by, preview_url, audio_link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(kind, title, showId, genre, subGenre, lengthSeconds, mature ? 1 : 0, source, createdBy, previewUrl, audioLink).lastInsertRowid);
  parts.forEach(([character, range], i) => {
    db.prepare('INSERT INTO song_parts (song_id, position, character, vocal_range) VALUES (?, ?, ?, ?)').run(id, i + 1, character, range);
  });
  return id;
}

/** A small fixture catalogue with accents, duets, a mature song and one over 6:00. */
export function seedFixture(db) {
  const lesMis = insertShow(db, 'Les Misérables', { composer: 'Claude-Michel Schönberg' });
  const monte = insertShow(db, 'The Count of Monte Cristo');
  const shucked = insertShow(db, 'Shucked');
  const shrek = insertShow(db, 'Shrek');
  const ids = {
    lesMis, monte, shucked, shrek,
    onMyOwn: insertSong(db, { title: 'On My Own', showId: lesMis, genre: 'Drama', subGenre: 'Longing', lengthSeconds: 239, parts: [['Eponine', 'Soprano']], previewUrl: 'https://audio-ssl.itunes.apple.com/x/on-my-own.m4a' }),
    stars: insertSong(db, { title: 'Stars', showId: lesMis, genre: 'Drama', subGenre: 'Intimidating / Angry', lengthSeconds: 205, parts: [['Javert', 'Baritone']] }),
    rain: insertSong(db, { kind: 'duet', title: 'A Little Fall of Rain', showId: lesMis, genre: 'Drama', subGenre: 'Longing', lengthSeconds: 201, mature: true, parts: [['Marius', 'Baritone'], ['Eponine', 'Soprano']] }),
    doorstep: insertSong(db, { title: 'Hell to Your Doorstep', showId: monte, genre: 'Drama', subGenre: 'Intimidating / Angry', lengthSeconds: 176, parts: [['Dantès', 'Baritone']] }),
    loveTrue: insertSong(db, { kind: 'duet', title: 'When Love is True', showId: monte, genre: 'Romantic', subGenre: 'In Love', lengthSeconds: 190, parts: [['Dantès', 'Baritone'], ['Mercédès', 'Soprano']] }),
    corn: insertSong(db, { kind: 'duet', title: 'Corn', showId: shucked, genre: 'Comedy', subGenre: 'Tongue-in-Cheek', lengthSeconds: 406, mature: true, parts: [['Storyteller 1', 'Baritone'], ['Storyteller 2', 'Mezzo-soprano']] }),
    donkey: insertSong(db, { title: "Don't Let Me Go", showId: shrek, genre: 'Comedy', subGenre: 'Slapstick', lengthSeconds: 169, parts: [['Donkey', 'Tenor']], audioLink: 'https://www.youtube.com/watch?v=x' }),
  };
  return ids;
}

// ---- tiny binary fixtures (real files, made with ffmpeg / Pillow — see test/fixtures/) ----
export const MP3 = fixture('tone.mp3'); // ID3v2 + v1 tags around real MPEG frames
export const MP3_FRAME = MP3.subarray(94, 1739); // the same frames without the tags
export const M4A = fixture('tone.m4a');
export const WAV = fixture('tone.wav');
export const PNG = fixture('plain.png');
export const JPEG = fixture('plain.jpg');
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const HTML = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');

/** Build a fetch Response. */
export function jsonResponse(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function binaryResponse(buffer, contentType, { status = 200, headers = {} } = {}) {
  return new Response(buffer, { status, headers: { 'content-type': contentType, 'content-length': String(buffer.length), ...headers } });
}

/** Valid song body for POST /api/songs. */
export function soloBody(overrides = {}) {
  return {
    kind: 'solo',
    title: 'Brand New Song',
    showName: 'Brand New Musical',
    genre: 'Comedy',
    subGenre: 'Satire',
    length: '3:25',
    mature: false,
    parts: [{ character: 'Lead', vocalRange: 'Tenor' }],
    ...overrides,
  };
}

/** Buffer body parser for supertest (binary downloads). */
export function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
