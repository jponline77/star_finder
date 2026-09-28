// Low-level wikitext helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities, stripComments, stripRefs, splitParams, mapTemplates, expandTemplates, stripLinks, stripFormatting,
  sections, sectionBody, firstInfobox, stageInfobox, parseTable, templateFields,
} from '../src/wikitext.js';

test('decodeEntities', () => {
  assert.equal(decodeEntities('A&nbsp;&ndash;&#160;B &amp; C &#x2014; D&quot;'), 'A – B & C — D"');
});

test('stripComments / stripRefs', () => {
  assert.equal(stripComments('a<!-- x -->b<!-- unterminated'), 'ab');
  assert.equal(stripRefs('a<ref name="x"/>b<ref>{{cite web|url=x}}</ref>c<ref group="n">y</ref>'), 'abc');
});

test('splitParams respects nested templates and links', () => {
  assert.deepEqual(splitParams('a|[[b|c]]|{{d|e}}|f=g'), ['a', '[[b|c]]', '{{d|e}}', 'f=g']);
});

test('mapTemplates passes names, params; parser functions get their name', () => {
  const seen = [];
  mapTemplates('x {{Lang|fr|Oui}} {{#if:1|a|b}} {{DEFAULTSORT:Foo}}', (name, params) => { seen.push([name, params]); return ''; });
  assert.deepEqual(seen, [['lang', ['fr', 'Oui']], ['#if', ['1', 'a', 'b']], ['defaultsort', ['Foo']]]);
});

test('expandTemplates keeps text-carrying templates, drops the rest, reports unknown ones', () => {
  const unknown = [];
  const out = expandTemplates('{{nowrap|A}}{{nbsp}}{{ndash}} {{lang|fr|Oui}} {{small|B}}{{efn|note}}{{cite web|x}} {{hlist|C|D}} {{!}} {{Mystery|z}}{{sfn|X|2000}}{{lang-de|Ja}}', (w) => unknown.push(w));
  assert.equal(out, 'A – Oui B C, D | Ja');
  assert.deepEqual(unknown, ['template:mystery']);
  assert.equal(expandTemplates('{{ya}}/{{na}}/{{n/a}}'), '✓/✗/');
  assert.equal(expandTemplates('{{plainlist|\n* A\n* B\n}}'), 'A, B');
  assert.equal(expandTemplates('{{poemquote|some lyric line}}'), ''); // never keep quoted lyrics
});

test('stripLinks / stripFormatting', () => {
  const links = [];
  assert.equal(stripLinks('[[A (musical)|A]] [[B]] [[C#Section]] [[File:x.jpg|thumb|[[D]] cap]] [https://x.org Site]', (t, l) => links.push(t)), 'A B C  Site');
  assert.deepEqual(links, ['A (musical)', 'B', 'C#Section']);
  assert.equal(stripFormatting("'''Bold''' ''it'' <small>s</small>a<br />b"), 'Bold it sa / b');
});

test('sections / sectionBody', () => {
  const ss = sections('lead\n== Music ==\nx\n=== Musical numbers ===\ny\n== Other ==\nz');
  assert.deepEqual(ss.map((s) => [s.level, s.title]), [[1, '(lead)'], [2, 'Music'], [3, 'Musical numbers'], [2, 'Other']]);
  assert.deepEqual(sectionBody(ss, 1), ['x', '=== Musical numbers ===', 'y']);
  assert.equal(sections("== ''Songs''<ref>x</ref> ==")[1].title, 'Songs');
});

test('infoboxes', () => {
  const text = '{{Short description|x}}\n{{Infobox musical\n| name = Six\n| music = {{Plainlist|\n* [[Toby Marlow]]\n* [[Lucy Moss]]\n}}\n| lyrics = X\n}}';
  assert.equal(firstInfobox(text).type, 'musical');
  const ib = stageInfobox(text);
  assert.equal(ib.name, 'Six');
  assert.match(ib.music, /Toby Marlow/);
  assert.equal(firstInfobox('{{Infobox person|name=X}}').type, 'person');
  assert.equal(stageInfobox('{{Infobox album|name=X}}'), null);
  assert.deepEqual(templateFields(['a = 1', ' b', 'C=2=3']), { _: ['b'], a: '1', c: '2=3' });
});

test('parseTable: rowspan/colspan grid, header rows, attributes', () => {
  const t = parseTable([
    '{| class="wikitable"',
    '! Song !! Performer(s)',
    '|-',
    '! colspan="2" | Act 1',
    '|-',
    '| rowspan="2" | "A" || X',
    '|-',
    '| Y',
    '|-',
    '| "B" || style="x" | [[Z|Zed]]',
    '|}',
  ]);
  assert.equal(t.grid.length, 5);
  assert.equal(t.grid[0].allHeader, true);
  assert.equal(t.grid[1].fullWidth, true);
  assert.equal(t.grid[3].cells[0].raw, '"A"'); // carried by rowspan
  assert.equal(t.grid[3].cells[0].spanned, true);
  assert.equal(t.grid[3].cells[1].raw, 'Y');
  assert.equal(t.grid[4].cells[1].raw, '[[Z|Zed]]');
});
