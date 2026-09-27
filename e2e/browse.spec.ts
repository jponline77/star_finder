import { allSongs, expect, test } from './helpers';

test.describe('Home and Browse', () => {
  test('home search box submits to the browse results', async ({ page }) => {
    const expected = await allSongs(page.request, 'q=les%20miserables');
    expect(expected.length).toBeGreaterThan(5);

    await page.goto('/');
    await expect(page.getByTestId('countdown')).toBeVisible();
    const search = page.getByTestId('search-input');
    await search.fill('les miserables');
    await search.press('Enter');

    await expect(page).toHaveURL(/\/songs\?q=les(\+|%20)miserables/);
    await expect(page.getByTestId('result-count')).toHaveAttribute('data-count', String(expected.length));
    await expect(page.getByTestId('song-card')).toHaveCount(expected.length);
    // accent-insensitive: "miserables" finds "Les Misérables"
    for (const card of await page.getByTestId('song-card').all()) await expect(card).toContainText('Les Misérables');
  });

  test('quick-pick chip opens a filtered browse page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('quick-comedy-duets').click();
    await expect(page).toHaveURL(/kind=duet/);
    await expect(page).toHaveURL(/genre=Comedy/);
    const expected = await allSongs(page.request, 'kind=duet&genre=Comedy');
    await expect(page.getByTestId('result-count')).toHaveAttribute('data-count', String(expected.length));
  });

  test('filters narrow the list, sync to the URL and work with the back button', async ({ page }) => {
    await page.goto('/songs');
    const count = page.getByTestId('result-count');
    const all = await allSongs(page.request);
    await expect(count).toHaveAttribute('data-count', String(all.length));

    await page.getByTestId('filter-kind-solo').first().click();
    await expect(page).toHaveURL(/[?&]kind=solo/);
    await expect(count).toHaveAttribute('data-count', String(all.filter((s) => s.kind === 'solo').length));

    await page.getByTestId('filter-range-Tenor').click();
    await expect(page).toHaveURL(/[?&]range=Tenor/);
    await page.getByTestId('filter-genre-Drama').click();
    await expect(page).toHaveURL(/[?&]genre=Drama/);
    const beforeMature = await allSongs(page.request, 'kind=solo&range=Tenor&genre=Drama');
    await expect(count).toHaveAttribute('data-count', String(beforeMature.length));

    await page.getByTestId('filter-hide-mature').check({ force: true });
    await expect(page).toHaveURL(/[?&]hideMature=1/);
    const noMature = await allSongs(page.request, 'kind=solo&range=Tenor&genre=Drama&hideMature=1');
    await expect(count).toHaveAttribute('data-count', String(noMature.length));

    // max length slider: Home = 1:00, then 8 × 15 s steps → 3:00
    const slider = page.getByTestId('filter-max-length');
    await slider.focus();
    await slider.press('Home');
    for (let i = 0; i < 8; i++) await slider.press('ArrowRight');
    await expect(page).toHaveURL(/[?&]maxSeconds=180/);
    const short = await allSongs(page.request, 'kind=solo&range=Tenor&genre=Drama&hideMature=1&maxSeconds=180');
    await expect(count).toHaveAttribute('data-count', String(short.length));
    expect(short.length).toBeLessThan(noMature.length);
    for (const card of await page.getByTestId('song-card').all()) await expect(card).toContainText('Tenor');
    await expect(page.getByTestId('filter-pill')).toHaveCount(5); // solo, tenor, drama, no mature, ≤ 3:00

    // a shared URL restores the same state
    const url = page.url();
    await page.goto(url);
    await expect(count).toHaveAttribute('data-count', String(short.length));
    await expect(page.getByTestId('filter-range-Tenor')).toHaveAttribute('aria-pressed', 'true');

    // back button: the slider replaces its history entry, so one Back undoes "hide mature" (+ slider)
    await page.goto('/songs');
    await page.getByTestId('filter-kind-solo').first().click();
    await page.getByTestId('filter-range-Tenor').click();
    await page.getByTestId('filter-genre-Drama').click();
    await page.getByTestId('filter-hide-mature').check({ force: true });
    await expect(page).toHaveURL(/hideMature=1/);
    await page.goBack();
    await expect(page).not.toHaveURL(/hideMature/);
    await expect(page.getByTestId('filter-hide-mature')).not.toBeChecked();
    await expect(count).toHaveAttribute('data-count', String(beforeMature.length));
    await page.goBack();
    await expect(page).not.toHaveURL(/genre=/);
    await expect(page.getByTestId('filter-genre-Drama')).toHaveAttribute('aria-pressed', 'false');

    // clear all
    await page.getByTestId('clear-filters').first().click();
    await expect(page).toHaveURL(/\/songs$/);
    await expect(count).toHaveAttribute('data-count', String(all.length));
  });

  test('table view sorts by column', async ({ page }) => {
    const all = await allSongs(page.request);
    const lengthOf = new Map(all.map((s) => [s.id, s.lengthSeconds ?? Number.POSITIVE_INFINITY]));
    await page.goto('/songs');
    await page.getByTestId('view-table').click();
    await expect(page).toHaveURL(/view=table/);
    await expect(page.getByTestId('song-row')).toHaveCount(all.length);

    const ids = async () => (await page.getByTestId('song-row').evaluateAll((rows) => rows.map((r) => Number(r.getAttribute('data-song-id')))));
    const header = page.getByTestId('sort-length');
    await header.click();
    await expect(page.locator('th', { has: header })).toHaveAttribute('aria-sort', 'ascending');
    let lengths = (await ids()).map((id) => lengthOf.get(id)!);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));

    await header.click();
    await expect(page.locator('th', { has: header })).toHaveAttribute('aria-sort', 'descending');
    lengths = (await ids()).map((id) => lengthOf.get(id)!).filter(Number.isFinite);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    expect(lengths[0]).toBe(Math.max(...all.map((s) => s.lengthSeconds ?? 0)));

    // clicking a row title opens the song
    const first = page.getByTestId('song-row').first();
    const firstId = await first.getAttribute('data-song-id');
    await first.getByTestId('song-title').click();
    await expect(page).toHaveURL(new RegExp(`/songs/${firstId}$`));
  });
});
