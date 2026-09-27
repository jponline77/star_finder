import { expect, songByTitle, stubAudio, test } from './helpers';

test.describe('Song detail', () => {
  test('a solo with a director’s note shows parts, timing, links and a live slate', async ({ page }) => {
    const song = await songByTitle(page.request, 'Into the Fire');
    expect(song.notes).toBeTruthy();
    await page.goto(`/songs/${song.id}`);

    await expect(page.getByTestId('song-detail-title')).toHaveText(song.title);
    await expect(page).toHaveTitle(/Into the Fire — The Scarlet Pimpernel/);
    await expect(page.getByTestId('song-show-link')).toContainText('The Scarlet Pimpernel');
    await expect(page.getByTestId('song-credits')).toContainText('Frank Wildhorn');

    const parts = page.getByTestId('song-part');
    await expect(parts).toHaveCount(1);
    await expect(parts.first()).toContainText(song.parts[0].character);
    await expect(parts.first()).toContainText(song.parts[0].vocalRange!);

    await expect(page.getByTestId('timing-card')).toHaveAttribute('data-status', 'ok');
    await expect(page.getByTestId('timing-card').getByTestId('time-limit-bar')).toBeVisible();
    await expect(page.getByTestId('timing-card')).toContainText('3:51');

    await expect(page.getByTestId('directors-note')).toContainText(song.notes!.slice(0, 40));
    await expect(page.getByTestId('mature-note')).toHaveCount(0);

    await expect(page.getByTestId('song-hero').getByTestId('play-preview')).toBeEnabled();
    await expect(page.getByTestId('preview-credit')).toContainText('Apple Music');
    await expect(page.getByTestId('link-backing-track')).toHaveAttribute('href', /youtube\.com\/results\?search_query=.*karaoke/);
    await expect(page.getByTestId('link-sheet-music')).toHaveAttribute('href', /musicnotes\.com/);
    await expect(page.getByTestId('check-time')).toHaveAttribute('data-status', 'ok');
    await expect(page.getByTestId('similar-songs').getByTestId('song-card').first()).toBeVisible();

    // Slate builder updates live
    const slate = page.getByTestId('slate-text');
    await expect(slate).toContainText('Into the Fire');
    await page.getByTestId('slate-name').fill('Jordan Lee');
    await page.getByTestId('slate-school').fill('Maple Ridge Secondary');
    await page.getByTestId('slate-troupe').fill('1234');
    await expect(slate).toContainText('I am Jordan Lee from Maple Ridge Secondary, Troupe #1234');
    await expect(slate).toContainText(/performing .Into the Fire. from The Scarlet Pimpernel by Frank Wildhorn/);
  });

  test('a long mature duet shows two parts, the over-limit warning and the mature callout', async ({ page }) => {
    const song = await songByTitle(page.request, 'Corn');
    expect(song.kind).toBe('duet');
    await page.goto(`/songs/${song.id}`);

    await expect(page.getByTestId('song-detail-title')).toHaveText('Corn');
    const parts = page.getByTestId('song-part');
    await expect(parts).toHaveCount(2);
    for (const [i, p] of song.parts.entries()) await expect(parts.nth(i)).toContainText(p.character);

    await expect(page.getByTestId('timing-card')).toHaveAttribute('data-status', 'over');
    await expect(page.getByTestId('timing-headline')).toContainText(/over/i);
    await expect(page.getByTestId('check-time')).toHaveAttribute('data-status', 'bad');
    await expect(page.getByTestId('mature-note')).toBeVisible();
    await expect(page.getByTestId('directors-note')).toBeVisible();

    // Duet slate uses "Our names are …"
    await page.getByTestId('slate-name').fill('Lee Jones');
    await page.getByTestId('slate-name-2').fill('Sam Becker');
    await expect(page.getByTestId('slate-text')).toContainText('Our names are Lee Jones and Sam Becker');
    await expect(page.getByTestId('slate-text')).toContainText("we'll be performing");
  });

  test('an unknown song id shows the not-found state', async ({ page }) => {
    await page.goto('/songs/999999');
    await expect(page.getByTestId('song-not-found')).toBeVisible();
  });
});

test.describe('Audio previews', () => {
  test.beforeEach(async ({ page }) => stubAudio(page));

  test('pressing play on a card starts the mini player; pause and close work', async ({ page }) => {
    await page.goto('/songs?hasAudio=1');
    const card = page.getByTestId('song-card').first();
    const title = (await card.getByTestId('song-title').textContent())!.trim();
    await card.getByTestId('play-preview').click();

    const player = page.getByTestId('mini-player');
    await expect(player).toBeVisible();
    await expect(player.getByTestId('mini-player-title')).toHaveText(title);
    await expect(player.getByTestId('mini-player-toggle')).toHaveAttribute('aria-label', 'Pause');
    expect(await page.evaluate(() => (window as unknown as { __plays: string[] }).__plays)).toEqual([expect.stringMatching(/^https:\/\/.*(itunes\.apple|mzstatic)\.com\//)]);

    await player.getByTestId('mini-player-toggle').click();
    await expect(player.getByTestId('mini-player-toggle')).toHaveAttribute('aria-label', 'Play');

    // only one preview at a time: playing another card swaps the track
    const second = page.getByTestId('song-card').nth(1);
    const secondTitle = (await second.getByTestId('song-title').textContent())!.trim();
    await second.getByTestId('play-preview').click();
    await expect(player.getByTestId('mini-player-title')).toHaveText(secondTitle);

    await player.getByTestId('mini-player-close').click();
    await expect(player).toBeHidden();
  });

  test('the song page play button plays that song', async ({ page }) => {
    const song = await songByTitle(page.request, 'Wedding Song');
    await page.goto(`/songs/${song.id}`);
    await page.getByTestId('song-hero').getByTestId('play-preview').click();
    await expect(page.getByTestId('mini-player-title')).toHaveText('Wedding Song');
    // the mini player keeps playing across navigation
    await page.getByTestId('nav-browse').click();
    await expect(page.getByTestId('mini-player-title')).toHaveText('Wedding Song');
  });
});
