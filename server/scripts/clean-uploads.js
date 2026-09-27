#!/usr/bin/env node
// List (and optionally delete) files in the uploads folder that no song or show uses any more —
// e.g. left behind by older versions of the site.
//   npm --prefix server run clean-uploads            # dry run: just list them
//   npm --prefix server run clean-uploads -- --delete
// Only files older than an hour are considered (uploads in progress are left alone). It refuses to
// delete when the database has no songs at all (a wrong STAR_DB_PATH would make everything look unused).
import fs from 'node:fs';
import path from 'node:path';
import { openDb, SERVER_ROOT, DEFAULT_DB_PATH } from '../src/db.js';
import { findOrphanUploads, sweepIncoming } from '../src/lib/uploads.js';
import { resolveUserPath } from '../src/lib/paths.js';

const env = process.env;
const del = process.argv.includes('--delete');
const dbPath = env.STAR_DB_PATH ? resolveUserPath(env.STAR_DB_PATH) : DEFAULT_DB_PATH;
const uploadsDir = env.STAR_UPLOADS_DIR ? resolveUserPath(env.STAR_UPLOADS_DIR) : path.join(SERVER_ROOT, 'uploads');
if (!fs.existsSync(dbPath)) {
  console.error(`❌ No database at ${dbPath}`);
  process.exit(1);
}
const db = openDb(dbPath);
try {
  const songs = db.prepare('SELECT count(*) AS n FROM songs').get().n;
  const orphans = findOrphanUploads(db, uploadsDir);
  const mb = (b) => (b / 1048576).toFixed(1);
  const total = orphans.reduce((n, o) => n + o.bytes, 0);
  for (const o of orphans) console.log(`${del ? 'deleting' : 'unused'}  ${o.publicPath}  (${mb(o.bytes)} MB)`);
  console.log(`${orphans.length} unused file(s), ${mb(total)} MB in ${uploadsDir}`);
  if (del) {
    if (songs === 0) {
      console.error(`❌ ${dbPath} has no songs — refusing to delete (is STAR_DB_PATH right?)`);
      process.exitCode = 1;
    } else {
      for (const o of orphans) fs.rmSync(o.fullPath, { force: true });
      const temp = sweepIncoming(uploadsDir);
      console.log(`🧹 Deleted ${orphans.length} file(s)${temp ? ` and ${temp} stale temp file(s)` : ''}`);
    }
  } else if (orphans.length) {
    console.log('Run again with --delete to remove them.');
  }
} finally {
  db.close();
}
