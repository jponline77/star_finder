// /api/festivals (public) and /api/admin/festivals (admin CRUD) — SPEC §7b.
import { Router } from 'express';
import { HttpError, notFound, badRequest } from '../lib/errors.js';
import { Validator, parseId } from '../lib/validate.js';
import {
  listFestivals, getFestivalRow, getFestivalRowBySlug, toFestival, validateFestivalFields, checkFestivalDates,
  festivalSlugFromName, insertFestival, updateFestival, changedFestivalFields, deleteFestival, clearFestivalTombstone,
} from '../lib/festivals.js';
import { nowIso } from '../db.js';

const wantsAll = (value) => ['1', 'true'].includes(String(Array.isArray(value) ? value[0] : value ?? '').toLowerCase());

/** GET /api/festivals → { festivals } (active only; admins may add ?all=1 to include hidden ones). */
export function festivalsRouter(ctx) {
  const { db } = ctx;
  const r = Router();
  r.get('/', (req, res) => {
    const includeInactive = req.user?.role === 'admin' && wantsAll(req.query.all);
    res.json({ festivals: listFestivals(db, { includeInactive }) });
  });
  return r;
}

const asBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Send the festival as a JSON object');
  return body;
};

/**
 * Mounted under the admin router (requireAdmin already applied):
 * GET / → { festivals } (hidden ones too); POST / → 201 Festival; PUT /:id (partial) → Festival;
 * DELETE /:id → 204.
 */
export function adminFestivalsRouter(ctx) {
  const { db } = ctx;
  const r = Router();

  const load = (req) => {
    const id = parseId(req.params.id);
    const row = id ? getFestivalRow(db, id) : null;
    if (!row) throw notFound('Festival not found');
    return row;
  };

  // Same as GET /api/festivals?all=1 for an admin.
  r.get('/', (_req, res) => {
    res.json({ festivals: listFestivals(db, { includeInactive: true }) });
  });

  r.post('/', (req, res) => {
    const body = asBody(req.body);
    const v = new Validator();
    const values = validateFestivalFields(v, body);
    checkFestivalDates(v, values);
    v.check();
    // The slug is made from the name once and never changes (share links use it).
    const slug = festivalSlugFromName(values.name);
    const clash = getFestivalRowBySlug(db, slug);
    if (clash) {
      const msg = `"${clash.name}" already uses the link name "${slug}" — choose a different name (or edit that festival)`;
      throw new HttpError(409, msg, { name: msg }, { existingId: clash.id });
    }
    const now = nowIso();
    let id;
    try {
      // Re-creating a festival that was deleted here makes it a normal (website-made) festival again.
      id = db.transaction(() => {
        clearFestivalTombstone(db, slug);
        return insertFestival(db, { ...values, slug }, { now, editedAt: now });
      })();
    } catch (err) {
      if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, `Another festival already uses the link name "${slug}"`, { name: 'Choose a different name' });
      throw err;
    }
    res.status(201).json(toFestival(getFestivalRow(db, id)));
  });

  r.put('/:id', (req, res) => {
    const row = load(req);
    const body = asBody(req.body);
    const v = new Validator();
    const values = validateFestivalFields(v, body, { partial: true });
    const current = toFestival(row);
    checkFestivalDates(v, { startDate: values.startDate !== undefined ? values.startDate : current.startDate, endDate: values.endDate !== undefined ? values.endDate : current.endDate });
    v.check();
    // Only a real change counts as an edit (a no-op save doesn't stop the import updating it).
    updateFestival(db, row.id, values, changedFestivalFields(row, values), { editedAt: nowIso() });
    res.json(toFestival(getFestivalRow(db, row.id)));
  });

  r.delete('/:id', (req, res) => {
    const row = load(req);
    // users.festival_id is ON DELETE SET NULL: people who chose it simply have no festival now.
    // The slug is remembered, so `npm run import` doesn't bring the festival back.
    deleteFestival(db, row, { now: nowIso() });
    res.status(204).end();
  });

  return r;
}
