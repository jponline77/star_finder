import type { Page } from '@playwright/test';
import { ADMIN, apiCreateSolo, apiLogin, apiSignup, expect, horizontalOverflow, songByTitle, test } from './helpers';

/**
 * Every route at 360px: renders its heading, no horizontal page scroll, no broken images, and
 * (via the automatic console guard in helpers.ts) no console errors or uncaught exceptions.
 */
test.use({ viewport: { width: 360, height: 780 } });

type Who = 'anon' | 'user' | 'admin';
interface RouteCase {
  name: string;
  who: Who;
  path: string | ((page: Page) => Promise<string> | string);
  ready?: string; // a test id that must be visible before measuring
}

const ROUTES: RouteCase[] = [
  { name: 'home', who: 'anon', path: '/', ready: 'spotlight-song' },
  { name: 'home (festival chosen)', who: 'anon', path: '/?festival=fraser-valley', ready: 'home-festival' },
  { name: 'browse grid', who: 'anon', path: '/songs', ready: 'song-card' },
  { name: 'browse table', who: 'anon', path: '/songs?view=table', ready: 'song-row' },
  { name: 'song detail (solo)', who: 'anon', path: async (p) => `/songs/${(await songByTitle(p.request, 'Into the Fire')).id}`, ready: 'similar-songs' },
  { name: 'song detail (duet)', who: 'anon', path: async (p) => `/songs/${(await songByTitle(p.request, 'Corn')).id}`, ready: 'similar-songs' },
  { name: 'shows', who: 'anon', path: '/shows', ready: 'show-card' },
  { name: 'show detail', who: 'anon', path: '/shows/les-miserables', ready: 'character-card' },
  { name: 'matchmaker', who: 'anon', path: '/match', ready: 'match-step' },
  { name: 'matchmaker results', who: 'anon', path: '/match?kind=duet&range=Tenor&partner=Soprano&genre=Romantic&len=max&mature=ok&step=results', ready: 'match-result' },
  { name: 'spin', who: 'anon', path: '/spin', ready: 'spin-button' },
  { name: 'setlist (empty)', who: 'anon', path: '/setlist', ready: 'empty-state' },
  { name: 'setlist (shared link)', who: 'anon', path: '/setlist?ids=1,2,3', ready: 'setlist-shared-banner' },
  { name: 'star prep', who: 'anon', path: '/star-prep', ready: 'rehearsal-timer' },
  { name: 'stats', who: 'anon', path: '/stats', ready: 'chart-length' },
  { name: 'login', who: 'anon', path: '/login', ready: 'login-form' },
  { name: 'signup', who: 'anon', path: '/signup', ready: 'signup-form' },
  { name: '404', who: 'anon', path: '/this-scene-was-cut', ready: 'not-found' },
  { name: 'add song', who: 'user', path: '/add', ready: 'add-song-form' },
  { name: 'edit song', who: 'user', path: async (p) => `/songs/${(await apiCreateSolo(p.request)).id}/edit`, ready: 'add-song-form' },
  { name: 'my stuff', who: 'user', path: '/me', ready: 'me-pass' },
  { name: 'admin', who: 'admin', path: '/admin', ready: 'users-table' },
  { name: 'admin festivals', who: 'admin', path: '/admin?tab=festivals', ready: 'festival-row' },
];

for (const route of ROUTES) {
  test(`${route.name} fits a 360px screen`, async ({ page }) => {
    if (route.who === 'user') await apiSignup(page.request);
    if (route.who === 'admin') await apiLogin(page.request, ADMIN);
    const path = typeof route.path === 'string' ? route.path : await route.path(page);
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    if (route.ready) await expect(page.getByTestId(route.ready).first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(await horizontalOverflow(page), 'page scrolls sideways').toBeLessThanOrEqual(0);
    const broken = await page.evaluate(() =>
      Array.from(document.images).filter((img) => img.complete && img.naturalWidth === 0 && img.getAttribute('src')).map((img) => img.getAttribute('src')),
    );
    expect(broken, 'broken images').toEqual([]);
    await expect(page.locator('h1')).toHaveCount(1);
  });
}
