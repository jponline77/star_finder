// Server entry point: `npm start` / `npm run dev` (server/), `npm start` (root, production).
//   node src/index.js [--production]
// `--production` (used by the root `npm start`, works on Windows too) = NODE_ENV=production.
import fs from 'node:fs';
import path from 'node:path';
import { openDb, SERVER_ROOT, DEFAULT_DB_PATH } from './db.js';
import { createApp, trustProxyWarning } from './app.js';
import { resolveUserPath } from './lib/paths.js';

const env = process.env;
if (process.argv.includes('--production')) env.NODE_ENV = 'production';

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const PORT = Number(env.PORT) || 3001;
const HOST = env.HOST || undefined; // default: all interfaces
const dbPath = env.STAR_DB_PATH ? resolveUserPath(env.STAR_DB_PATH) : DEFAULT_DB_PATH;
const uploadsDir = env.STAR_UPLOADS_DIR ? resolveUserPath(env.STAR_UPLOADS_DIR) : path.join(SERVER_ROOT, 'uploads');
const mediaDir = env.STAR_MEDIA_DIR ? resolveUserPath(env.STAR_MEDIA_DIR) : path.join(SERVER_ROOT, 'media');
const isProd = env.NODE_ENV === 'production';
const clientDistDir = isProd ? path.resolve(SERVER_ROOT, '..', 'client', 'dist') : null;
const graceMs = Number.isFinite(Number(env.STAR_SHUTDOWN_GRACE_MS)) && env.STAR_SHUTDOWN_GRACE_MS !== ''
  ? Number(env.STAR_SHUTDOWN_GRACE_MS) : 20_000;

// A short busy timeout: better-sqlite3 blocks the event loop while it waits for a lock
// (requests that still hit a lock get a 503 "try again").
const db = openDb(dbPath, { busyTimeoutMs: 1000 });
const app = createApp({ db, uploadsDir, mediaDir, clientDistDir, env });

const songCount = db.prepare('SELECT count(*) AS n FROM songs').get().n;
const server = app.listen(PORT, HOST, (err) => {
  // Express 5 passes listen errors (e.g. EADDRINUSE) here instead of throwing.
  if (err) {
    console.error(`${new Date().toISOString()} ❌ Can't listen on ${HOST ?? 'port'}:${PORT} — ${err.code === 'EADDRINUSE' ? 'another program is already using that port' : err.message}`);
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(1);
  }
  log(`🌟 STAR Song Finder API listening on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
  log(`   database: ${dbPath} (${songCount} songs)`);
  if (songCount === 0) log('   ⚠️  The database is empty — run `npm run import` (in server/) to load the spreadsheet.');
  if (isProd) {
    if (fs.existsSync(path.join(clientDistDir, 'index.html'))) log(`   serving client from ${clientDistDir}`);
    else log(`   ⚠️  ${clientDistDir} not found — run \`npm run build\` at the repo root to serve the website`);
  }
  const proxyWarning = trustProxyWarning(env.TRUST_PROXY, HOST, PORT);
  if (proxyWarning) log(`   ⚠️  ${proxyWarning}`);
});

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  log(`${signal} received — finishing ${graceMs / 1000}s of in-flight requests, then shutting down`);
  app.locals.close?.();
  server.close(() => {
    db.close(); // checkpoints the WAL: a clean stop leaves no star.db-wal behind
    log('Stopped cleanly');
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    server.getConnections((_err, open) => {
      console.error(`${new Date().toISOString()} ⚠️  ${open ?? 'some'} connection(s) still open after ${graceMs / 1000}s — closing them`);
      server.closeAllConnections();
      try {
        db.close();
      } catch {
        // a request may still be using it; the WAL is replayed on the next start
      }
      process.exit(1);
    });
  }, graceMs).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
