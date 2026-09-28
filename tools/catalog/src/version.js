// Catalog version numbers. The server reloads the catalog only when the file's `version` differs from the one it
// loaded last, so a version string must never be issued twice for different content — not even after the catalog
// file was restored to an older build (round 3: a reset from .12 back to .5 made the next build issue ".7" a second
// time, and databases that had loaded the first ".7" never picked up the new catalog).
//
// Every version issued is recorded with the SHA-256 of its content in a ledger: `tools/catalog/versions.json`
// (committed; builds written to the real seed directory) and `.cache/versions-issued.json` (local; every build,
// including trial builds written elsewhere with --out). A new version is `YYYY-MM-DD.N` with N one more than the
// highest N ever issued on that (UTC) day in either ledger or in the catalog file being replaced; content that was
// issued before keeps its version.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const VERSION_RE = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/;

/** SHA-256 (hex) of the catalog content that the version stands for (everything but version/generatedAt). */
export const contentHash = (body) => crypto.createHash('sha256').update(JSON.stringify({ sources: body.sources, shows: body.shows })).digest('hex');

/**
 * → { version, reused, generatedAt|null }
 * today: 'YYYY-MM-DD' (UTC); hash: contentHash of the new content; prev: { version, hash, generatedAt } of the file
 * being replaced, or null; issued: [{ version, sha256, generatedAt? }] from the ledgers.
 */
export function chooseVersion({ today, hash, prev = null, issued = [] }) {
  if (prev?.version && prev.hash === hash) return { version: prev.version, reused: true, generatedAt: prev.generatedAt ?? null };
  const same = issued.filter((e) => e.sha256 === hash && VERSION_RE.test(e.version ?? '')).at(-1);
  if (same) return { version: same.version, reused: true, generatedAt: same.generatedAt ?? null };
  let max = 0;
  for (const v of [prev?.version, ...issued.map((e) => e.version)]) {
    const m = String(v ?? '').match(VERSION_RE);
    if (m && m[1] === today) max = Math.max(max, Number(m[2]));
  }
  return { version: `${today}.${max + 1}`, reused: false, generatedAt: null };
}

/** Read a ledger file → its entries ([] when missing or unreadable). */
export function readLedger(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j.issued) ? j.issued.filter((e) => e && typeof e.version === 'string') : [];
  } catch { return []; }
}

const LEDGER_COMMENT = 'Every catalog version issued, with the SHA-256 of its content (JSON of { sources, shows }). Written by the build; ' +
  'do not edit or trim: a version string must never be issued twice for different content (see src/version.js). ' +
  'Entries with sha256 null were issued before this ledger existed.';

/** Append an entry to a ledger file (no duplicate version strings). */
export function recordVersion(file, entry) {
  const issued = readLedger(file);
  if (issued.some((e) => e.version === entry.version && e.sha256 === entry.sha256)) return;
  issued.push(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ _comment: LEDGER_COMMENT, issued }, null, 1) + '\n');
  fs.renameSync(tmp, file);
}
