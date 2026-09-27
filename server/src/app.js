// Express app factory. Tests inject a temp DB, temp dirs and a fake fetch.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { HttpError } from './lib/errors.js';
import { TtlCache, VersionedCache } from './lib/cache.js';
import { parseAdminEmails, applyAdminEmails, purgeExpiredSessions } from './lib/auth.js';
import { ensureUploadDirs, sweepIncoming, createUploadGuard } from './lib/uploads.js';
import { createDailyCaps } from './lib/caps.js';
import {
  loadSession, csrfAndContentType, requirePasswordChange, createLimiters,
} from './middleware.js';
import { catalogVersion } from './repo.js';
import { authRouter } from './routes/auth.js';
import { songsRouter } from './routes/songs.js';
import { showsRouter } from './routes/shows.js';
import { commentsRouter } from './routes/comments.js';
import { meRouter, adminRouter } from './routes/admin.js';
import { metaRouter } from './routes/meta.js';
import { lookupRouter } from './routes/lookup.js';
import { festivalsRouter } from './routes/festivals.js';
import { DEFAULT_FESTIVALS_SEED, seedFestivalsIfEmpty, defaultFestivalResolver } from './lib/festivals.js';

/**
 * @typedef {object} AppContext
 * @property {import('better-sqlite3').Database} db
 * @property {string} uploadsDir
 * @property {string} mediaDir
 * @property {typeof fetch} fetchImpl
 * @property {Record<string, string|undefined>} env
 * @property {TtlCache} cache
 * @property {VersionedCache} catalogCache
 * @property {ReturnType<typeof createLimiters>} limiters
 * @property {ReturnType<typeof createDailyCaps>} caps
 * @property {ReturnType<typeof createUploadGuard>} uploadGuard
 * @property {(email: string) => boolean} isAdminEmail
 * @property {() => string|null} defaultFestivalSlug STAR_DEFAULT_FESTIVAL if it names an active regional/online festival
 * @property {{ info: Function, warn: Function, error: Function }} log
 */

/**
 * TRUST_PROXY: unset/"false"/"0" → off; "true" → trust only a proxy on this machine ("loopback");
 * a number → that many hops; anything else is passed to Express as-is (e.g. "10.0.0.0/8" or
 * "loopback, uniquelocal" for a proxy in another container).
 * "true" deliberately isn't "1 hop": with 1 hop Express believes X-Forwarded-For from ANY peer, so
 * anyone who can reach the Node port directly picks their own IP and dodges every rate limit.
 */
export function parseTrustProxy(value) {
  if (value === undefined || value === null) return false;
  const v = String(value).trim();
  if (v === '' || v === 'false' || v === '0') return false;
  if (v === 'true') return 'loopback';
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * A warning for the startup log when X-Forwarded-For is trusted but the Node port may be reachable
 * directly (not bound to loopback) — then a client could pick its own IP. null when fine.
 */
export function trustProxyWarning(trustProxyEnv, host, port) {
  if (parseTrustProxy(trustProxyEnv) === false) return null;
  if (/^(127\.|::1$|localhost$)/.test(host ?? '')) return null;
  return `TRUST_PROXY is set but the server listens on ${host || 'all interfaces'}: make sure only your proxy can reach port ${port}`
    + ' (set HOST=127.0.0.1, or firewall the port) — otherwise clients can fake their IP address.';
}

const MULTIPART_ROUTES = [/^\/songs\/\d+\/audio\/?$/, /^\/shows\/\d+\/image\/?$/];

/** Human-readable timestamp + request line for log entries. */
const requestTag = (req) => `${new Date().toISOString()} ${req.method} ${req.originalUrl} user=${req.user?.id ?? '-'}`;

/**
 * @param {{ db: import('better-sqlite3').Database, uploadsDir: string, mediaDir: string,
 *   clientDistDir?: string|null, fetchImpl?: typeof fetch, env?: Record<string, string|undefined>,
 *   logger?: { info: Function, warn: Function, error: Function }, festivalsSeedPath?: string|null }} opts
 *   festivalsSeedPath: seed/festivals.json by default — loaded only while the festivals table is empty.
 */
export function createApp({
  db, uploadsDir, mediaDir, clientDistDir = null, fetchImpl = globalThis.fetch, env = process.env, logger = console,
  festivalsSeedPath = DEFAULT_FESTIVALS_SEED,
}) {
  if (!db) throw new Error('createApp: db is required');
  ensureUploadDirs(uploadsDir);
  fs.mkdirSync(mediaDir, { recursive: true });

  const adminEmails = parseAdminEmails(env.STAR_ADMIN_EMAILS);
  /** @type {AppContext} */
  const ctx = {
    db,
    uploadsDir,
    mediaDir,
    fetchImpl,
    env,
    cache: new TtlCache({ ttlMs: 60 * 60 * 1000, max: 500 }),
    catalogCache: new VersionedCache(() => catalogVersion(db)),
    limiters: createLimiters(env),
    caps: createDailyCaps(db, env),
    uploadGuard: createUploadGuard({ db, uploadsDir, env }),
    isAdminEmail: (email) => adminEmails.has(String(email).toLowerCase()),
    defaultFestivalSlug: () => null,
    log: {
      info: (...a) => logger.info?.(...a),
      warn: (...a) => logger.warn?.(...a),
      error: (...a) => logger.error?.(...a),
    },
  };

  // Festivals (SPEC §7b): an upgraded site gets the seed list on its first start (no re-import
  // needed); after that the table belongs to the admins. STAR_DEFAULT_FESTIVAL is checked now (so
  // a typo shows up in the startup log) and again on every /api/meta.
  seedFestivalsIfEmpty(db, festivalsSeedPath, ctx.log);
  ctx.defaultFestivalSlug = defaultFestivalResolver(db, env.STAR_DEFAULT_FESTIVAL, ctx.log);
  try {
    ctx.defaultFestivalSlug();
  } catch (err) {
    ctx.log.warn(`⚠️  Couldn't check STAR_DEFAULT_FESTIVAL: ${err.message}`);
  }

  // STAR_ADMIN_EMAILS: startup only, and only for accounts that existed when the email was listed
  // (signup doesn't prove anyone owns an address — see applyAdminEmails).
  const admins = applyAdminEmails(db, adminEmails);
  for (const u of admins.promoted) {
    ctx.log.info(`👑 STAR_ADMIN_EMAILS: account #${u.id} "${u.display_name}" <${u.email}> (signed up ${u.created_at}) is now an admin`);
  }
  for (const u of admins.tooNew) {
    ctx.log.warn(`⚠️  STAR_ADMIN_EMAILS: NOT promoting account #${u.id} "${u.display_name}" <${u.email}> — it signed up ${u.created_at},`
      + ` after that email was added to the list (${u.first_listed_at}), and anyone can sign up with any address.`
      + ` If it's really theirs, run: npm --prefix server run make-admin -- ${u.email}`);
  }
  for (const email of admins.missing) {
    ctx.log.info(`   STAR_ADMIN_EMAILS: no account for ${email} yet — have them sign up, then run make-admin`);
  }

  const maintenance = () => {
    try {
      purgeExpiredSessions(db);
      sweepIncoming(uploadsDir);
    } catch (err) {
      ctx.log.warn(`maintenance failed: ${err.message}`);
    }
  };
  maintenance();
  const maintenanceTimer = setInterval(maintenance, 60 * 60 * 1000);
  maintenanceTimer.unref();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));
  app.locals.ctx = ctx;
  app.locals.close = () => clearInterval(maintenanceTimer);

  if (env.STAR_ACCESS_LOG === '1' || env.STAR_ACCESS_LOG === 'true') {
    app.use((req, res, next) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        ctx.log.info(`${requestTag(req)} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
      next();
    });
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Only what the built client actually uses: its own bundled CSS/fonts, Apple previews and
          // art, Wikimedia posters. No external stylesheets/fonts, no frames.
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https://*.mzstatic.com', 'https://upload.wikimedia.org'],
          'media-src': ["'self'", 'blob:', 'https://*.itunes.apple.com', 'https://*.mzstatic.com'],
          'connect-src': ["'self'"],
          'font-src': ["'self'", 'data:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'frame-src': ["'none'"],
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ---- static files ----
  app.use('/media', express.static(mediaDir, { maxAge: '30d', index: false, dotfiles: 'ignore', redirect: false }));
  app.use('/media', (_req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use(
    '/uploads',
    express.static(uploadsDir, {
      maxAge: '7d',
      index: false,
      dotfiles: 'ignore',
      redirect: false,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
      },
    }),
  );
  app.use('/uploads', (_req, res) => res.status(404).type('text/plain').send('Not found'));

  // ---- API ----
  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '100kb' }));
  api.use(loadSession(db));
  api.use(csrfAndContentType({ isMultipartRoute: (req) => req.method === 'POST' && MULTIPART_ROUTES.some((re) => re.test(req.path)) }));
  api.use(requirePasswordChange);
  api.use(ctx.limiters.reads);
  api.use(ctx.limiters.writes);
  api.use('/auth', authRouter(ctx));
  api.use('/lookup', lookupRouter(ctx));
  api.use('/me', meRouter(ctx));
  api.use('/admin', adminRouter(ctx));
  api.use('/', commentsRouter(ctx));
  api.use('/songs', songsRouter(ctx));
  api.use('/shows', showsRouter(ctx));
  api.use('/festivals', festivalsRouter(ctx));
  api.use('/', metaRouter(ctx));
  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // ---- production client (SPA) ----
  if (clientDistDir && fs.existsSync(path.join(clientDistDir, 'index.html'))) {
    const indexHtml = path.join(clientDistDir, 'index.html');
    app.use(
      express.static(clientDistDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (/^\/(api|media|uploads)(\/|$)/.test(req.path)) return next();
      // Only app routes get index.html. A missing file (an old /assets/*.js chunk after a
      // redeploy, /favicon.ico, /robots.txt) must be a real 404, not HTML with status 200.
      if (/^\/assets(\/|$)/.test(req.path) || /\.[A-Za-z0-9]{1,8}$/.test(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));

  // ---- errors → { error, details? } ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (res.headersSent) {
      req.socket?.destroy();
      return;
    }
    if (err instanceof HttpError) {
      const payload = { error: err.message };
      if (err.details && Object.keys(err.details).length) payload.details = err.details;
      if (err.extra) Object.assign(payload, err.extra);
      return res.status(err.status).json(payload);
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON in request body' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported') return res.status(415).json({ error: 'Unsupported request encoding' });
    if (/^SQLITE_(BUSY|LOCKED)/.test(String(err?.code ?? ''))) {
      // Another process (an import, a manual SQL session, a backup tool) holds the write lock.
      ctx.log.warn(`${requestTag(req)} database busy: ${err.message}`);
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ error: 'The database is busy right now — please try again in a few seconds' });
    }
    // Client errors thrown by Express/router internals (e.g. a malformed %-escape in the URL → 400
    // URIError): answer with that status, and don't fill the log with stack traces for them.
    const status = Number(err?.status ?? err?.statusCode);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return res.status(status).json({ error: status === 404 ? 'Not found' : (http.STATUS_CODES[status] ?? 'Bad request') });
    }
    ctx.log.error(`${requestTag(req)} failed:\n${err?.stack ?? err}`);
    res.status(500).json({ error: 'Something went wrong on our side — please try again' });
  });

  return app;
}
