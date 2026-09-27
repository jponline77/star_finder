// Per-account daily caps on new songs and shows. The write limiter alone (60/min) would let one
// script add tens of thousands of junk rows a day, and every visitor would then download them all.
// Admins are exempt. Env: STAR_DAILY_SONG_LIMIT (50), STAR_DAILY_SHOW_LIMIT (20); 0 = no cap.
import { HttpError } from './errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {import('better-sqlite3').Database} db */
export function createDailyCaps(db, env = {}) {
  const num = (name, dflt) => {
    const n = Number(env[name]);
    return env[name] !== undefined && env[name] !== '' && Number.isInteger(n) && n >= 0 ? n : dflt;
  };
  const limits = { songs: num('STAR_DAILY_SONG_LIMIT', 50), shows: num('STAR_DAILY_SHOW_LIMIT', 20) };
  const counters = {
    songs: db.prepare('SELECT count(*) AS n FROM songs WHERE created_by = ? AND created_at > ?'),
    shows: db.prepare('SELECT count(*) AS n FROM shows WHERE created_by = ? AND created_at > ?'),
  };
  const check = (table, message) => (user) => {
    const limit = limits[table];
    if (!user || user.role === 'admin' || limit === 0) return;
    const since = new Date(Date.now() - DAY_MS).toISOString();
    if (counters[table].get(user.id, since).n >= limit) throw new HttpError(429, message(limit));
  };
  return {
    limits,
    checkSongs: check('songs', (n) => `You've added ${n} songs today — that's the daily limit, so try again tomorrow`),
    checkShows: check('shows', (n) => `You've added ${n} shows today — that's the daily limit, so try again tomorrow`),
  };
}
