#!/usr/bin/env node
// Remove the cast album and cast-album songs saved for a catalog show (SPEC §7c moderation) — the
// same as the admin endpoint DELETE /api/admin/catalog/shows/:id/recording.
//   npm --prefix server run catalog:clear-recording -- --list            # what users saved, newest first
//   npm --prefix server run catalog:clear-recording -- <show id or key>  # remove it (album rejected for that show)
//   npm --prefix server run catalog:clear-recording -- <id> --allow-again # remove it, but the album may be picked again
// Site songs linked to the removed songs just lose the link. Safe while the server runs.
import fs from 'node:fs';
import { openDb, DEFAULT_DB_PATH } from '../src/db.js';
import { resolveUserPath } from '../src/lib/paths.js';
import { clearCatalogShowRecording } from '../src/lib/catalog-recordings.js';

const env = process.env;
const args = process.argv.slice(2);
const dbPath = env.STAR_DB_PATH ? resolveUserPath(env.STAR_DB_PATH, env) : DEFAULT_DB_PATH;
const target = args.find((a) => !a.startsWith('--'));

if (!fs.existsSync(dbPath)) {
  console.error(`❌ No database at ${dbPath} (set STAR_DB_PATH)`);
  process.exit(1);
}
if (!target && !args.includes('--list')) {
  console.error('Usage: npm --prefix server run catalog:clear-recording -- <catalog show id or key> [--allow-again]   (or --list)');
  process.exit(1);
}
const db = openDb(dbPath, { busyTimeoutMs: 30_000 });
try {
  if (!target) {
    const rows = db.prepare(`SELECT sh.id, sh.key, sh.title, sh.itunes_collection_id AS album, sh.itunes_collection_name AS albumName,
        sh.itunes_saved_at AS savedAt, sh.itunes_saved_by AS savedBy,
        (SELECT count(*) FROM catalog_songs cs WHERE cs.show_id = sh.id AND cs.source = 'recording') AS songs
      FROM catalog_shows sh
      WHERE sh.itunes_collection_id IS NOT NULL OR EXISTS (SELECT 1 FROM catalog_songs cs WHERE cs.show_id = sh.id AND cs.source = 'recording')
      ORDER BY sh.itunes_saved_at IS NULL, sh.itunes_saved_at DESC, sh.id`).all();
    if (!rows.length) console.log('Nothing saved from Apple for any catalog show.');
    for (const r of rows) {
      console.log(`#${r.id} ${r.key} “${r.title}”: ${r.songs} cast-album song(s), album ${r.album ?? '—'} ${r.albumName ? `“${r.albumName}”` : ''}`
        + (r.savedAt ? ` — saved ${r.savedAt}${r.savedBy ? ` by user #${r.savedBy}` : ''}` : ''));
    }
  } else {
    const show = /^\d+$/.test(target)
      ? db.prepare('SELECT id, title FROM catalog_shows WHERE id = ?').get(Number(target))
      : db.prepare('SELECT id, title FROM catalog_shows WHERE key = ?').get(target);
    if (!show) {
      console.error(`❌ No catalog show with id or key "${target}"`);
      process.exitCode = 1;
    } else {
      const r = clearCatalogShowRecording(db, show.id, { reject: !args.includes('--allow-again') });
      console.log(`✅ “${show.title}” (#${show.id}): removed ${r.removedSongs} cast-album song(s)`
        + (r.collectionId ? ` and album ${r.collectionId}${r.rejected ? ' (never picked for this show again)' : ''}` : ''));
    }
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
