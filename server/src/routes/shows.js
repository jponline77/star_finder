// /api/shows — list, detail, create/edit/delete, poster upload (SPEC §5, §5a).
import fs from 'node:fs';
import { Router } from 'express';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import { Validator, parseId, isWikipediaHost, isAllowedImageHost } from '../lib/validate.js';
import { slugify, uniqueSlug } from '../lib/slug.js';
import {
  singleFileUpload, sniffImage, saveBuffer, deleteIfUnreferenced, requireFile, removeTemp, IMAGE_MAX_BYTES,
} from '../lib/uploads.js';
import { stripImageMetadata } from '../lib/image-meta.js';
import { downloadRemoteImage } from '../lib/remote-image.js';
import { requireUser, canEdit } from '../middleware.js';
import {
  listShows, getShow, getShowDetail, findShowRow, showTombstoneKey, othersCommentCount,
} from '../repo.js';
import { nowIso } from '../db.js';

const NOT_YOURS = 'You can only edit shows you added';

// body key → [column, validator]
const FIELDS = {
  composer: ['composer', (v, x) => v.string('composer', x, { max: 120, label: 'Composer' })],
  lyricist: ['lyricist', (v, x) => v.string('lyricist', x, { max: 120, label: 'Lyricist' })],
  bookWriter: ['book_writer', (v, x) => v.string('bookWriter', x, { max: 120, label: 'Book writer' })],
  year: ['year', (v, x) => v.integer('year', x, { min: 1600, max: 2100, label: 'Year' })],
  licensor: ['licensor', (v, x) => v.string('licensor', x, { max: 120, label: 'Licensor' })],
  licensingNote: ['licensing_note', (v, x) => v.string('licensingNote', x, { max: 600, multiline: true, label: 'Licensing note' })],
  description: ['description', (v, x) => v.string('description', x, { max: 1200, multiline: true, label: 'Description' })],
  wikiUrl: ['wiki_url', (v, x) => v.httpsUrl('wikiUrl', x, { hosts: isWikipediaHost, hostMessage: 'Must be a Wikipedia link', max: 500, label: 'Wikipedia link' })],
  imageCredit: ['image_credit', (v, x) => v.string('imageCredit', x, { max: 200, label: 'Image credit' })],
};

/** @param {import('../app.js').AppContext} ctx */
export function showsRouter(ctx) {
  const { db, uploadsDir, caps, uploadGuard } = ctx;
  const r = Router();
  const slugTaken = db.prepare('SELECT 1 FROM shows WHERE slug = ?');
  const showById = db.prepare('SELECT * FROM shows WHERE id = ?');

  function findByIdParam(req) {
    const id = parseId(req.params.id);
    const row = id ? showById.get(id) : null;
    if (!row) throw notFound('Show not found');
    return row;
  }

  function loadEditable(req) {
    const row = findByIdParam(req);
    if (!canEdit(req.user, row)) throw forbidden(NOT_YOURS);
    return row;
  }

  function duplicateName(name, excludeId = -1) {
    return db.prepare('SELECT id FROM shows WHERE fold(name) = fold(?) AND id != ?').get(name, excludeId) ?? null;
  }

  const duplicateError = (id) =>
    conflict('That show is already on the list', { name: 'That show is already on the list', existingId: String(id) }, { existingId: id });

  /** Validate the given keys of a show body. `partial` = only keys present are returned. */
  function parseShowBody(body, { partial }) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object');
    const v = new Validator();
    const values = {};
    if (!partial || body.name !== undefined) {
      values.name = v.string('name', body.name, { required: true, max: 120, label: 'Show name' });
    }
    for (const [key, [col, fn]] of Object.entries(FIELDS)) {
      if (!partial || body[key] !== undefined) values[col] = fn(v, body[key]);
    }
    let imageUrl;
    if (body.imageUrl !== undefined) {
      if (body.imageUrl === null || body.imageUrl === '') imageUrl = null;
      else if (typeof body.imageUrl === 'string' && body.imageUrl.startsWith('/')) imageUrl = body.imageUrl.trim(); // current local image
      else {
        imageUrl = v.httpsUrl('imageUrl', body.imageUrl, {
          hosts: isAllowedImageHost, hostMessage: 'Images can only come from upload.wikimedia.org or Apple (mzstatic.com)', label: 'Image link',
        });
      }
    }
    v.check();
    return { values, imageUrl };
  }

  /** Download a poster into uploads/shows/ (owned by this show; deleted when replaced). */
  async function downloadImage(url, name) {
    try {
      const prefix = `${slugify(name) || 'show'}-`;
      return await downloadRemoteImage(url, { uploadsDir, subdir: 'shows', prefix, fetchImpl: ctx.fetchImpl });
    } catch (err) {
      throw badRequest("Couldn't download that image", { imageUrl: `Couldn't download that image: ${err.message}` });
    }
  }

  const defaultCredit = (url) => {
    try {
      const host = new URL(url).hostname;
      return host === 'upload.wikimedia.org' ? 'Image via Wikipedia / Wikimedia Commons' : 'Artwork via Apple Music';
    } catch {
      return null;
    }
  };

  r.get('/', (_req, res) => {
    res.json({ shows: listShows(db) });
  });

  r.get('/:idOrSlug', (req, res) => {
    const row = findShowRow(db, req.params.idOrSlug);
    if (!row) throw notFound('Show not found');
    res.json(getShowDetail(db, row.id));
  });

  r.post('/', requireUser, async (req, res) => {
    caps.checkShows(req.user);
    const { values, imageUrl } = parseShowBody(req.body, { partial: false });
    const dup = duplicateName(values.name);
    if (dup) throw duplicateError(dup.id);
    let imagePath = null;
    if (imageUrl && !imageUrl.startsWith('/')) imagePath = await downloadImage(imageUrl, values.name);
    let id;
    try {
      id = db.transaction(() => {
        const again = duplicateName(values.name);
        if (again) throw duplicateError(again.id);
        const slug = uniqueSlug(values.name, (s) => Boolean(slugTaken.get(s)));
        const now = nowIso();
        return Number(db.prepare(`
          INSERT INTO shows (name, slug, composer, lyricist, book_writer, year, licensor, licensing_note, description,
            wiki_url, image_path, image_credit, image_source_url, source, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'community', ?, ?, ?)`).run(
          values.name, slug, values.composer, values.lyricist, values.book_writer, values.year, values.licensor,
          values.licensing_note, values.description, values.wiki_url, imagePath,
          imagePath ? values.image_credit ?? defaultCredit(imageUrl) : values.image_credit, imagePath ? imageUrl : null,
          req.user.id, now, now,
        ).lastInsertRowid);
      })();
    } catch (err) {
      if (imagePath) await deleteIfUnreferenced(db, uploadsDir, imagePath);
      throw err;
    }
    res.status(201).json(getShow(db, id));
  });

  // Partial update: only keys present in the body change. `imageUrl: null` removes the image.
  r.put('/:id', requireUser, async (req, res) => {
    const row = loadEditable(req);
    const { values, imageUrl } = parseShowBody(req.body, { partial: true });
    if (values.name !== undefined) {
      const dup = duplicateName(values.name, row.id);
      if (dup) throw duplicateError(dup.id);
    }
    const sets = { ...values };
    let downloaded = null;
    if (imageUrl !== undefined && imageUrl !== row.image_path) {
      if (imageUrl === null) {
        Object.assign(sets, { image_path: null, image_credit: null, image_source_url: null });
      } else if (imageUrl.startsWith('/')) {
        throw badRequest('Please fix the highlighted fields', { imageUrl: 'Image link must be https' });
      } else if (!(row.image_path && imageUrl === row.image_source_url)) {
        // (the same source link again = the poster we already have — don't download a copy)
        downloaded = await downloadImage(imageUrl, values.name ?? row.name);
        sets.image_path = downloaded;
        sets.image_source_url = imageUrl;
        if (values.image_credit === undefined) sets.image_credit = defaultCredit(imageUrl);
      }
    }
    if (values.name !== undefined && slugify(values.name) !== slugify(row.name)) {
      sets.slug = uniqueSlug(values.name, (s) => s !== row.slug && Boolean(slugTaken.get(s)));
    }
    let result;
    try {
      result = db.transaction(() => {
        const current = showById.get(row.id); // it may have changed while the image downloaded
        if (!current) throw notFound('Show not found');
        if (values.name !== undefined) {
          const again = duplicateName(values.name, row.id);
          if (again) throw duplicateError(again.id);
        }
        const cols = Object.keys(sets).filter((c) => (current[c] ?? null) !== (sets[c] ?? null));
        // A save that changes nothing isn't an edit (the importer keeps edited spreadsheet rows as they are).
        if (!cols.length) return { oldImage: null };
        const now = nowIso();
        db.prepare(`UPDATE shows SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, edited_at = ? WHERE id = ?`)
          .run(...cols.map((c) => sets[c]), now, now, row.id);
        return { oldImage: cols.includes('image_path') ? current.image_path : null };
      })();
    } catch (err) {
      if (downloaded) await deleteIfUnreferenced(db, uploadsDir, downloaded);
      throw err;
    }
    if (result.oldImage) await deleteIfUnreferenced(db, uploadsDir, result.oldImage);
    res.json(getShow(db, row.id));
  });

  r.delete('/:id', requireUser, async (req, res) => {
    const row = loadEditable(req);
    const n = db.prepare('SELECT count(*) AS n FROM songs WHERE show_id = ?').get(row.id).n;
    if (n > 0) throw conflict(`This show still has ${n} song${n === 1 ? '' : 's'} — delete or move them first`, { songCount: String(n) });
    if (req.user.role !== 'admin') {
      // Deleting cascades to comments; only an admin may remove other people's comments.
      const c = othersCommentCount(db, { showId: row.id, userId: req.user.id });
      if (c > 0) {
        throw conflict(`This show has ${c} comment${c === 1 ? '' : 's'} from other people — ask an admin to remove it`, { commentCount: String(c) });
      }
    }
    db.transaction(() => {
      if (row.source === 'spreadsheet') {
        db.prepare("INSERT OR REPLACE INTO import_tombstones (kind, import_key, deleted_at) VALUES ('show', ?, ?)")
          .run(showTombstoneKey(row), nowIso());
      }
      db.prepare('DELETE FROM shows WHERE id = ?').run(row.id);
    })();
    await deleteIfUnreferenced(db, uploadsDir, row.image_path);
    res.status(204).end();
  });

  const imageUpload = singleFileUpload(IMAGE_MAX_BYTES, uploadsDir);
  r.post('/:id/image', requireUser, (req, _res, next) => {
    loadEditable(req); // 401/403/404 before the body is read
    next();
  }, uploadGuard.before, imageUpload, async (req, res) => {
    const file = requireFile(req);
    let show;
    try {
      const row = loadEditable(req);
      const bytes = await fs.promises.readFile(file.path); // ≤ 5 MB
      const kind = sniffImage(bytes);
      if (!kind) throw badRequest('Images must be JPEG, PNG, WebP or GIF', { file: 'Unsupported image type' });
      // Phone photos carry GPS position, camera serials and timestamps — never publish those.
      const clean = stripImageMetadata(bytes, kind.ext);
      if (!clean) throw badRequest("That image file looks damaged — try saving it again as a JPEG or PNG", { file: 'Damaged image' });
      uploadGuard.checkQuota(req.user, { newBytes: clean.length, ownerId: row.created_by, replacedPath: row.image_path });
      const publicPath = await saveBuffer(uploadsDir, 'images', clean, kind.ext, '/uploads');
      let previous;
      try {
        // Read the current poster and swap it in one step, so overlapping uploads can't orphan a file.
        previous = db.transaction(() => {
          const current = showById.get(row.id);
          if (!current) throw notFound('Show not found');
          db.prepare('UPDATE shows SET image_path = ?, image_credit = ?, image_source_url = NULL, updated_at = ? WHERE id = ?')
            .run(publicPath, `Uploaded by ${req.user.display_name}`, nowIso(), row.id);
          return current.image_path;
        })();
      } catch (err) {
        await deleteIfUnreferenced(db, uploadsDir, publicPath);
        throw err;
      }
      if (previous && previous !== publicPath) await deleteIfUnreferenced(db, uploadsDir, previous);
      show = getShow(db, row.id);
    } finally {
      await removeTemp(file); // before answering, so nothing is left behind once the client sees the result
    }
    res.json(show);
  });

  return r;
}
