-- STAR Song Finder schema (SPEC §3). Keep in sync with SPEC.md.
-- New columns: add a migration in src/db.js (PRAGMA user_version), not here.

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
