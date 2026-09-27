#!/usr/bin/env node
// Back up everything that isn't in version control, safely while the server is running:
//   npm run backup                 # → backups/star-<timestamp>/ (at the directory you run it from)
//   npm run backup -- /mnt/usb     # → /mnt/usb/star-<timestamp>/
// Writes star.db (an online SQLite backup — consistent even in WAL mode, no sqlite3 CLI needed)
// and a copy of the uploads folder (practice audio, posters, downloaded album art).
// Restore: stop the server, delete server/data/star.db-wal and star.db-shm, copy star.db and
// uploads/ back, start the server (see README "Backups").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { SERVER_ROOT, DEFAULT_DB_PATH } from '../src/db.js';
import { resolveUserPath } from '../src/lib/paths.js';

/**
 * @param {{ dbPath: string, uploadsDir: string, destRoot: string, now?: Date }} opts
 * @returns {Promise<{ dir: string, dbFile: string, files: number }>}
 */
export async function backup({ dbPath, uploadsDir, destRoot, now = new Date() }) {
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const dir = path.join(destRoot, `star-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'star.db');
  const src = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await src.backup(dbFile);
  } finally {
    src.close();
  }
  let files = 0;
  if (fs.existsSync(uploadsDir)) {
    fs.cpSync(uploadsDir, path.join(dir, 'uploads'), {
      recursive: true,
      filter: (p) => path.basename(p) !== '.incoming', // unfinished uploads
    });
    const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
    files = count(path.join(dir, 'uploads'));
  }
  return { dir, dbFile, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const dbPath = env.STAR_DB_PATH ? resolveUserPath(env.STAR_DB_PATH) : DEFAULT_DB_PATH;
  const uploadsDir = env.STAR_UPLOADS_DIR ? resolveUserPath(env.STAR_UPLOADS_DIR) : path.join(SERVER_ROOT, 'uploads');
  const destRoot = resolveUserPath(process.argv[2] ?? 'backups');
  backup({ dbPath, uploadsDir, destRoot })
    .then(({ dir, files }) => console.log(`✅ Backed up the database and ${files} uploaded file(s) to ${dir}`))
    .catch((err) => {
      console.error(`❌ Backup failed: ${err.message}`);
      process.exit(1);
    });
}
