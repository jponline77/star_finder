#!/usr/bin/env node
// Load the show & song catalog (SPEC §7c) into the database now, even if its version hasn't changed.
//   npm --prefix server run catalog:load                 # server/seed/catalog/catalog.json.gz (or STAR_CATALOG_PATH)
//   npm --prefix server run catalog:load -- other.json.gz
//   npm --prefix server run catalog:load -- --if-changed # only when the file changed (what startup does)
//   npm --prefix server run catalog:load -- --force      # also accept a file with far fewer shows/songs
// The server does this by itself at startup when the file's contents change, so a deploy needs no
// extra step; this is for maintainers (e.g. after `npm run catalog:build`). Safe while the server
// runs: the load is one transaction (a few seconds for ~100k songs — website changes wait or get a
// "try again" meanwhile). Only the catalog tables and the site rows' catalog links are written.
// A file with less than half the loaded shows or songs (a broken build, a truncated file, the test
// fixture) is refused unless --force: it would delete the catalog and every site link.
// Exit code 1 if the file is missing, broken or refused (nothing is changed then).
import fs from 'node:fs';
import { openDb, DEFAULT_DB_PATH } from '../src/db.js';
import { resolveUserPath } from '../src/lib/paths.js';
import { loadCatalog, catalogPathFromEnv } from '../src/lib/catalog.js';

const env = process.env;
const args = process.argv.slice(2);
const ifChanged = args.includes('--if-changed');
const allowShrink = args.includes('--force');
const fileArg = args.find((a) => !a.startsWith('--'));
const file = fileArg ? resolveUserPath(fileArg, env) : catalogPathFromEnv(env);
const dbPath = env.STAR_DB_PATH ? resolveUserPath(env.STAR_DB_PATH, env) : DEFAULT_DB_PATH;
const n = (x) => Number(x).toLocaleString('en-CA');

if (!fs.existsSync(dbPath)) {
  console.error(`❌ No database at ${dbPath} (run npm run import first, or set STAR_DB_PATH)`);
  process.exit(1);
}
// A long busy timeout: wait for a running server's writes instead of failing.
const db = openDb(dbPath, { busyTimeoutMs: 30_000 });
try {
  console.log(`📚 Loading ${file}\n   into ${dbPath}`);
  const r = loadCatalog(db, file, { force: !ifChanged, allowShrink });
  if (!r.loaded) {
    console.log(`✅ Catalog ${r.version} is already loaded (${n(r.shows)} shows, ${n(r.songs + r.recordingSongs)} songs) — nothing to do`);
  } else {
    console.log(`✅ Catalog ${r.version} loaded in ${(r.ms / 1000).toFixed(1)} s${r.previousVersion ? ` (was ${r.previousVersion})` : ''}`);
    console.log(`   ${n(r.shows)} shows, ${n(r.songs)} songs from the song lists, ${n(r.recordingSongs)} kept from cast albums`
      + (r.merged ? ` (${n(r.merged)} merged into the song lists)` : ''));
    if (r.removed.shows || r.removed.songs) console.log(`   removed ${n(r.removed.shows)} shows and ${n(r.removed.songs)} songs that are no longer in the file`);
    if (r.retired) console.log(`   ${n(r.retired)} show(s) no longer in the file kept as retired (site data points at them; hidden from search)`);
    if (r.recordingCleared) console.log(`   ${n(r.recordingCleared)} cast-album song(s) removed from shows that now have a song list`);
    if (r.linksLost.shows || r.linksLost.songs) {
      console.log(`   ⚠️  ${n(r.linksLost.shows)} site show link(s) and ${n(r.linksLost.songs)} site song link(s) pointed at removed rows (re-linked by title where possible)`);
    }
    const s = r.skipped;
    if (s.shows || s.songs || s.duplicateShows || s.duplicateSongs) {
      console.log(`   ⚠️  skipped ${n(s.shows)} show(s) without key/title, ${n(s.songs)} song(s) without a title, `
        + `${n(s.duplicateShows)} duplicate show(s), ${n(s.duplicateSongs)} duplicate song(s)`);
    }
    console.log(`   site links: ${r.links.showsLinked}/${r.links.shows} shows and ${r.links.songsLinked}/${r.links.songs} songs are linked to the catalog`);
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  if (err.code === 'missing') console.error('   Build it with `npm run catalog:build` (needs internet), or pass the path of a catalog.json.gz file.');
  process.exitCode = 1;
} finally {
  db.close();
}
