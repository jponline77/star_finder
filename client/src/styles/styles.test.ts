/**
 * Guards for CSS-only accessibility fixes. Vitest runs with `css: false` (CSS imports are empty),
 * so these read the stylesheet sources from disk.
 */
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../lib/color';

// node:fs, loaded by a computed name — the app's TS project only has browser types.
const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const base = read('./base.css');
const components = read('./components.css');
const song = read('./song.css');
const tokens = read('./tokens.css');
const home = read('../pages/HomePage.css');
const setlist = read('../pages/SetlistPage.css');
const showDetail = read('../pages/ShowDetailPage.css');
const songForm = read('../pages/SongFormPage.css');
const starPrep = read('../pages/StarPrepPage.css');
const browse = read('../pages/BrowsePage.css');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // a standalone rule: starts the file or follows a closing brace / comment (not ", selector")
  const m = new RegExp(`(?:^|\\}|\\*/)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1]!;
}
const token = (css: string, name: string, scope = ':root'): string => {
  const light = css.indexOf("[data-theme='light'] {");
  const block = scope === ':root' ? css.slice(0, light) : css.slice(light);
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block);
  if (!m) throw new Error(`no ${name} in ${scope}`);
  return m[1]!;
};

describe('motion (WCAG 2.2.2): nothing blinks or moves for more than ~5 s on its own', () => {
  it('marquee bulbs run a short, finite chase', () => {
    for (const sel of ['.marquee::before', '.marquee::after']) {
      const decl = rule(components, sel);
      expect(decl).toMatch(/animation:\s*bulb-blink 1\.2s steps\(1, end\) 4;/);
      expect(decl).not.toMatch(/infinite/);
    }
  });
  it('home neon flicker and spotlight sweep are finite', () => {
    expect(rule(home, '.home-title-accent')).not.toMatch(/infinite/);
    expect(rule(home, '.spotlight-beam')).not.toMatch(/infinite/);
  });
});

describe('focus not obscured (WCAG 2.4.11)', () => {
  it('reserves the mini player height at the bottom when scrolling focus into view', () => {
    expect(rule(base, 'html.has-mini-player')).toMatch(/scroll-padding-bottom:\s*calc\(var\(--mini-player-offset, var\(--mini-player-h\)\) \+ 12px\)/);
  });
});

describe('contrast', () => {
  it('count badges use --on-pink text, which passes AA in both themes', () => {
    expect(rule(components, '.count-badge')).toMatch(/color:\s*var\(--on-pink\)/);
    expect(contrastRatio(token(tokens, '--on-pink'), token(tokens, '--pink-400'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token(tokens, '--on-pink', 'light'), token(tokens, '--accent-pink', 'light'))).toBeGreaterThanOrEqual(4.5);
  });
  it('the Community ribbon uses deep pinks behind white text at a readable size', () => {
    const decl = rule(song, '.ribbon');
    expect(decl).toMatch(/linear-gradient\(90deg, var\(--pink-700\), #c8175f\)/);
    expect(contrastRatio('#ffffff', token(tokens, '--pink-700'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', '#c8175f')).toBeGreaterThanOrEqual(4.5);
    expect(decl).toMatch(/font-size:\s*0\.7rem/);
  });
  it('rubric level 3 uses --on-teal digits', () => {
    expect(rule(starPrep, '.prep-level.is-3')).toMatch(/--level-text:\s*var\(--on-teal\)/);
    expect(rule(starPrep, '.prep-level-score')).toMatch(/color:\s*var\(--level-text, var\(--range-text\)\)/);
    expect(contrastRatio(token(tokens, '--on-teal', 'light'), token(tokens, '--accent-teal', 'light'))).toBeGreaterThanOrEqual(4.5);
  });
  it('no faded sub-label on the Solo/Duet toggle', () => {
    expect(rule(songForm, '.kind-label-sub')).not.toMatch(/opacity/);
  });
  it('show-page header labels use --text-muted', () => {
    expect(rule(showDetail, '.show-image-credit')).toMatch(/color:\s*var\(--text-muted\)/);
    expect(rule(showDetail, '.show-credits dt')).toMatch(/color:\s*var\(--text-muted\)/);
  });
});

describe('target size', () => {
  it('small targets meet 24px everywhere and grow to --tap on touch screens', () => {
    expect(rule(components, '.sort-button')).toMatch(/min-height:\s*24px/);
    expect(rule(song, 'a.tag')).toMatch(/min-height:\s*24px/);
    expect(rule(setlist, '.setlist-show a')).toMatch(/min-height:\s*24px/);
    const coarse = components.slice(components.indexOf('@media (pointer: coarse)'));
    expect(coarse).toMatch(/\.btn-sm\s*\{\s*min-height:\s*var\(--tap\)/);
    expect(song).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.play-button\.is-sm\s*\{\s*--size:\s*var\(--tap\)/);
  });
});

describe('Browse toolbar on narrow phones', () => {
  it('gives the sort select its own full-width row so its label is not clipped', () => {
    const narrow = browse.slice(browse.indexOf('@media (max-width: 440px)'));
    expect(narrow).toMatch(/\.browse-sort\s*\{\s*order:\s*1;\s*flex:\s*1 1 100%;/);
  });
});

describe('setlist totals', () => {
  it('never wrap inside a number', () => {
    expect(rule(setlist, '.setlist-stat-value')).toMatch(/white-space:\s*nowrap/);
  });
});
