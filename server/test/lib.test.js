import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slugify, uniqueSlug } from '../src/lib/slug.js';
import { normalizeVocalRange, fixSubGenre, matchExisting, VOCAL_RANGES } from '../src/lib/vocab.js';
import { fold, cleanText, parseLength, formatLength } from '../src/lib/text.js';
import { openDb, MIGRATIONS } from '../src/db.js';
import { TtlCache } from '../src/lib/cache.js';

test('slugify per SPEC §4', () => {
  assert.equal(slugify('Les Misérables'), 'les-miserables');
  assert.equal(slugify("Something's Afoot"), 'somethings-afoot');
  assert.equal(slugify('A Gentleman’s Guide to Love and Murder'), 'a-gentlemans-guide-to-love-and-murder');
  assert.equal(slugify('Smash!'), 'smash');
  assert.equal(slugify('  Mr. Burns  '), 'mr-burns');
  assert.equal(slugify('SPAMalot'), 'spamalot');
  const taken = new Set(['cats', 'cats-2']);
  assert.equal(uniqueSlug('Cats', (s) => taken.has(s)), 'cats-3');
  assert.equal(uniqueSlug('!!!', () => false), 'show');
});

test('vocal range normalization', () => {
  assert.deepEqual(VOCAL_RANGES, ['Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass']);
  for (const v of ['mezzo', 'Mezzo', 'mezzo soprano', 'MEZZO-SOPRANO', 'Mezzo-soprano']) assert.equal(normalizeVocalRange(v), 'Mezzo-soprano');
  assert.equal(normalizeVocalRange('sop'), 'Soprano');
  assert.equal(normalizeVocalRange(' baritone '), 'Baritone');
  assert.equal(normalizeVocalRange(''), null);
  assert.equal(normalizeVocalRange(null), null);
  assert.equal(normalizeVocalRange('countertenor'), undefined);
});

test('sub-genre fixes and matchExisting', () => {
  assert.equal(fixSubGenre('Tongue & Cheek'), 'Tongue-in-Cheek');
  assert.equal(fixSubGenre('tongue & cheek'), 'Tongue-in-Cheek');
  assert.equal(fixSubGenre('Intimidating/angry'), 'Intimidating / Angry');
  assert.equal(fixSubGenre('Longing'), 'Longing');
  assert.equal(matchExisting('drama', ['Comedy', 'Drama']), 'Drama');
  assert.equal(matchExisting('Opera', ['Comedy', 'Drama']), 'Opera');
});

test('text helpers', () => {
  assert.equal(fold('Dantès MERCÉDÈS'), 'dantes mercedes');
  assert.equal(fold('Don’t'), "don't");
  assert.equal(cleanText('  a \u0000 b  '), 'a b');
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText('line1\r\nline2\u0007', { multiline: true }), 'line1\nline2');
  assert.equal(parseLength('2:33'), 153);
  assert.equal(parseLength('10:05'), 605);
  assert.ok(Number.isNaN(parseLength('2:3')));
  assert.equal(parseLength(''), null);
  assert.equal(formatLength(153), '2:33');
  assert.equal(formatLength(406), '6:46');
  assert.equal(formatLength(null), '');
});

test('openDb: WAL, foreign keys, fold(), user_version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-db-'));
  try {
    const db = openDb(path.join(dir, 'x.db'));
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('user_version', { simple: true }), Math.max(...MIGRATIONS.map((m) => m.version)));
    assert.equal(db.prepare("SELECT fold('Les Misérables') AS f").get().f, 'les miserables');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
    assert.deepEqual(tables, ['admin_email_listings', 'comments', 'import_tombstones', 'sessions', 'shows', 'song_parts', 'songs', 'users']);
    // comment must target exactly one of song/show
    db.prepare("INSERT INTO users (email, display_name, password_hash) VALUES ('a@b.co', 'A', 'x')").run();
    assert.throws(() => db.prepare("INSERT INTO comments (user_id, body) VALUES (1, 'x')").run());
    db.close();
    // reopening is idempotent
    openDb(path.join(dir, 'x.db')).close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TtlCache expires and caps size', async () => {
  const c = new TtlCache({ ttlMs: 20, max: 2 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('c'), 3);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(c.get('c'), undefined);
});
