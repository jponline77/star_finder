// Regression snapshot over every fixture: counts + a hash of the parsed songs/characters. Any
// parser change that alters an output shows up here. After reviewing the change, refresh with:
//   UPDATE_SNAPSHOTS=1 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { index, parsed } from './helpers.js';

const FILE = new URL('./fixtures/snapshot.json', import.meta.url);
const hash = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);

function summarize(title) {
  const r = parsed(title);
  return {
    stage: r.isStageWork, section: r.section, list: r.productionList,
    songs: r.songs.length,
    withSingers: r.songs.filter((s) => s.singers.length).length,
    ensemble: r.songs.filter((s) => s.ensemble).length,
    instrumental: r.songs.filter((s) => s.instrumental).length,
    reprise: r.songs.filter((s) => s.reprise).length,
    characters: r.characters.length,
    voiceTypes: r.characters.filter((c) => c.voiceType).length,
    songsHash: hash(r.songs), charactersHash: hash(r.characters),
  };
}

test('fixture outputs match the reviewed snapshot', () => {
  const now = Object.fromEntries(index.map((e) => [e.title, summarize(e.title)]));
  if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n');
    return;
  }
  const snap = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  for (const [t, v] of Object.entries(now)) assert.deepEqual(v, snap[t], `${t} changed (UPDATE_SNAPSHOTS=1 to accept)`);
  assert.deepEqual(Object.keys(snap).sort(), Object.keys(now).sort());
});

test('fixtures are lyric-safe: no quote/poem templates, no <poem>, no long quoted lines outside lists', () => {
  for (const e of index) {
    const text = fs.readFileSync(new URL(`./fixtures/${e.file}`, import.meta.url), 'utf8');
    assert.ok(!/\{\{\s*(?:poemquote|quote|blockquote|cquote|lyrics|poem)\b/i.test(text), `${e.title}: quote template`);
    assert.ok(!/<poem>/i.test(text), `${e.title}: <poem>`);
    for (const line of text.split('\n')) {
      if (/^\s*[*#;|!{]/.test(line)) continue; // list / table lines (titles, names)
      assert.ok(line.length < 400, `${e.title}: long prose line kept: ${line.slice(0, 80)}`);
    }
  }
});
