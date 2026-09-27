import { allSongs, expect, test } from './helpers';

const songIdFromHref = (href: string | null) => Number(href?.split('/').pop());

test.describe('Matchmaker', () => {
  test('five questions → ranked matches with reasons; back and restart work', async ({ page }) => {
    const songs = await allSongs(page.request);
    const mature = new Set(songs.filter((s) => s.mature).map((s) => s.id));

    await page.goto('/match');
    const step = page.getByTestId('match-step');
    await expect(step).toHaveAttribute('data-step', '1');
    await page.getByTestId('match-kind-solo').click();
    await expect(step).toHaveAttribute('data-step', '2');
    await expect(page.getByTestId('voice-helper')).toBeVisible();
    await page.getByTestId('match-range-Soprano').click();
    await expect(step).toHaveAttribute('data-step', '3');
    await page.getByTestId('match-genre-Drama').click();
    await page.getByTestId('match-next').click();
    await expect(step).toHaveAttribute('data-step', '4');
    await page.getByTestId('match-len-medium').click();
    await expect(step).toHaveAttribute('data-step', '5');
    await page.getByTestId('match-mature-no').click();

    const results = page.getByTestId('match-results');
    await expect(results).toBeVisible();
    await expect(page).toHaveURL(/kind=solo/);
    await expect(page).toHaveURL(/range=Soprano/);
    await expect(page).toHaveURL(/step=results/);

    const cards = page.getByTestId('match-result');
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(12);
    const percents = await cards.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-percent'))));
    expect(percents).toEqual([...percents].sort((a, b) => b - a));
    expect(percents[0]).toBeGreaterThanOrEqual(80);
    await expect(cards.first().getByTestId('match-reason').first()).toBeVisible();
    // "Keep it clean" is a hard filter
    const ids = await cards.getByTestId('song-title').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    for (const href of ids) expect(mature.has(songIdFromHref(href))).toBe(false);

    // browser Back walks back through the questions
    await page.goBack();
    await expect(step).toHaveAttribute('data-step', '5');

    // a shared results link renders the same results
    await page.goto(page.url().replace('step=5', 'step=results'));
    await expect(page.getByTestId('match-result')).toHaveCount(n);

    await page.getByTestId('match-restart').click();
    await expect(step).toHaveAttribute('data-step', '1');
    await expect(page.getByTestId('match-kind-solo')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('Spin the Spotlight', () => {
  test('spinning lands on a song from the filtered pool, which can be opened', async ({ page }) => {
    const duets = (await allSongs(page.request, 'kind=duet')).map((s) => s.id);
    await page.goto('/spin');
    await page.getByTestId('spin-kind-duet').click();
    await expect(page).toHaveURL(/kind=duet/);
    await expect(page.getByTestId('spin-pool-size')).toContainText(String(duets.length));

    await page.getByTestId('spin-button').click();
    const result = page.getByTestId('spin-result');
    await expect(result).toBeVisible();
    await expect(page.getByTestId('spin-button')).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByTestId('spin-announcement')).not.toBeEmpty();
    const id = Number(await result.getAttribute('data-song-id'));
    expect(duets).toContain(id);

    // spin again never repeats the same song twice in a row
    await page.getByTestId('spin-again').click();
    await expect(page.getByTestId('spin-button')).toBeEnabled({ timeout: 10_000 });
    const second = Number(await page.getByTestId('spin-result').getAttribute('data-song-id'));
    expect(duets).toContain(second);
    expect(second).not.toBe(id);

    await page.getByTestId('spin-open-song').click();
    await expect(page).toHaveURL(new RegExp(`/songs/${second}$`));
  });

  test('with reduced motion the result appears straight away', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/spin');
    await page.getByTestId('spin-button').click();
    await expect(page.getByTestId('spin-result')).toBeVisible();
    await expect(page.getByTestId('spin-button')).toBeEnabled();
  });
});

test.describe('My Setlist', () => {
  test('add, reorder, remove, share and import a setlist', async ({ page, browser, context }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/setlist');
    await expect(page.getByTestId('empty-state')).toBeVisible();

    await page.goto('/songs?q=into%20the%20woods');
    const cards = page.getByTestId('song-card');
    await expect(cards.first()).toBeVisible();
    const picked: number[] = [];
    for (let i = 0; i < 3; i++) {
      const card = cards.nth(i);
      picked.push(songIdFromHref(await card.getByTestId('song-title').getAttribute('href')));
      await card.getByTestId('setlist-heart').click();
      await expect(card.getByTestId('setlist-heart')).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.getByTestId('nav-setlist').getByTestId('setlist-count')).toContainText('3');

    await page.getByTestId('nav-setlist').click();
    const rows = page.getByTestId('setlist-row');
    await expect(rows).toHaveCount(3);
    const order = () => rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-setlist-id'))));
    expect(await order()).toEqual(picked);
    await expect(page.getByTestId('setlist-total')).toBeVisible();

    // reorder: move the first song down
    await rows.first().getByTestId('setlist-move-down').click();
    await expect.poll(order).toEqual([picked[1], picked[0], picked[2]]);
    // move the last one up
    await rows.nth(2).getByTestId('setlist-move-up').click();
    await expect.poll(order).toEqual([picked[1], picked[2], picked[0]]);

    // remove one
    await rows.nth(1).getByTestId('setlist-remove').click();
    await expect.poll(order).toEqual([picked[1], picked[0]]);
    await expect(page.getByTestId('nav-setlist').getByTestId('setlist-count')).toContainText('2');

    // survives a reload (localStorage)
    await page.reload();
    await expect.poll(order).toEqual([picked[1], picked[0]]);

    // share link
    await page.getByTestId('setlist-share').click();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).toMatch(new RegExp(`/setlist\\?ids=${picked[1]}(,|%2C)${picked[0]}$`));

    // a friend (fresh browser, empty setlist) opens it and imports it
    const friendContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    const friend = await friendContext.newPage();
    await friend.goto(shared.replace(/^https?:\/\/[^/]+/, ''));
    await expect(friend.getByTestId('setlist-shared-banner')).toBeVisible();
    await expect(friend.getByTestId('setlist-row')).toHaveCount(0);
    await friend.getByTestId('setlist-import').click();
    await expect(friend.getByTestId('setlist-shared-banner')).toHaveCount(0);
    await expect
      .poll(() => friend.getByTestId('setlist-row').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-setlist-id')))))
      .toEqual([picked[1], picked[0]]);
    await friendContext.close();

    // clear all (with confirm)
    await page.getByTestId('setlist-clear').click();
    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });
});

test.describe('STAR Prep rehearsal timer', () => {
  test('start, pause, resume, warning colours and reset (fake clock)', async ({ page }) => {
    await page.clock.install();
    await page.goto('/star-prep');
    const clock = page.getByTestId('timer-clock');
    const display = page.getByTestId('timer-display');
    await expect(display).toHaveText('0:00.0');
    await expect(clock).toHaveAttribute('data-zone', 'ok');

    await page.getByTestId('timer-toggle').click();
    await expect(page.getByTestId('timer-toggle')).toContainText('Pause');
    await page.clock.runFor(10_000);
    await expect(display).toHaveText(/^0:10\.\d$/);

    await page.getByTestId('timer-toggle').click(); // pause
    await expect(page.getByTestId('timer-toggle')).toContainText('Resume');
    await page.clock.runFor(30_000);
    await expect(display).toHaveText(/^0:10\.\d$/);

    await page.getByTestId('timer-toggle').click(); // resume
    await page.clock.fastForward(325_000); // → 5:35
    await expect(display).toHaveText(/^5:3\d\.\d$/);
    await expect(clock).toHaveAttribute('data-zone', 'warn');
    await page.clock.fastForward(30_000); // → 6:05
    await expect(clock).toHaveAttribute('data-zone', 'over');
    await expect(page.getByTestId('rehearsal-timer')).toContainText('Over 6:00');

    await page.getByTestId('timer-toggle').click();
    await page.getByTestId('timer-reset').click();
    await expect(display).toHaveText('0:00.0');
    await expect(clock).toHaveAttribute('data-zone', 'ok');
  });
});
