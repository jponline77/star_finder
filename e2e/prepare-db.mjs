// Prepares an isolated, hermetic data directory for the e2e run (called from the Playwright
// webServer command, BEFORE the server starts — Playwright launches `webServer` before
// `globalSetup`, so this can't live in globalSetup itself):
//   server/seed/*  →  test-results/e2e.db        (a FRESH import of the committed seed spreadsheet —
//                                                  the developer's own database is never read, so
//                                                  local edits, imports or community songs can't
//                                                  change what the specs see)
//   server/media/  →  test-results/e2e-media/    (the posters/album art `npm run fetch-media` downloaded;
//                                                  whatever is there — the specs pass without them too,
//                                                  with the gradient placeholders. E2E_MEDIA_SRC=<dir>
//                                                  copies another folder, e.g. an empty one)
//   test/fixtures/plain.png → e2e-media/art/e2e-cover.png  (a tiny synthetic "cached cover" the
//                                                  contribute spec's mocked iTunes lookup points at)
//   (empty)        →  test-results/e2e-uploads/
// The real database, media and uploads are never written by the e2e suite.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../server/src/db.js';
import { importSpreadsheet } from '../server/scripts/import-xlsx.js';

const root = path.resolve(import.meta.dirname, '..');
const out = process.env.E2E_DATA_DIR ? path.resolve(process.env.E2E_DATA_DIR) : path.join(root, 'test-results');
const destDb = path.join(out, 'e2e.db');

fs.mkdirSync(out, { recursive: true });
for (const f of [destDb, `${destDb}-wal`, `${destDb}-shm`]) fs.rmSync(f, { force: true });

const uploads = path.join(out, 'e2e-uploads');
fs.rmSync(uploads, { recursive: true, force: true });
fs.mkdirSync(path.join(uploads, 'audio'), { recursive: true });
fs.mkdirSync(path.join(uploads, 'images'), { recursive: true });

const media = path.join(out, 'e2e-media');
fs.rmSync(media, { recursive: true, force: true });
const mediaSrc = process.env.E2E_MEDIA_SRC ? path.resolve(process.env.E2E_MEDIA_SRC) : path.join(root, 'server', 'media');
if (fs.existsSync(mediaSrc)) fs.cpSync(mediaSrc, media, { recursive: true });
fs.mkdirSync(path.join(media, 'art'), { recursive: true });
fs.copyFileSync(path.join(root, 'server', 'test', 'fixtures', 'plain.png'), path.join(media, 'art', 'e2e-cover.png'));

const db = openDb(destDb);
try {
  const summary = await importSpreadsheet({ db, mediaDir: media, uploadsDir: uploads });
  console.log(`e2e: fresh database at ${path.relative(root, destDb)} (${summary.totals.songs} songs from the seed spreadsheet)`);
} finally {
  db.close();
}
