import type { Page } from '@playwright/test';
import { apiFestivals, expect, horizontalOverflow, pickerOrder, storedFestival, test } from './helpers';

/**
 * Choosing your festival (SPEC §7b) as a visitor: Home chips, the header picker, the mobile menu,
 * ?festival= share links, STAR Prep, and every hero state (upcoming / today / over / TBD / online).
 *
 * Runs in the read-only project: nothing here writes to the database (the choice lives in
 * localStorage for visitors) — account and admin flows are in festival-accounts.spec.ts.
 *
 * The browser clock is pinned (America/Vancouver, from playwright.config.ts) so the countdowns and
 * phases don't depend on the day the suite runs. The seeded 2026-27 season has every festival
 * still ahead on SEASON.
 */
const SEASON = new Date('2026-11-15T12:00:00-08:00');

async function pinClock(page: Page, at: Date = SEASON) {
  await page.clock.setFixedTime(at);
}

/** The home hero's countdown label for screen readers ("74 days and 12 hours until …"). */
const countdownText = (page: Page) => page.getByTestId('countdown').locator('.visually-hidden');

test.describe('Choosing your festival', () => {
  test.beforeEach(async ({ page }) => pinClock(page));

  test('first visit asks “Where are you performing?” (no default); a chip sets the countdown and venue', async ({ page }) => {
    const festivals = await apiFestivals(page.request);
    const choices = pickerOrder(festivals);
    expect(choices.map((f) => f.slug)).toEqual(['prince-george', 'fraser-valley', 'victoria', 'vancouver', 'burnaby', 'surrey', 'nanaimo', 'online']);
    expect(festivals.some((f) => f.kind === 'national')).toBe(true);

    await page.goto('/');
    const where = page.getByTestId('festival-where');
    await expect(where).toBeVisible();
    await expect(where.getByRole('heading', { name: 'Where are you performing?' })).toBeVisible();
    await expect(page.getByTestId('countdown')).toHaveCount(0);
    await expect(page.getByTestId('home-eyebrow')).toContainText('STAR Fest · Musical Theatre Solo & Duet');
    await expect(page.getByTestId('header-festival')).toHaveAccessibleName('Choose your festival');

    // one chip per BC regional + Online, in date order (TBD last), no national festival
    const chips = page.getByTestId('festival-chips').getByRole('button');
    await expect(chips).toHaveCount(choices.length);
    for (const [i, f] of choices.entries()) await expect(chips.nth(i)).toHaveAttribute('data-testid', `festival-chip-${f.slug}`);
    await expect(page.getByTestId('festival-chip-star-fest-west')).toHaveCount(0);
    await expect(page.getByTestId('festival-chip-surrey')).toContainText('Surrey');
    await expect(page.getByTestId('festival-chip-surrey')).toContainText('Jan 29');
    await expect(page.getByTestId('festival-chip-nanaimo')).toContainText('Date TBA');
    await expect(page.getByTestId('festival-chip-online')).toContainText('Closes Feb 28');
    expect(await storedFestival(page)).toBeNull();

    await page.getByTestId('festival-chip-surrey').click();
    const hero = page.getByTestId('home-festival');
    await expect(hero).toHaveAttribute('data-phase', 'upcoming');
    await expect(page.getByTestId('home-eyebrow')).toContainText('Surrey Regional STAR Fest · Friday, January 29, 2027');
    await expect(hero).toContainText('Curtain up at North Surrey Secondary School in…');
    // Nov 15 noon → Jan 29 midnight
    await expect(countdownText(page)).toHaveText('74 days and 12 hours until Surrey Regional STAR Fest on Friday, January 29, 2027');
    await expect(page.getByTestId('festival-where')).toHaveCount(0);
    await expect(page.getByTestId('toast').filter({ hasText: 'Surrey it is!' })).toBeVisible();
    await expect(page.getByTestId('header-festival')).toHaveAccessibleName('Your festival: Surrey');
    await expect(page.getByTestId('header-festival')).toContainText('Surrey');
    expect(await storedFestival(page)).toBe('surrey');

    // "Not your festival? Change it" reopens the chips
    await page.getByTestId('home-change-festival').click();
    await expect(page.getByTestId('festival-chip-surrey')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('festival-chip-fraser-valley').click();
    await expect(page.getByTestId('home-eyebrow')).toContainText('Fraser Valley Regional STAR Fest · Friday, December 4, 2026');
    await expect(hero).toContainText('Curtain up at Clarke Theatre in…');
    await expect(page.getByTestId('festival-chips')).toHaveCount(0);
    await expect(page.getByTestId('home-change-festival')).toBeFocused();
  });

  test('the choice survives a reload and a new tab (this device remembers it)', async ({ page, context }) => {
    await page.goto('/');
    await page.getByTestId('festival-chip-victoria').click();
    await expect(page.getByTestId('home-eyebrow')).toContainText('Victoria Regional STAR Fest · Thursday, December 10, 2026');

    await page.reload();
    await expect(page.getByTestId('home-eyebrow')).toContainText('Victoria Regional STAR Fest · Thursday, December 10, 2026');
    await expect(page.getByTestId('home-festival')).toContainText('Curtain up at University of Victoria (UVic) in…');
    await expect(page.getByTestId('festival-where')).toHaveCount(0);

    const other = await context.newPage();
    await pinClock(other);
    await other.goto('/star-prep');
    await expect(other.getByTestId('prep-festival')).toContainText('Victoria Regional STAR Fest · Thursday, December 10, 2026');
    await other.close();
  });

  test('a ?festival= link picks the festival, then disappears from the address bar', async ({ page }) => {
    // an earlier choice on this device is replaced by the link
    await page.goto('/');
    await page.getByTestId('festival-chip-victoria').click();
    await expect(page.getByTestId('home-festival')).toBeVisible();

    await page.goto('/?festival=surrey');
    await expect(page.getByTestId('home-eyebrow')).toContainText('Surrey Regional STAR Fest · Friday, January 29, 2027');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByTestId('toast').filter({ hasText: 'Your festival is set to Surrey.' })).toBeVisible();
    expect(await storedFestival(page)).toBe('surrey');

    // the choice sticks after the link is gone
    await page.reload();
    await expect(page.getByTestId('home-eyebrow')).toContainText('Surrey Regional STAR Fest');

    // any page, other query parameters kept; slugs are case-insensitive
    await page.goto('/songs?q=hades&festival=Burnaby');
    await expect.poll(() => new URL(page.url()).search).toBe('?q=hades');
    await expect(page.getByTestId('header-festival')).toHaveAccessibleName('Your festival: Burnaby');

    // an unknown festival is dropped politely and the choice is kept
    await page.goto('/?festival=atlantis');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(page.getByTestId('toast').filter({ hasText: 'didn’t match a current festival' })).toBeVisible();
    await expect(page.getByTestId('home-eyebrow')).toContainText('Burnaby Regional STAR Fest');

    // a national festival isn't something you can pick as "yours"
    await page.goto('/?festival=star-fest-west');
    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(page.getByTestId('home-eyebrow')).toContainText('Burnaby Regional STAR Fest');
  });

  test('header picker: a grouped listbox, by mouse and by keyboard', async ({ page }) => {
    await page.goto('/songs');
    const chip = page.getByTestId('header-festival');
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByTestId('header-festival-listbox');
    await expect(list).toBeFocused();
    await expect(page.getByTestId('header-festival-popover')).toContainText('Where are you performing?');
    await expect(list.getByRole('group', { name: 'BC regional festivals' }).getByRole('option')).toHaveCount(7);
    await expect(list.getByRole('group', { name: 'Online' }).getByRole('option')).toHaveCount(1);
    await expect(list.getByRole('option')).toHaveCount(8);
    await expect(page.getByTestId('festival-option-star-fest-west')).toHaveCount(0);
    await expect(page.getByTestId('festival-option-fraser-valley')).toHaveAccessibleName('Fraser Valley (Mission), Dec 4, 2026');
    await expect(page.getByTestId('festival-option-online')).toHaveAccessibleName('Online, Closes Feb 28, 2027');

    await page.getByTestId('festival-option-burnaby').click();
    await expect(page.getByTestId('header-festival-popover')).toHaveCount(0);
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAccessibleName('Your festival: Burnaby');
    expect(await storedFestival(page)).toBe('burnaby');

    // Home follows the header
    await page.getByTestId('logo').click();
    await expect(page.getByTestId('home-eyebrow')).toContainText('Burnaby Regional STAR Fest · Friday, January 22, 2027');

    // keyboard: ↓ opens on the current festival, End → last (Online), Enter picks it
    await chip.focus();
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeFocused();
    await expect(page.getByTestId('festival-option-burnaby')).toHaveAttribute('aria-selected', 'true');
    await expect(list).toHaveAttribute('aria-activedescendant', (await page.getByTestId('festival-option-burnaby').getAttribute('id'))!);
    await page.keyboard.press('End');
    await expect(list).toHaveAttribute('aria-activedescendant', (await page.getByTestId('festival-option-online').getAttribute('id'))!);
    await page.keyboard.press('Enter');
    await expect(chip).toHaveAccessibleName('Your festival: Online');
    await expect(page.getByTestId('home-eyebrow')).toContainText('Online Regional STAR Fest · Closes Feb 28, 2027');

    // Escape closes without changing anything; typing a letter jumps
    await chip.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('v');
    await expect(list).toHaveAttribute('aria-activedescendant', (await page.getByTestId('festival-option-victoria').getAttribute('id'))!);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('header-festival-popover')).toHaveCount(0);
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAccessibleName('Your festival: Online');

    // Tab from the list reaches "All festival dates & details" (it isn't mouse-only); Enter follows it
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeFocused();
    await page.keyboard.press('Tab');
    const more = page.getByTestId('header-festival-more');
    await expect(more).toBeFocused();
    await expect(page.getByTestId('header-festival-popover')).toBeVisible();
    // Tab again leaves the popover, which closes
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('header-festival-popover')).toHaveCount(0);
    await chip.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/star-prep#dates$/);
    await expect(page.getByTestId('header-festival-popover')).toHaveCount(0);
  });

  test('the header chip shows every festival’s whole name on desktop (no “Prince Geor…”)', async ({ page }) => {
    const choices = pickerOrder(await apiFestivals(page.request));
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const f of choices) {
        await page.goto(`/songs?festival=${f.slug}`);
        const text = page.getByTestId('header-festival').locator('.festival-chip-text');
        await expect(text).toBeVisible();
        const { scroll, client } = await text.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
        expect(scroll, `${f.slug} at ${width}px`).toBeLessThanOrEqual(client);
      }
      expect(await horizontalOverflow(page)).toBe(0);
    }
  });

  test('STAR Prep: countdown for your festival, “Your festival” badge, “Make this mine”, nationals', async ({ page }) => {
    await page.goto('/star-prep');
    // nothing chosen yet → a picker in the hero, no badge
    await expect(page.getByTestId('prep-festival')).toContainText('Pick your festival to see your countdown and dates.');
    await expect(page.getByTestId('festival-share')).toHaveCount(0);

    const regional = page.getByTestId('regional-dates');
    const cards = regional.getByTestId('festival-card');
    await expect(cards).toHaveCount(8);
    await expect(cards.first()).toHaveAttribute('data-slug', 'prince-george');
    await expect(cards.last()).toHaveAttribute('data-slug', 'online');
    const card = (slug: string) => regional.locator(`[data-testid=festival-card][data-slug="${slug}"]`);
    await expect(card('fraser-valley')).toContainText('Clarke Theatre · Mission');
    await expect(card('nanaimo')).toContainText('Date and venue to be announced');
    await expect(card('online')).toContainText('Online entries close February 28, 2027');
    await expect(regional.getByRole('button', { name: /^Your festival/ })).toHaveCount(0);

    await card('victoria').getByTestId('make-mine').click();
    await expect(card('victoria').getByTestId('make-mine')).toHaveText(/Your festival/);
    await expect(card('victoria').getByTestId('make-mine')).toHaveAttribute('aria-disabled', 'true');
    await expect(regional.getByRole('button', { name: /^Your festival/ })).toHaveCount(1);
    await expect(page.getByTestId('prep-festival')).toContainText('Victoria Regional STAR Fest · Thursday, December 10, 2026');
    await expect(page.getByTestId('prep-festival').getByTestId('countdown')).toBeVisible();
    await expect(page.getByTestId('festival-share-url')).toHaveText(new URL('/?festival=victoria', page.url()).href);

    // switch with "Make this mine" on another card
    await card('surrey').getByTestId('make-mine').click();
    await expect(card('surrey').getByTestId('make-mine')).toHaveText(/Your festival/);
    await expect(card('victoria').getByTestId('make-mine')).toHaveText(/Make this mine/);
    await expect(page.getByTestId('prep-festival')).toContainText('Surrey Regional STAR Fest · Friday, January 29, 2027');

    // nationals: from the API, never pickable
    const nationals = page.getByTestId('national-dates');
    await expect(page.getByRole('heading', { name: /After regionals: National STAR Festivals/ })).toBeVisible();
    await expect(nationals.getByTestId('festival-card')).toHaveCount(1);
    await expect(nationals).toContainText('STAR Fest West');
    await expect(nationals).toContainText('May 20–23, 2027');
    await expect(nationals).toContainText('University of British Columbia (UBC Vancouver)');
    await expect(nationals.getByTestId('make-mine')).toHaveCount(0);
    await expect(nationals.getByRole('link', { name: /Details/ })).toHaveAttribute('href', 'https://taeacanada.ca/national-star-fest/');

    // the caveat and the official page stay
    await expect(page.locator('.prep-caveat')).toContainText('Always confirm with your teacher');
    await expect(page.getByRole('link', { name: /Official TAEA Regional STAR Fest page/ })).toHaveAttribute('href', 'https://taeacanada.ca/regional-star-fest/');
  });

  test('a site default (STAR_DEFAULT_FESTIVAL) counts down until the visitor picks their own', async ({ page }) => {
    // The server side of STAR_DEFAULT_FESTIVAL is covered in server/test/festivals.test.js; here
    // /api/meta is answered as a server with STAR_DEFAULT_FESTIVAL=fraser-valley would answer it.
    await page.route('**/api/meta', async (route) => {
      const res = await route.fetch();
      const meta = (await res.json()) as Record<string, unknown>;
      await route.fulfill({ response: res, json: { ...meta, defaultFestivalSlug: 'fraser-valley' } });
    });
    await page.goto('/');
    await expect(page.getByTestId('home-eyebrow')).toContainText('Fraser Valley Regional STAR Fest · Friday, December 4, 2026');
    await expect(page.getByTestId('countdown')).toBeVisible();
    // a default isn't the visitor's own choice: nothing is stored
    expect(await storedFestival(page)).toBeNull();

    await page.getByTestId('home-change-festival').click();
    await page.getByTestId('festival-chip-prince-george').click();
    await expect(page.getByTestId('home-eyebrow')).toContainText('Prince George Regional STAR Fest · Friday, November 20, 2026');
    await page.reload();
    await expect(page.getByTestId('home-eyebrow')).toContainText('Prince George Regional STAR Fest');
  });
});

test.describe('Festival states on Home', () => {
  test('to be announced (Nanaimo): no countdown, “check with your teacher”', async ({ page }) => {
    await pinClock(page);
    await page.goto('/?festival=nanaimo');
    await expect(page.getByTestId('home-eyebrow')).toContainText('Nanaimo Regional STAR Fest · Date and venue to be announced');
    await expect(page.getByTestId('home-festival')).toHaveAttribute('data-phase', 'tbd');
    await expect(page.getByTestId('festival-tbd')).toHaveText('Date to be announced');
    await expect(page.getByTestId('home-festival')).toContainText('Check with your teacher for the date or the festival page');
    await expect(page.getByTestId('home-festival').getByRole('link', { name: /festival page/ })).toHaveAttribute('href', 'https://taeacanada.ca/regional-star-fest/');
    await expect(page.getByTestId('countdown')).toHaveCount(0);
  });

  test('online: “Online entries close in…” counts to the end of the deadline day', async ({ page }) => {
    await pinClock(page);
    await page.goto('/?festival=online');
    await expect(page.getByTestId('home-eyebrow')).toContainText('Online Regional STAR Fest · Closes Feb 28, 2027');
    await expect(page.getByTestId('home-festival')).toContainText('Online entries close in…');
    await expect(page.getByTestId('home-festival')).not.toContainText('Curtain up');
    // Nov 15 noon → end of Feb 28 (midnight Mar 1)
    await expect(countdownText(page)).toHaveText('105 days and 12 hours until Online Regional STAR Fest closes at the end of Sunday, February 28, 2027');
  });

  test('online, closing day: “close today!” with the hours left', async ({ page }) => {
    await pinClock(page, new Date('2027-02-28T18:00:00-08:00'));
    await page.goto('/?festival=online');
    await expect(page.getByTestId('home-festival')).toHaveAttribute('data-phase', 'today');
    await expect(page.getByTestId('home-festival')).toContainText('Online entries close today!');
    await expect(countdownText(page)).toHaveText(/^0 days and 6 hours until Online Regional STAR Fest closes/);
  });

  test('festival day: “Curtain up today at <venue>!”', async ({ page }) => {
    await pinClock(page, new Date('2026-12-11T09:00:00-08:00'));
    await page.goto('/?festival=vancouver');
    const hero = page.getByTestId('home-festival');
    await expect(hero).toHaveAttribute('data-phase', 'today');
    await expect(hero).toContainText('Curtain up today at SFU School for the Contemporary Arts (SFU SCA)!');
    await expect(hero).toContainText('It’s showtime! Break a leg!');
    await expect(page.getByTestId('festival-wrap')).toHaveCount(0);

    // STAR Prep agrees
    await page.goto('/star-prep');
    await expect(page.locator('[data-testid=festival-card][data-slug=vancouver]')).toContainText('Today!');
  });

  test('after the festival: “That’s a wrap!” and a nudge toward the national festivals', async ({ page }) => {
    await pinClock(page, new Date('2026-12-20T12:00:00-08:00'));
    await page.goto('/?festival=vancouver');
    const hero = page.getByTestId('home-festival');
    await expect(hero).toHaveAttribute('data-phase', 'over');
    await expect(page.getByTestId('festival-wrap')).toContainText('That’s a wrap!');
    const nudge = page.getByTestId('nationals-nudge');
    await expect(nudge).toContainText('STAR Fest West (National) · May 20–23, 2027 · University of British Columbia (UBC Vancouver)');
    await expect(page.getByTestId('countdown')).toHaveCount(0);

    await page.getByRole('link', { name: /About the national festivals/ }).click();
    await expect(page).toHaveURL(/\/star-prep#nationals$/);
    await expect(page.getByTestId('national-dates')).toBeInViewport();
    await expect(page.getByTestId('prep-festival')).toHaveAttribute('data-phase', 'over');
    await expect(page.locator('[data-testid=festival-card][data-slug=vancouver]')).toContainText('Wrapped');
    await expect(page.locator('[data-testid=festival-card][data-slug=surrey]')).toContainText('In 40 days');
  });
});

test.describe('A page left open over midnight', () => {
  test('the hero switches phase with the countdown (Victoria: upcoming → curtain up today)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-12-09T23:59:50-08:00') });
    await page.goto('/?festival=victoria');
    const hero = page.getByTestId('home-festival');
    await expect(hero).toHaveAttribute('data-phase', 'upcoming');
    await expect(hero).toContainText('Curtain up at University of Victoria (UVic) in…');
    await page.clock.runFor(20_000);
    await expect(hero).toHaveAttribute('data-phase', 'today');
    await expect(hero).toContainText('Curtain up today at University of Victoria (UVic)!');
    await expect(hero).not.toContainText('Curtain up at University of Victoria (UVic) in…');
  });
});

test.describe('Mobile menu picker (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the mobile menu has a festival select; the header chip is hidden', async ({ page }) => {
    await pinClock(page);
    await page.goto('/');
    await expect(page.getByTestId('header-festival')).toBeHidden();
    await expect(page.getByTestId('festival-where')).toBeVisible();

    await page.getByTestId('menu-toggle').click();
    const select = page.getByTestId('mobile-festival');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('');
    await expect(page.locator('#mobile-nav label[for=mobile-festival]')).toHaveText('Your festival');
    await expect(select.locator('optgroup')).toHaveCount(2);
    await expect(select.locator('optgroup[label="BC regional festivals"] option')).toHaveCount(7);
    await expect(select.locator('option[value="nanaimo"]')).toHaveText('Nanaimo — Date and venue to be announced');
    await expect(select.locator('option[value="fraser-valley"]')).toHaveText('Fraser Valley (Mission) — Dec 4, 2026');

    await select.selectOption('fraser-valley');
    await expect(page.getByTestId('toast').filter({ hasText: 'Fraser Valley it is!' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-nav')).toHaveCount(0);
    await expect(page.getByTestId('home-eyebrow')).toContainText('Fraser Valley Regional STAR Fest · Friday, December 4, 2026');
    await expect(page.getByTestId('countdown')).toBeVisible();
    expect(await storedFestival(page)).toBe('fraser-valley');

    // the select shows the current choice next time
    await page.getByTestId('menu-toggle').click();
    await expect(page.getByTestId('mobile-festival')).toHaveValue('fraser-valley');
  });
});
