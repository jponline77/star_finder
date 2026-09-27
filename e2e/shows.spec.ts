import { expect, test } from './helpers';

test.describe('Shows', () => {
  test('poster wall lists every show and search narrows it', async ({ page }) => {
    const { shows } = (await (await page.request.get('/api/shows')).json()) as { shows: { slug: string; name: string }[] };
    await page.goto('/shows');
    await expect(page.getByTestId('show-card')).toHaveCount(shows.length);
    await expect(page.getByTestId('show-count')).toHaveAttribute('data-count', String(shows.length));

    await page.getByTestId('search-input').fill('miserables');
    await expect(page.getByTestId('show-card')).toHaveCount(1);
    await expect(page.getByTestId('show-card-title')).toHaveText(/Les Misérables/);
    await expect(page).toHaveURL(/q=miserables/);

    await page.getByTestId('show-card-title').click();
    await expect(page).toHaveURL(/\/shows\/les-miserables$/);
    await expect(page.getByTestId('show-title')).toHaveText('Les Misérables');
  });

  test('show detail has credits, licensing, cast and songs split into solos and duets', async ({ page }) => {
    const show = (await (await page.request.get('/api/shows/hadestown')).json()) as {
      name: string;
      imageUrl: string | null;
      soloCount: number;
      duetCount: number;
      characters: { name: string }[];
    };
    await page.goto('/shows/hadestown');
    await expect(page).toHaveTitle(/Hadestown/);
    await expect(page.getByTestId('show-title')).toHaveText('Hadestown');
    await expect(page.getByTestId('show-credits')).toContainText('Anaïs Mitchell');
    await expect(page.locator('.show-description')).toBeVisible();
    await expect(page.locator('.show-description')).not.toHaveClass(/is-empty/);
    // Posters aren't in the repository (`npm run fetch-media` downloads them): when the file is there it
    // must render; without it the gradient placeholder stands in.
    expect(show.imageUrl).toBe('/media/shows/hadestown.png');
    if ((await page.request.get(show.imageUrl!)).ok()) {
      const poster = page.getByTestId('show-hero').locator('img').first();
      await expect.poll(() => poster.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBeGreaterThan(0);
    } else {
      await expect(page.getByTestId('show-hero').locator('.show-poster-fallback')).toBeVisible();
      await expect(page.getByTestId('show-hero').locator('img')).toHaveCount(0);
    }
    await expect(page.getByTestId('licensing-panel')).toContainText(/Music Theatre International|MTI/);
    await expect(page.getByTestId('solos-section').getByTestId('song-card')).toHaveCount(show.soloCount);
    await expect(page.getByTestId('duets-section').getByTestId('song-card')).toHaveCount(show.duetCount);
    await expect(page.getByTestId('character-card')).toHaveCount(show.characters.length);
    await expect(page.getByTestId('comments-section')).toBeVisible();
    await expect(page.getByTestId('comment-login-prompt')).toBeVisible();

    // the song cards link to the song pages
    await page.getByTestId('solos-section').getByTestId('song-title').first().click();
    await expect(page).toHaveURL(/\/songs\/\d+$/);
    await expect(page.getByTestId('song-show-link')).toHaveText(/Hadestown/);
  });

  test('an unknown show shows a friendly not-found state', async ({ page }) => {
    await page.goto('/shows/not-a-real-musical');
    await expect(page.getByTestId('show-not-found')).toBeVisible();
  });
});
