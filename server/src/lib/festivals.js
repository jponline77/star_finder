// STAR festivals (SPEC §7b): validation, JSON serialization, the seed file and its upsert.
// Used by the API (routes/festivals.js, auth.js), app startup (seed an empty table) and
// `npm run import` (upsert by slug, keeping rows edited on the website).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Validator } from './validate.js';
import { slugify } from './slug.js';

export const FESTIVAL_KINDS = Object.freeze(['regional', 'online', 'national']);
/** Kinds a user can choose as "my festival" (nationals come after regionals). */
export const SELECTABLE_FESTIVAL_KINDS = Object.freeze(['regional', 'online']);

export const DEFAULT_FESTIVALS_SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed', 'festivals.json');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 60;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// camelCase API field → column
const COLUMNS = Object.freeze({
  name: 'name',
  kind: 'kind',
  province: 'province',
  city: 'city',
  startDate: 'start_date',
  endDate: 'end_date',
  dateLabel: 'date_label',
  venue: 'venue',
  infoUrl: 'info_url',
  sortOrder: 'sort_order',
  active: 'active',
});
export const FESTIVAL_FIELDS = Object.freeze(Object.keys(COLUMNS));

const TEXT_FIELDS = [
  ['province', 40, 'Province'],
  ['city', 120, 'City'],
  ['venue', 120, 'Venue'],
  ['dateLabel', 120, 'Date note'],
];
const DATE_FIELDS = [
  ['startDate', 'Start date'],
  ['endDate', 'End date'],
];

/** Festival row → API JSON (SPEC §7b `Festival`). */
export function toFestival(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    province: row.province ?? null,
    city: row.city ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    dateLabel: row.date_label ?? null,
    venue: row.venue ?? null,
    infoUrl: row.info_url ?? null,
    sortOrder: row.sort_order ?? 0,
    active: Boolean(row.active),
  };
}

/** true for a real calendar day written 'YYYY-MM-DD' (years 2000–2099). */
export function isCalendarDate(value) {
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2099) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function dateField(v, field, value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return v.error(field, `${label} must be a date like 2026-12-11`) ?? null;
  const s = value.trim();
  if (s === '') return null;
  if (!isCalendarDate(s)) return v.error(field, `${label} must be a real date like 2026-12-11`) ?? null;
  return s;
}

/**
 * Validate festival fields from a request body (or a seed entry). Collects errors in `v`.
 * Create (partial=false): name and kind are required; missing optional fields become null,
 * sortOrder 0 and active true. Update (partial=true): only fields present in `body` are returned.
 * Cross-field rule (endDate ≥ startDate) is checked by `checkFestivalDates` on the merged values.
 * @param {Validator} v
 * @param {Record<string, unknown>} body
 * @param {{ partial?: boolean }} [opts]
 * @returns {Record<string, unknown>} camelCase values for the fields given
 */
export function validateFestivalFields(v, body, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || body[k] !== undefined;
  if (has('name')) out.name = v.string('name', body.name, { required: true, min: 3, max: 80, label: 'Name' });
  if (has('kind')) out.kind = v.oneOf('kind', body.kind, FESTIVAL_KINDS, { required: true, label: 'Kind' });
  for (const [key, max, label] of TEXT_FIELDS) {
    if (has(key)) out[key] = v.string(key, body[key], { max, label });
  }
  for (const [key, label] of DATE_FIELDS) {
    if (has(key)) out[key] = dateField(v, key, body[key], label);
  }
  if (has('infoUrl')) out.infoUrl = v.httpsUrl('infoUrl', body.infoUrl, { max: 500, label: 'Info link' });
  if (has('sortOrder')) {
    out.sortOrder = v.integer('sortOrder', body.sortOrder, { min: -1_000_000, max: 1_000_000, label: 'Sort order' }) ?? 0;
  }
  if (has('active')) {
    if (body.active === undefined) out.active = true;
    else if (typeof body.active === 'boolean') out.active = body.active;
    else if (body.active === 0 || body.active === 1) out.active = body.active === 1;
    else v.error('active', 'active must be true or false');
  }
  return out;
}

/** endDate must not be before startDate (when both are set and valid). */
export function checkFestivalDates(v, { startDate, endDate }) {
  if (startDate && endDate && !('startDate' in v.details) && !('endDate' in v.details) && endDate < startDate) {
    v.error('endDate', "End date can't be before the start date");
  }
}

/**
 * The slug a new festival gets: slugify(name) without the "(National)"-style parentheses and the
 * "Regional STAR Fest" ending, so "Surrey Regional STAR Fest" → "surrey",
 * "Online Regional STAR Fest" → "online", "STAR Fest West (National)" → "star-fest-west"
 * (matches the seed file). Never empty; at most 60 characters.
 */
export function festivalSlugFromName(name) {
  const full = String(name ?? '');
  const short = full
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*(regional\s+)?star\s+fest(ival)?$/i, '')
    .replace(/\s+regional$/i, '');
  const cut = (s) => s.slice(0, SLUG_MAX).replace(/-+$/, '');
  return cut(slugify(short)) || cut(slugify(full)) || 'festival';
}

export const isFestivalSlug = (s) => typeof s === 'string' && s.length <= SLUG_MAX && SLUG_RE.test(s);

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------

// SPEC: sort_order, start_date, name — with undated ("to be announced") festivals after dated ones.
const ORDER = 'ORDER BY sort_order, start_date IS NULL, start_date, name COLLATE NOCASE, id';

/** Festivals as API JSON; active only unless `includeInactive`. */
export function listFestivals(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  return db.prepare(`SELECT * FROM festivals ${where} ${ORDER}`).all().map(toFestival);
}

export function getFestivalRow(db, id) {
  return db.prepare('SELECT * FROM festivals WHERE id = ?').get(id) ?? null;
}

export function getFestivalRowBySlug(db, slug) {
  return db.prepare('SELECT * FROM festivals WHERE slug = ?').get(slug) ?? null;
}

/** true when a user may choose this festival as theirs: active, and regional or online. */
export const isSelectableFestival = (row) => Boolean(row && row.active && SELECTABLE_FESTIVAL_KINDS.includes(row.kind));

/**
 * Validate a user's `festivalSlug` (PUT /api/auth/me, signup). Records errors on `field`.
 * @returns {number|null|undefined} festival id, null to clear, undefined when invalid
 */
export function validateFestivalChoice(v, db, value, field = 'festivalSlug') {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return v.error(field, 'Choose a festival from the list');
  const slug = value.trim().toLowerCase();
  if (slug === '') return null;
  const row = isFestivalSlug(slug) ? getFestivalRowBySlug(db, slug) : null;
  if (!row || !row.active) return v.error(field, "That festival isn't available — choose one from the list");
  if (!SELECTABLE_FESTIVAL_KINDS.includes(row.kind)) return v.error(field, 'Choose your regional festival (or the Online Regional)');
  return row.id;
}

/**
 * STAR_DEFAULT_FESTIVAL, checked on every call (admins can hide or delete festivals at any time).
 * Returns the slug when it names an active regional/online festival, else null; an invalid value
 * is logged once (again only after it has been valid in between).
 * @returns {() => string|null}
 */
export function defaultFestivalResolver(db, envValue, log) {
  const wanted = typeof envValue === 'string' ? envValue.trim().toLowerCase() : '';
  let warned = false;
  return () => {
    if (!wanted) return null;
    const row = isFestivalSlug(wanted) ? getFestivalRowBySlug(db, wanted) : null;
    if (isSelectableFestival(row)) {
      warned = false;
      return row.slug;
    }
    if (!warned) {
      warned = true;
      const choices = db.prepare(`SELECT slug FROM festivals WHERE active = 1 AND kind IN ('regional','online') ${ORDER}`).all().map((r) => r.slug);
      log?.warn?.(`⚠️  STAR_DEFAULT_FESTIVAL="${envValue}" doesn't match an active regional or online festival — ignoring it.`
        + ` Choices: ${choices.length ? choices.join(', ') : '(none)'}`);
    }
    return null;
  };
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

const toColumnValue = (key, value) => (key === 'active' ? (value ? 1 : 0) : value);

/**
 * Insert a festival. `values` are validated camelCase fields plus `slug`.
 * `editedAt` marks a row made on the website (the import then leaves it alone).
 * @returns {number} id
 */
export function insertFestival(db, values, { now = new Date().toISOString(), editedAt = null } = {}) {
  const cols = ['slug', ...FESTIVAL_FIELDS.map((k) => COLUMNS[k]), 'created_at', 'updated_at', 'edited_at'];
  const params = [values.slug, ...FESTIVAL_FIELDS.map((k) => toColumnValue(k, values[k] ?? (k === 'sortOrder' ? 0 : k === 'active' ? true : null))), now, now, editedAt];
  const sql = `INSERT INTO festivals (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

/**
 * Write `fields` of `values` to festival `id`. With `editedAt` (a website edit) updated_at and
 * edited_at are set to it; without (the import), the row is marked as not edited on the website.
 */
export function updateFestival(db, id, values, fields, { editedAt = null } = {}) {
  if (!fields.length && editedAt) return;
  const sets = fields.map((k) => `${COLUMNS[k]} = ?`);
  sets.push(editedAt ? 'updated_at = ?, edited_at = ?' : 'updated_at = created_at, edited_at = NULL');
  const params = [...fields.map((k) => toColumnValue(k, values[k])), ...(editedAt ? [editedAt, editedAt] : []), id];
  db.prepare(`UPDATE festivals SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Delete a festival on the website and remember its slug (festival_tombstones), so neither
 * `npm run import` nor startup seeding brings it back (unless --overwrite-edits).
 * users.festival_id is ON DELETE SET NULL: people who chose it simply have no festival now.
 */
export function deleteFestival(db, row, { now = new Date().toISOString() } = {}) {
  db.transaction(() => {
    db.prepare('DELETE FROM festivals WHERE id = ?').run(row.id);
    db.prepare('INSERT INTO festival_tombstones (slug, deleted_at) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET deleted_at = excluded.deleted_at')
      .run(row.slug, now);
  })();
}

/** true when an admin deleted the festival with this slug on the website. */
export const isFestivalTombstoned = (db, slug) => Boolean(db.prepare('SELECT 1 FROM festival_tombstones WHERE slug = ?').get(slug));

/** Forget that `slug` was deleted (it's being created again). */
export const clearFestivalTombstone = (db, slug) => db.prepare('DELETE FROM festival_tombstones WHERE slug = ?').run(slug);

/** The fields of `values` that differ from `row`. */
export function changedFestivalFields(row, values) {
  return FESTIVAL_FIELDS.filter((k) => values[k] !== undefined && toColumnValue(k, values[k]) !== (row[COLUMNS[k]] ?? null));
}

/** "Changed on the website": created there, or edited since it was seeded/imported. */
export const festivalEdited = (row) => Boolean(row.edited_at) || row.updated_at > row.created_at;

// ---------------------------------------------------------------------------------------------
// Seed file (server/seed/festivals.json: { festivals: [...] }, camelCase fields)
// ---------------------------------------------------------------------------------------------

/**
 * Read and validate the seed file. Invalid or duplicate entries are skipped with a warning.
 * Throws when the file isn't valid JSON or has the wrong shape; returns null when it's missing.
 * @param {string} file
 * @returns {{ entries: (Record<string, unknown> & { slug: string })[], warnings: string[] } | null}
 */
export function readFestivalSeed(file) {
  if (!file || !fs.existsSync(file)) return null;
  const name = path.basename(file);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
  const list = Array.isArray(json) ? json : json?.festivals;
  if (!Array.isArray(list)) throw new Error(`${name} must be { "festivals": [...] }`);
  const entries = [];
  const warnings = [];
  const seen = new Set();
  list.forEach((entry, i) => {
    const label = `${name} entry ${i + 1}${entry && typeof entry.name === 'string' ? ` "${entry.name}"` : ''}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(`${label}: not an object — skipped`);
      return;
    }
    const v = new Validator();
    const values = validateFestivalFields(v, entry);
    checkFestivalDates(v, values);
    let slug = null;
    if (entry.slug === undefined || entry.slug === null || entry.slug === '') {
      if (values.name) slug = festivalSlugFromName(values.name);
    } else if (isFestivalSlug(entry.slug)) {
      slug = entry.slug;
    } else {
      v.error('slug', 'slug must be lowercase letters, digits and dashes (at most 60)');
    }
    if (!v.ok) {
      warnings.push(`${label}: skipped — ${Object.entries(v.details).map(([k, m]) => `${k}: ${m}`).join('; ')}`);
      return;
    }
    if (seen.has(slug)) {
      warnings.push(`${label}: slug "${slug}" is used by an earlier entry — skipped`);
      return;
    }
    seen.add(slug);
    entries.push({ ...values, slug });
  });
  return { entries, warnings };
}

/**
 * Upsert seed festivals by slug (one transaction). Festivals changed on the website (created
 * there, or edited since they were seeded) are kept as they are, and festivals deleted there
 * (festival_tombstones) stay deleted, unless `overwriteEdits`.
 * Festivals that aren't in the seed are never deleted (users may have chosen them).
 * @returns {{ created: number, updated: number, unchanged: number, skippedEdited: number, skippedDeleted: number, notInSeed: number }}
 */
export function upsertFestivals(db, entries, { overwriteEdits = false, now = new Date().toISOString() } = {}) {
  const counts = { created: 0, updated: 0, unchanged: 0, skippedEdited: 0, skippedDeleted: 0, notInSeed: 0 };
  db.transaction(() => {
    for (const e of entries) {
      const row = getFestivalRowBySlug(db, e.slug);
      if (!row) {
        if (isFestivalTombstoned(db, e.slug)) {
          if (!overwriteEdits) {
            counts.skippedDeleted++;
            continue;
          }
          clearFestivalTombstone(db, e.slug);
        }
        insertFestival(db, e, { now });
        counts.created++;
        continue;
      }
      const edited = festivalEdited(row);
      if (edited && !overwriteEdits) {
        counts.skippedEdited++;
        continue;
      }
      const changed = changedFestivalFields(row, e);
      if (!changed.length && !edited) {
        counts.unchanged++;
        continue;
      }
      updateFestival(db, row.id, e, FESTIVAL_FIELDS);
      counts.updated++;
    }
    const slugs = JSON.stringify(entries.map((e) => e.slug));
    counts.notInSeed = db.prepare('SELECT count(*) AS n FROM festivals WHERE slug NOT IN (SELECT value FROM json_each(?))').get(slugs).n;
  })();
  return counts;
}

/**
 * App startup: when the festivals table is empty, fill it from the seed file (so upgrading an
 * existing site needs no re-import). Festivals an admin deleted stay deleted.
 * A missing or broken file is logged, never fatal.
 * @returns {number} festivals added
 */
export function seedFestivalsIfEmpty(db, file, log) {
  if (!file) return 0;
  try {
    if (db.prepare('SELECT count(*) AS n FROM festivals').get().n > 0) return 0;
    const seed = readFestivalSeed(file);
    if (!seed) {
      log?.warn?.(`⚠️  No festivals yet and ${file} was not found — add them on the Admin page (Festivals) or run \`npm run import\``);
      return 0;
    }
    for (const w of seed.warnings) log?.warn?.(`⚠️  ${w}`);
    const { created, skippedDeleted } = upsertFestivals(db, seed.entries);
    if (created) log?.info?.(`📍 Added ${created} STAR festival(s) from ${path.basename(file)}`);
    if (skippedDeleted) log?.info?.(`📍 ${skippedDeleted} festival(s) in ${path.basename(file)} were deleted on the website — not added again`);
    return created;
  } catch (err) {
    log?.warn?.(`⚠️  Couldn't load the STAR festivals from ${file}: ${err.message}`);
    return 0;
  }
}
