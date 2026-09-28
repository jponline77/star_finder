// /api/me/contributions and /api/admin/* (SPEC §5c).
import { Router } from 'express';
import { HttpError, notFound, badRequest } from '../lib/errors.js';
import { Validator, parseId } from '../lib/validate.js';
import { hashPassword, temporaryPassword, TEMP_PASSWORD_TTL_MS } from '../lib/auth.js';
import { requireUser, requireAdmin } from '../middleware.js';
import {
  listSongs, listShows, listComments, listAdminUsers, getAdminUser, getUserRow, listRecentComments,
} from '../repo.js';
import { adminFestivalsRouter } from './festivals.js';
import { toCatalogShow } from './catalog.js';
import { clearCatalogShowRecording } from '../lib/catalog-recordings.js';

/** @param {import('../app.js').AppContext} ctx */
export function meRouter(ctx) {
  const { db } = ctx;
  const r = Router();
  r.get('/contributions', requireUser, (req, res) => {
    res.json({
      songs: listSongs(db, { createdBy: req.user.id, sort: 'newest' }).songs,
      shows: listShows(db, { createdBy: req.user.id }),
      comments: listComments(db, { userId: req.user.id }),
    });
  });
  return r;
}

/** @param {import('../app.js').AppContext} ctx */
export function adminRouter(ctx) {
  const { db } = ctx;
  const r = Router();
  r.use(requireAdmin);

  const activeAdminCount = () => db.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n;

  r.get('/users', (_req, res) => {
    res.json({ users: listAdminUsers(db) });
  });

  r.patch('/users/:id', (req, res) => {
    const id = parseId(req.params.id);
    const target = id ? getUserRow(db, id) : null;
    if (!target) throw notFound('User not found');
    const body = req.body ?? {};
    const v = new Validator();
    const role = body.role !== undefined ? v.oneOf('role', body.role, ['user', 'admin'], { required: true, label: 'Role' }) : target.role;
    let disabled = Boolean(target.disabled);
    if (body.disabled !== undefined) {
      if (typeof body.disabled !== 'boolean') v.error('disabled', 'disabled must be true or false');
      else disabled = body.disabled;
    }
    v.check();
    if (disabled && target.id === req.user.id) throw new HttpError(409, "You can't disable your own account");
    if (target.role === 'admin' && role !== 'admin' && ctx.isAdminEmail(target.email)) {
      // The server makes listed emails admins again at every start, so a demotion here wouldn't stick.
      throw new HttpError(409, 'This account is listed in STAR_ADMIN_EMAILS on the server — remove it there first (or disable the account instead)');
    }
    const wasActiveAdmin = target.role === 'admin' && !target.disabled;
    const staysActiveAdmin = role === 'admin' && !disabled;
    if (wasActiveAdmin && !staysActiveAdmin && activeAdminCount() <= 1) {
      throw new HttpError(409, "You can't remove the last admin — make someone else an admin first");
    }
    db.transaction(() => {
      db.prepare('UPDATE users SET role = ?, disabled = ? WHERE id = ?').run(role, disabled ? 1 : 0, target.id);
      if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    })();
    res.json(getAdminUser(db, target.id));
  });

  r.post('/users/:id/reset-password', async (req, res) => {
    const id = parseId(req.params.id);
    const target = id ? getUserRow(db, id) : null;
    if (!target) throw notFound('User not found');
    // Resetting yourself would log you out and replace your password with one shown only once.
    if (target.id === req.user.id) throw new HttpError(409, 'Change your own password in My stuff');
    const temp = temporaryPassword();
    const hash = await hashPassword(temp);
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString();
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, temp_password_expires_at = ? WHERE id = ?').run(hash, expiresAt, target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    })();
    res.json({ temporaryPassword: temp, expiresAt });
  });

  r.get('/comments', (req, res) => {
    const raw = req.query.limit;
    let limit = 100;
    if (raw !== undefined) {
      limit = Number(Array.isArray(raw) ? raw[0] : raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw badRequest('limit must be between 1 and 1000', { limit: 'Must be 1–1000' });
    }
    res.json({ comments: listRecentComments(db, limit) });
  });

  r.use('/festivals', adminFestivalsRouter(ctx));

  // ---- catalog moderation (SPEC §7c): cast albums / cast-album songs saved from Apple ----
  // Everything users saved for catalog shows, newest first: which album, how many songs, by whom.
  r.get('/catalog/recordings', (_req, res) => {
    const rows = db.prepare(`SELECT sh.*, u.display_name AS saved_by_name,
        (SELECT count(*) FROM catalog_songs cs WHERE cs.show_id = sh.id AND cs.source = 'recording') AS recording_songs
      FROM catalog_shows sh LEFT JOIN users u ON u.id = sh.itunes_saved_by
      WHERE sh.itunes_collection_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM catalog_songs cs WHERE cs.show_id = sh.id AND cs.source = 'recording')
      ORDER BY sh.itunes_saved_at IS NULL, sh.itunes_saved_at DESC, sh.id`).all();
    res.json({
      shows: rows.map((row) => ({
        id: row.id,
        key: row.key,
        title: row.title,
        year: row.year ?? null,
        castAlbum: toCatalogShow(row).castAlbum,
        recordingSongs: row.recording_songs,
        savedAt: row.itunes_saved_at ?? null,
        savedBy: row.itunes_saved_by ? { id: row.itunes_saved_by, displayName: row.saved_by_name ?? null } : null,
        retired: Boolean(row.retired),
      })),
    });
  });

  // Remove a show's saved cast album and cast-album songs (e.g. the wrong album, or offensive track
  // names). The album is remembered as rejected for that show so it isn't picked again (?reject=0
  // to allow it later). Site songs linked to the removed songs just lose the link.
  r.delete('/catalog/shows/:id/recording', (req, res) => {
    const id = parseId(req.params.id);
    const reject = !['0', 'false', 'no'].includes(String(req.query.reject ?? '').toLowerCase());
    const result = id ? clearCatalogShowRecording(db, id, { reject, userId: req.user.id }) : null;
    if (!result) throw notFound('Show not found in the catalog');
    const row = db.prepare('SELECT * FROM catalog_shows WHERE id = ?').get(id);
    ctx.log.info(`catalog: admin #${req.user.id} removed the cast album${result.collectionId ? ` ${result.collectionId}` : ''} and ${result.removedSongs} cast-album song(s) of catalog show #${id} “${row.title}”${result.rejected ? ' (album rejected for this show)' : ''}`);
    res.json({ show: toCatalogShow(row), removedSongs: result.removedSongs, rejectedCollectionId: result.rejected ? result.collectionId : null });
  });

  return r;
}
