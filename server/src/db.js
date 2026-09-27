import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { fold } from './lib/text.js';
import { uniqueSlug } from './lib/slug.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const DEFAULT_DB_PATH = path.join(SERVER_ROOT, 'data', 'star.db');
const SCHEMA_SQL = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');

/**
 * Tiny migration list. schema.sql is the baseline (user_version 1). To add a column later, append
 * `{ version: 5, up(db) { addColumnIfMissing(db, 'songs', 'foo', 'TEXT'); } }` — never edit
 * existing entries. Each migration runs in a transaction and bumps PRAGMA user_version.
 * @type {{ version: number, up: (db: import('better-sqlite3').Database) => void }[]}
 */
export const MIGRATIONS = [
  { version: 1, up() { /* baseline = schema.sql */ } },
  {
    version: 2,
    up(db) {
      // Stable identity for spreadsheet rows (import matches on it before names, so admin renames
      // and moves don't create duplicates) + tombstones for spreadsheet rows an admin deleted.
      addColumnIfMissing(db, 'songs', 'import_key', 'TEXT');
      addColumnIfMissing(db, 'shows', 'import_key', 'TEXT');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_import_key ON songs(import_key) WHERE import_key IS NOT NULL');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_import_key ON shows(import_key) WHERE import_key IS NOT NULL');
      db.exec(`CREATE TABLE IF NOT EXISTS import_tombstones (
        kind        TEXT NOT NULL CHECK (kind IN ('song','show')),
        import_key  TEXT NOT NULL,
        deleted_at  TEXT NOT NULL,
        PRIMARY KEY (kind, import_key)
      )`);
      // "Edited on the website" marker: set only when PUT really changes a data field (uploads and
      // no-op saves don't count). Carry over the old updated_at > created_at signal.
      addColumnIfMissing(db, 'songs', 'edited_at', 'TEXT');
      addColumnIfMissing(db, 'shows', 'edited_at', 'TEXT');
      db.exec('UPDATE songs SET edited_at = updated_at WHERE edited_at IS NULL AND updated_at > created_at');
      db.exec('UPDATE shows SET edited_at = updated_at WHERE edited_at IS NULL AND updated_at > created_at');
      // Per-user daily creation caps count rows by creator.
      db.exec('CREATE INDEX IF NOT EXISTS idx_songs_created_by ON songs(created_by, created_at)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_shows_created_by ON shows(created_by, created_at)');
      // Temporary passwords from an admin reset expire.
      addColumnIfMissing(db, 'users', 'temp_password_expires_at', 'TEXT');
      // STAR_ADMIN_EMAILS: when each email was first listed (accounts created later aren't auto-promoted).
      db.exec(`CREATE TABLE IF NOT EXISTS admin_email_listings (
        email           TEXT PRIMARY KEY COLLATE NOCASE,
        first_listed_at TEXT NOT NULL
      )`);
      // All-digit slugs (a show called "13") collide with numeric show ids in /api/shows/:idOrSlug.
      const numeric = db.prepare("SELECT id, name, slug FROM shows WHERE slug != '' AND slug NOT GLOB '*[^0-9]*'").all();
      const taken = db.prepare('SELECT id FROM shows WHERE slug = ?');
      const setSlug = db.prepare('UPDATE shows SET slug = ? WHERE id = ?');
      for (const row of numeric) {
        setSlug.run(uniqueSlug(row.name, (s) => {
          const hit = taken.get(s);
          return Boolean(hit) && hit.id !== row.id;
        }), row.id);
      }
    },
  },
  {
    version: 3,
    up(db) {
      // Selectable festivals (SPEC §7b). Filled from seed/festivals.json at app startup when empty
      // (lib/festivals.js seedFestivalsIfEmpty) and by `npm run import`.
      db.exec(`CREATE TABLE IF NOT EXISTS festivals (
        id          INTEGER PRIMARY KEY,
        slug        TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('regional','online','national')),
        province    TEXT,
        city        TEXT,
        start_date  TEXT,
        end_date    TEXT,
        date_label  TEXT,
        venue       TEXT,
        info_url    TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        edited_at   TEXT
      )`);
      // edited_at: set when an admin creates or changes a festival on the website, like
      // songs/shows.edited_at — the import then leaves the row alone (unless --overwrite-edits).
      addColumnIfMissing(db, 'users', 'festival_id', 'INTEGER REFERENCES festivals(id) ON DELETE SET NULL');
      db.exec('CREATE INDEX IF NOT EXISTS idx_users_festival ON users(festival_id)');
    },
  },
  {
    version: 4,
    up(db) {
      // Festivals an admin deleted on the website, by slug (import_tombstones only takes songs and
      // shows): `npm run import` and startup seeding don't bring them back unless --overwrite-edits.
      // Re-creating the slug on the website (or restoring it with --overwrite-edits) clears the row.
      db.exec(`CREATE TABLE IF NOT EXISTS festival_tombstones (
        slug        TEXT PRIMARY KEY,
        deleted_at  TEXT NOT NULL
      )`);
    },
  },
];

/** Add a column only if it doesn't exist yet (safe to re-run). */
export function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function runMigrations(db) {
  const current = db.pragma('user_version', { simple: true });
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}

/**
 * Open (and create/migrate) the SQLite database.
 * WAL mode, foreign keys ON, busy timeout, and a deterministic `fold(text)` SQL function for
 * accent/case-insensitive search.
 * better-sqlite3 is synchronous, so a write that waits for a lock blocks the whole event loop:
 * the server passes a short `busyTimeoutMs` (and answers SQLITE_BUSY with 503); CLI scripts can wait longer.
 * @param {string} [dbPath] file path or ':memory:'
 * @param {{ busyTimeoutMs?: number }} [opts]
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(dbPath = DEFAULT_DB_PATH, { busyTimeoutMs = 5000 } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${Math.max(0, Math.trunc(Number(busyTimeoutMs) || 0))}`);
  db.pragma('synchronous = NORMAL');
  db.function('fold', { deterministic: true }, (s) => (s === null || s === undefined ? null : fold(s)));
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  return db;
}

/** Current UTC timestamp in the same format SQLite's defaults use. */
export function nowIso() {
  return new Date().toISOString();
}
