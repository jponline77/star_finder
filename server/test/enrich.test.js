// scripts/enrich.js: title matching, album classification, the throttled/cached iTunes fetch, and an
// offline end-to-end run (fake iTunes + fake image CDN) against a temp DB.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { insertShow, insertSong } from './helpers.js';
import { matchTitle, classifyAlbum, albumLead, makeItunesFetch, main } from '../scripts/enrich.js';
import { isUnwantedAlbum, showInfo } from '../src/lib/itunes-albums.js';

const tmpDirs = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-enrich-'));
  tmpDirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('matchTitle', () => {
  test('exact, punctuation and parenthetical variants', () => {
    assert.equal(matchTitle('Flowers', 'Flowers').level, 100);
    assert.equal(matchTitle('Suddenly Seymour', 'Suddenly, Seymour').level, 100);
    assert.equal(matchTitle('The Confrontation', 'Confrontation').level, 96);
    assert.equal(matchTitle('If You Could See Her (The Gorilla Song)', 'If You Could See Her').level, 94);
    assert.equal(matchTitle("I Don't Know Why I Trust You", "I Don't Know Why I Trust You (But I Do)").level, 94);
  });

  test('sections, medleys, subtitles and aliases', () => {
    assert.equal(matchTitle('Prologue: What Have I Done?', 'What Have I Done?').level, 90);
    assert.equal(matchTitle("Javert's Suicide: Soliloquy", "Javert's Suicide").level, 90);
    assert.equal(matchTitle('I Know Those Eyes / This Man Is Dead', 'I Know Those Eyes/This Man Is Dead').level, 100);
    assert.equal(matchTitle('The Dinghy Song', 'Problematical Solution (The Dinghy Song)').level, 88);
    assert.equal(matchTitle('Dinghy', 'Problematical Solution (The Dinghy Song)', ['Dinghy']).level, 88);
    assert.equal(matchTitle('I Know Those Eyes', 'I Know Those Eyes / This Man Is Dead').level, 78, 'partial medley is only medium');
  });

  test('never crosses reprise, act/part or numbered variants; demos/intros are demoted', () => {
    assert.equal(matchTitle('Agony (Reprise)', 'Agony'), null);
    assert.equal(matchTitle('Agony', 'Agony (Reprise)'), null);
    assert.equal(matchTitle('Epic III', 'Epic II'), null);
    assert.equal(matchTitle('Say Goodbye (Act One)', 'Say Goodbye (Act Two)'), null);
    assert.equal(matchTitle('Say Goodbye', 'Say Goodbye (Act Two)'), null);
    assert.equal(matchTitle('Stars (Demo)', 'Stars'), null);
    assert.equal(matchTitle('Not a Day Goes By (Intro)', 'Not a Day Goes By'), null);
    assert.equal(matchTitle('Somewhere', 'Somewhere That\'s Green'), null);
  });
});

describe('isUnwantedAlbum / showInfo', () => {
  test('the karaoke/cover/foreign-cast lists apply to albums that do not name the show', () => {
    assert.equal(isUnwantedAlbum({ collectionName: 'Broadway Karaoke Hits', artistName: 'x' }), true);
    assert.equal(isUnwantedAlbum({ collectionName: 'Songs in the Style of Wicked', artistName: 'x' }), true);
    assert.equal(isUnwantedAlbum({ collectionName: 'Musicals', artistName: 'Seoul Musical Company' }), true);
    assert.equal(isUnwantedAlbum({ collectionName: 'Songs from Bat Boy and Other Stories', artistName: 'Jane Doe' }), false);
  });

  test('the Apple search term drops Spanish ¡ ¿ and !', () => {
    assert.equal(showInfo('¡Americano!').base, 'Americano');
    assert.equal(showInfo('Oklahoma!').base, 'Oklahoma');
    assert.equal(showInfo('The Book of Mormon').base, 'Book of Mormon');
  });
});

describe('classifyAlbum', () => {
  const info = (show, cfg = {}, leads = []) => ({ leads: [albumLead(show), ...leads], cfg: { leads, ...cfg } });

  test('album must be named after the show', () => {
    const cab = info('Cabaret', { film: true });
    assert.equal(classifyAlbum({ collectionName: 'Cabaret (Original Broadway Cast Recording)', artistName: 'x' }, cab).tier, 100);
    assert.equal(classifyAlbum({ collectionName: 'A Kurt Weill Cabaret (Original Cast Recording)', artistName: 'x' }, cab), null);
    assert.equal(classifyAlbum({ collectionName: "Monty Python's Spamalot : UK Cast Album", artistName: 'x' }, info("Monty Python's Spamalot")).tier, 88);
    assert.equal(classifyAlbum({ collectionName: "Disney's The Hunchback of Notre Dame (Studio Cast Recording)", artistName: 'x' }, info('The Hunchback of Notre Dame')).tier, 82);
    assert.equal(classifyAlbum({ collectionName: 'The War: A Ken Burns Film - The Soundtrack', artistName: 'x' }, info('Mr. Burns, a Post-Electric Play', {}, ['mr burns'])), null);
  });

  test('rejects karaoke/tribute/foreign casts; films only when the show was filmed', () => {
    const h = info('Hadestown');
    assert.equal(classifyAlbum({ collectionName: 'Hadestown (Karaoke Version)', artistName: 'x' }, h), null);
    assert.equal(classifyAlbum({ collectionName: 'Hadestown: A Tribute', artistName: 'x' }, h), null);
    assert.equal(classifyAlbum({ collectionName: 'Hadestown (Original Broadway Cast Recording)', artistName: 'Karaoke Kings' }, h), null);
    assert.equal(classifyAlbum({ collectionName: 'Hadestown (Deutsche Originalbesetzung)', artistName: 'x' }, h), null);
    // a German-language production named only by its house (seen live for Come From Away)
    assert.equal(classifyAlbum({ collectionName: 'Come from Away (2025 Theater Regensburg Original Cast)', artistName: 'x' }, info('Come from Away')), null);
    assert.equal(classifyAlbum({ collectionName: 'Come From Away (Original Broadway Cast Recording)', artistName: 'x' }, info('Come from Away')).tier, 100);
    // Vienna, Shiki (Japan) and Argentine casts
    assert.equal(classifyAlbum({ collectionName: 'Elisabeth (Original Vienna Cast)', artistName: 'x' }, info('Elisabeth')), null);
    assert.equal(classifyAlbum({ collectionName: 'Wicked (Shiki Theatre Company Cast)', artistName: 'x' }, info('Wicked')), null);
    assert.equal(classifyAlbum({ collectionName: 'Rent (Elenco Argentina)', artistName: 'x' }, info('Rent')), null);
    assert.equal(classifyAlbum({ collectionName: 'Operation Mincemeat (Soundtrack from the Netflix Film)', artistName: 'x' }, info('Operation Mincemeat')), null);
    assert.equal(classifyAlbum({ collectionName: 'Les Misérables (Original Motion Picture Soundtrack)', artistName: 'x' }, info('Les Misérables', { film: true })).tier, 62);
  });

  test('ranks the original cast above revivals, highlights and singles', () => {
    const lm = info('Les Misérables');
    const rank = (n) => classifyAlbum({ collectionName: n, artistName: 'x' }, lm).rank;
    assert.equal(rank('Les Misérables (Original 1985 London Cast Recording)'), 100);
    assert.ok(rank('Les Misérables Highlights (Original London Cast Recording)') < 100);
    assert.ok(rank('Les Misérables (2010 London Cast Recording)') < 100);
    assert.equal(classifyAlbum({ collectionName: 'On My Own (From Les Misérables Original Cast) - Single', artistName: 'x' }, lm), null);
  });
});

describe('makeItunesFetch', () => {
  test('retries 429/5xx with backoff, then caches the body on disk', async () => {
    const dir = tmp();
    let calls = 0;
    const fake = async () => {
      calls++;
      return calls === 1 ? new Response('slow down', { status: 429 }) : json({ resultCount: 0, results: [] });
    };
    const stats = {};
    const f = makeItunesFetch({ cacheDir: dir, fetchImpl: fake, minIntervalMs: 0, backoffBaseMs: 0, stats, log: () => {} });
    const res = await f('https://itunes.apple.com/search?term=x');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(await res.text()), { resultCount: 0, results: [] });
    assert.equal(calls, 2);
    assert.equal(stats.retries, 1);
    await f('https://itunes.apple.com/search?term=x');
    assert.equal(calls, 2, 'second call served from the cache');
    assert.equal(stats.cacheHits, 1);
  });

  test('a 404 is returned as-is without retrying', async () => {
    let calls = 0;
    const f = makeItunesFetch({ cacheDir: tmp(), fetchImpl: async () => { calls++; return new Response('no', { status: 404 }); }, minIntervalMs: 0, backoffBaseMs: 0, log: () => {} });
    const res = await f('https://itunes.apple.com/lookup?id=1');
    assert.equal(res.status, 404);
    assert.equal(calls, 1);
  });
});

describe('enrich main (offline)', () => {
  const ALBUM = { wrapperType: 'collection', collectionType: 'Album', collectionId: 11, collectionName: 'Hadestown (Original Broadway Cast Recording)', artistName: 'Anaïs Mitchell', releaseDate: '2019-06-21T07:00:00Z', trackCount: 40, collectionExplicitness: 'notExplicit' };
  const KARAOKE = { ...ALBUM, collectionId: 22, collectionName: 'Hadestown (Karaoke Version)', artistName: 'Stage Stars' };
  const track = (trackId, trackName, secs) => ({
    wrapperType: 'track', kind: 'song', trackId, trackName, collectionId: 11, collectionName: ALBUM.collectionName, artistName: 'Eva Noblezada',
    previewUrl: `https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/${trackId}.m4a`,
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/hadestown/100x100bb.jpg',
    trackViewUrl: `https://music.apple.com/ca/album/x/11?i=${trackId}`, trackTimeMillis: secs * 1000, trackNumber: trackId % 50, discNumber: 1,
    releaseDate: '2019-06-21T07:00:00Z',
  });
  const TRACKS = [track(101, 'Flowers', 211), track(102, 'Wedding Song', 213), track(103, 'Wedding Song (Reprise)', 60), track(104, 'Our Lady of the Underground', 324)];

  function setup() {
    const dir = tmp();
    const dbPath = path.join(dir, 'star.db');
    const db = openDb(dbPath);
    const show = insertShow(db, 'Hadestown');
    const ids = {
      flowers: insertSong(db, { title: 'Flowers', showId: show, lengthSeconds: 211 }),
      wedding: insertSong(db, { kind: 'duet', title: 'Wedding Song', showId: show, lengthSeconds: 213, parts: [['Orpheus', 'Tenor'], ['Eurydice', 'Alto']] }),
      nope: insertSong(db, { title: 'Not On Any Album', showId: show, lengthSeconds: 100 }),
      community: insertSong(db, { title: 'Our Lady of the Underground', showId: show, source: 'community' }),
    };
    db.prepare("UPDATE songs SET created_at = '2026-01-01T00:00:00.000Z', updated_at = '2026-01-01T00:00:00.000Z'").run();
    db.close();
    fs.mkdirSync(path.join(dir, 'seed'));
    const calls = [];
    const fetchImpl = async (url) => {
      const u = new URL(url);
      calls.push(u.pathname + '?' + u.searchParams.get('entity') + ':' + (u.searchParams.get('term') ?? u.searchParams.get('id')));
      if (u.pathname === '/lookup') {
        assert.equal(u.searchParams.get('id'), '11', 'only the real cast album is looked up');
        return json({ resultCount: 5, results: [ALBUM, ...TRACKS] });
      }
      if (u.searchParams.get('entity') === 'album') return json({ resultCount: 2, results: [KARAOKE, ALBUM] });
      return json({ resultCount: 0, results: [] });
    };
    let imageCalls = 0;
    const imageFetchImpl = async () => {
      imageCalls++;
      const body = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
      return new Response(body, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    };
    const args = ['--db', dbPath, '--seed-dir', path.join(dir, 'seed'), '--media-dir', path.join(dir, 'media'), '--cache-dir', path.join(dir, 'cache'), '--report', path.join(dir, 'report.json')];
    const deps = { fetchImpl, imageFetchImpl, log: () => {}, minIntervalMs: 0, backoffBaseMs: 0, noPause: true };
    return { dir, dbPath, ids, calls, args, deps, imageCalls: () => imageCalls };
  }

  test('album scan → DB + media.json (+ null for no match); idempotent; never touches updated_at or community rows', async () => {
    const t = setup();
    const report = await main(t.args, t.deps);
    assert.equal(report.summary.matchedHigh, 2);
    assert.equal(report.summary.unmatched, 1);
    assert.equal(t.imageCalls(), 1, 'one artwork download for the shared album art');

    const media = JSON.parse(fs.readFileSync(path.join(t.dir, 'seed', 'media.json'), 'utf8'));
    const flowers = media['solo|Hadestown|Flowers'];
    assert.equal(flowers.itunesTrackId, 101);
    assert.equal(flowers.confidence, 'high');
    assert.equal(flowers.recordingName, ALBUM.collectionName);
    assert.match(flowers.verifiedBy, /album-scan: exact title/);
    assert.match(flowers.verifiedBy, /length 3:31 matches the spreadsheet/);
    assert.ok(fs.existsSync(path.join(t.dir, 'media', 'art', flowers.artworkFile)));
    // the art's source is recorded so `npm run fetch-media` can download it on a fresh checkout;
    // the file name is the cache key sha256(artworkUrl)[:16]
    assert.equal(flowers.artworkUrl, 'https://is1-ssl.mzstatic.com/image/thumb/Music/hadestown/600x600bb.jpg');
    assert.equal(flowers.artworkFile, `${crypto.createHash('sha256').update(flowers.artworkUrl).digest('hex').slice(0, 16)}.jpg`);
    assert.equal(media['duet|Hadestown|Wedding Song'].itunesTrackId, 102, 'not the reprise');
    assert.equal(media['solo|Hadestown|Not On Any Album'], null);
    assert.ok(media._unmatched['solo|Hadestown|Not On Any Album']);
    assert.equal(Object.keys(media).filter((k) => k.includes('Our Lady')).length, 0, 'community rows never go to media.json');

    const db = openDb(t.dbPath);
    const row = db.prepare('SELECT * FROM songs WHERE id = ?').get(t.ids.flowers);
    assert.equal(row.preview_url, flowers.previewUrl);
    assert.equal(row.artwork_path, `/media/art/${flowers.artworkFile}`);
    assert.equal(row.itunes_track_id, 101);
    assert.equal(row.updated_at, row.created_at, 'updated_at untouched');
    assert.equal(db.prepare('SELECT preview_url FROM songs WHERE id = ?').get(t.ids.community).preview_url, null);
    db.close();

    // Rerun: everything is either matched or a recorded no-match → no network at all.
    const before = t.calls.length;
    const again = await main(t.args, t.deps);
    assert.equal(again.summary.processed, 0);
    assert.equal(t.calls.length, before);

    // --all re-matches from the on-disk cache (no new requests) and keeps the same answers.
    const all = await main([...t.args, '--all'], t.deps);
    assert.equal(all.summary.matchedHigh, 2);
    assert.equal(t.calls.length, before);
  });

  test('a media.json entry whose art is not downloaded yet is restored without searching iTunes again', async () => {
    const t = setup();
    await main(t.args, t.deps);
    const media = JSON.parse(fs.readFileSync(path.join(t.dir, 'seed', 'media.json'), 'utf8'));
    const { artworkFile } = media['solo|Hadestown|Flowers'];
    fs.rmSync(path.join(t.dir, 'media'), { recursive: true }); // e.g. a fresh checkout before fetch-media
    const db = openDb(t.dbPath);
    db.prepare('UPDATE songs SET preview_url = NULL, artwork_path = NULL WHERE id = ?').run(t.ids.flowers);
    db.close();
    const before = t.calls.length;
    const report = await main(t.args, t.deps);
    assert.equal(report.summary.fromMediaJson, 1);
    assert.equal(t.calls.length, before, 'no iTunes requests');
    assert.equal(t.imageCalls(), 1, 'no art download either (that is fetch-media\'s job)');
    const check = openDb(t.dbPath);
    assert.equal(check.prepare('SELECT artwork_path FROM songs WHERE id = ?').get(t.ids.flowers).artwork_path, `/media/art/${artworkFile}`);
    check.close();
  });

  test('--dry-run writes nothing; edited spreadsheet rows are skipped', async () => {
    const t = setup();
    const db = openDb(t.dbPath);
    // an admin edit on the website (uploads alone don't set edited_at — see the import tests)
    db.prepare("UPDATE songs SET updated_at = '2026-02-01T00:00:00.000Z', edited_at = '2026-02-01T00:00:00.000Z' WHERE id = ?").run(t.ids.wedding);
    db.close();
    const report = await main([...t.args, '--dry-run'], t.deps);
    assert.equal(report.summary.matchedHigh, 1);
    assert.ok(report.skipped.some((s) => s.id === t.ids.wedding && /edited/.test(s.reason)));
    assert.equal(fs.existsSync(path.join(t.dir, 'seed', 'media.json')), false);
    assert.equal(t.imageCalls(), 0);
    const check = openDb(t.dbPath);
    assert.equal(check.prepare('SELECT count(*) AS n FROM songs WHERE preview_url IS NOT NULL').get().n, 0);
    check.close();
  });
});
