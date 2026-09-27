// /api/health, /api/meta, /api/stats, /api/export.xlsx
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { fold, formatLength } from '../lib/text.js';
import {
  VOCAL_RANGES, GENRES, TIME_LIMIT_SECONDS, WARN_SECONDS, matchExisting,
} from '../lib/vocab.js';
import { listSongs, subGenreSummary, distinctGenres } from '../repo.js';
import { listFestivals } from '../lib/festivals.js';

export const LENGTH_BUCKETS = [
  { label: 'Under 2:00', min: 0, max: 119 },
  { label: '2:00–2:59', min: 120, max: 179 },
  { label: '3:00–3:59', min: 180, max: 239 },
  { label: '4:00–4:59', min: 240, max: 299 },
  { label: '5:00–5:30', min: 300, max: WARN_SECONDS },
  { label: '5:31–6:00', min: WARN_SECONDS + 1, max: TIME_LIMIT_SECONDS },
  { label: 'Over 6:00', min: TIME_LIMIT_SECONDS + 1, max: null },
];

const sortedCounts = (map) =>
  [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || fold(a.label).localeCompare(fold(b.label)));

/** @param {import('../app.js').AppContext} ctx */
export function metaRouter(ctx) {
  const { db, catalogCache, limiters } = ctx;
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  r.get('/meta', (_req, res) => {
    const genres = [...GENRES];
    for (const g of distinctGenres(db)) {
      if (matchExisting(g, genres) === g && !genres.includes(g)) genres.push(g);
    }
    genres.sort((a, b) => fold(a).localeCompare(fold(b)));
    const counts = db.prepare(`
      SELECT count(*) AS songs, sum(kind = 'solo') AS solos, sum(kind = 'duet') AS duets,
        (SELECT count(*) FROM shows) AS shows FROM songs`).get();
    res.json({
      vocalRanges: [...VOCAL_RANGES],
      genres,
      subGenres: subGenreSummary(db),
      shows: db.prepare('SELECT id, name, slug FROM shows ORDER BY fold(name), id').all(),
      counts: { songs: counts.songs ?? 0, solos: counts.solos ?? 0, duets: counts.duets ?? 0, shows: counts.shows ?? 0 },
      timeLimitSeconds: TIME_LIMIT_SECONDS,
      warnSeconds: WARN_SECONDS,
      // SPEC §7b: every active festival (regional, online and national) + the site's default choice.
      festivals: listFestivals(db),
      defaultFestivalSlug: ctx.defaultFestivalSlug(),
    });
  });

  // Aggregated in SQL and cached until the catalogue changes (it used to load every song per request).
  function computeStats() {
    const all = (sql) => db.prepare(sql).all();
    const toMap = (rows) => new Map(rows.map((r) => [r.label, r.n]));
    const byRange = new Map(VOCAL_RANGES.map((v) => [v, 0]));
    for (const r of all(`SELECT vocal_range AS label, count(DISTINCT song_id) AS n FROM song_parts
      WHERE vocal_range IS NOT NULL GROUP BY vocal_range`)) byRange.set(r.label, (byRange.get(r.label) ?? 0) + r.n);
    const byKind = new Map([['solo', 0], ['duet', 0]]);
    for (const r of all('SELECT kind AS label, count(*) AS n FROM songs GROUP BY kind')) byKind.set(r.label, r.n);
    const buckets = LENGTH_BUCKETS.map((b) => ({ ...b, count: 0 }));
    let unknownLength = 0;
    let overLimit = 0;
    for (const { len, n } of all('SELECT length_seconds AS len, count(*) AS n FROM songs GROUP BY length_seconds')) {
      if (len === null) {
        unknownLength += n;
        continue;
      }
      const b = buckets.find((x) => len >= x.min && (x.max === null || len <= x.max));
      if (b) b.count += n;
      if (len > TIME_LIMIT_SECONDS) overLimit += n;
    }
    const totals = db.prepare('SELECT count(*) AS total, coalesce(sum(mature), 0) AS mature, coalesce(sum(preview_url IS NOT NULL), 0) AS withPreview FROM songs').get();
    const lengthBuckets = buckets.map(({ label, count, min, max }) => ({ label, count, min, max }));
    if (unknownLength) lengthBuckets.push({ label: 'Unknown', count: unknownLength, min: null, max: null });
    return {
      byGenre: sortedCounts(toMap(all('SELECT genre AS label, count(*) AS n FROM songs WHERE genre IS NOT NULL GROUP BY genre'))),
      bySubGenre: sortedCounts(toMap(all('SELECT sub_genre AS label, count(*) AS n FROM songs WHERE sub_genre IS NOT NULL GROUP BY sub_genre'))),
      byRange: [...byRange.entries()].map(([label, count]) => ({ label, count })),
      byShow: sortedCounts(toMap(all('SELECT sh.name AS label, count(*) AS n FROM songs s JOIN shows sh ON sh.id = s.show_id GROUP BY s.show_id'))),
      byKind: [...byKind.entries()].map(([label, count]) => ({ label, count })),
      lengthBuckets,
      mature: { yes: totals.mature, no: totals.total - totals.mature },
      overLimit,
      withPreview: totals.withPreview,
      total: totals.total,
    };
  }

  r.get('/stats', (_req, res) => {
    res.json(catalogCache.get('stats', computeStats));
  });

  async function buildWorkbook() {
    const { songs } = listSongs(db, { sort: 'show' });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'STAR Song Finder';
    wb.created = new Date();
    const solos = wb.addWorksheet('Solos');
    const duets = wb.addWorksheet('Duets');
    solos.columns = [
      { header: 'Song', width: 40 }, { header: 'Character', width: 24 }, { header: 'Show', width: 36 },
      { header: 'Genre', width: 12 }, { header: 'Sub-Genre', width: 20 }, { header: 'Vocal Range', width: 16 },
      { header: 'Length', width: 9 }, { header: 'Mature Content?', width: 16 }, { header: 'Added by', width: 14 },
    ];
    duets.columns = [
      { header: 'Song', width: 40 }, { header: 'Show', width: 36 }, { header: 'Character 1', width: 24 },
      { header: 'Character 2', width: 24 }, { header: 'Genre', width: 12 }, { header: 'Sub-Genre', width: 20 },
      { header: 'Vocal Range 1', width: 16 }, { header: 'Vocal Range 2', width: 16 }, { header: 'Length', width: 9 },
      { header: 'Mature Content?', width: 16 }, { header: 'Added by', width: 14 },
    ];
    for (const ws of [solos, duets]) {
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }
    const txt = (v) => (v === null || v === undefined ? '' : String(v));
    for (const s of songs) {
      const p1 = s.parts.find((p) => p.position === 1) ?? {};
      const p2 = s.parts.find((p) => p.position === 2) ?? {};
      const common = {
        length: formatLength(s.lengthSeconds),
        mature: s.mature ? 'Yes' : 'No',
        addedBy: s.source === 'spreadsheet' ? 'Spreadsheet' : 'Community',
      };
      if (s.kind === 'solo') {
        solos.addRow([s.title, txt(p1.character), s.show.name, txt(s.genre), txt(s.subGenre), txt(p1.vocalRange), common.length, common.mature, common.addedBy]);
      } else {
        duets.addRow([s.title, s.show.name, txt(p1.character), txt(p2.character), txt(s.genre), txt(s.subGenre), txt(p1.vocalRange), txt(p2.vocalRange), common.length, common.mature, common.addedBy]);
      }
    }
    // Lengths are text ("2:33"), never Excel times.
    solos.getColumn(7).numFmt = '@';
    duets.getColumn(9).numFmt = '@';
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // Built once per catalogue version (and rate limited): it's the most expensive response we have.
  r.get('/export.xlsx', limiters.exports, async (_req, res) => {
    const buffer = await catalogCache.get('export.xlsx', buildWorkbook);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="star-songs.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  });

  return r;
}
