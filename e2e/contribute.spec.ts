import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  ADMIN, allSongs, apiCreateSolo, apiLogin, apiLogout, apiSignup, CSRF, expect, songByTitle, stubAudio, test, uniq,
} from './helpers';

/** Network lookups (Apple / Wikipedia) are mocked so the suite runs offline and deterministically. */
async function mockLookups(page: Page, showName: string) {
  await page.route('**/api/lookup/wikipedia?**', (route) =>
    route.fulfill({
      json: {
        found: true,
        title: `${showName} (musical)`,
        description: 'Musical comedy',
        extract: `${showName} is a musical comedy about a theatre troupe who put on a show in a single night.`,
        wikiUrl: 'https://en.wikipedia.org/wiki/Example_(musical)',
      },
    }),
  );
  await page.route('**/api/lookup/itunes?**', (route) =>
    route.fulfill({
      json: {
        candidates: [1, 2].map((n) => ({
          trackId: 990000 + n,
          trackName: n === 1 ? 'Opening Night Jitters' : 'Opening Night Jitters (Reprise)',
          collectionName: `${showName} (Original Cast Recording)`,
          artistName: 'Original Cast',
          previewUrl: `https://audio-ssl.itunes.apple.com/itunes-assets/e2e/preview-${n}.m4a`,
          // a local "cached" cover (written by e2e/prepare-db.mjs) so the server doesn't download anything
          artworkUrl: '/media/art/e2e-cover.png',
          appleMusicUrl: `https://music.apple.com/ca/album/e2e/${n}`,
          durationSeconds: 165 + n,
          score: 95 - n * 10,
        })),
      },
    }),
  );
}

async function chooseShow(page: Page, text: string, option: 'new' | RegExp) {
  const input = page.getByTestId('song-show');
  await input.fill(text);
  if (option === 'new') await page.getByTestId('song-show-new').click();
  else await page.getByTestId('song-show-option').filter({ hasText: option }).first().click();
}

test.describe('Adding and editing songs', () => {
  test('add a solo from a brand-new show (Wikipedia info + preview), then edit it', async ({ page }) => {
    const { account } = await apiSignup(page.request);
    const showName = `Opening Night ${uniq()}`;
    const title = 'Opening Night Jitters';
    await mockLookups(page, showName);

    await page.goto('/add?manual=1');
    const form = page.getByTestId('add-song-form');
    await expect(form).toBeVisible();
    await expect(page.getByTestId('song-kind-solo')).toHaveAttribute('aria-checked', 'true');

    await chooseShow(page, showName, 'new');
    await expect(page.getByTestId('new-show-panel')).toContainText(showName);
    await page.getByTestId('fetch-wikipedia').click();
    await expect(page.getByTestId('wiki-result')).toContainText(`${showName} (musical)`);
    await expect(page.getByTestId('new-show-description')).toHaveValue(/theatre troupe/);
    await page.getByTestId('new-show-composer').fill('Pat Composer');
    await page.getByTestId('new-show-year').fill('2019');

    await form.getByTestId('song-title').fill(title);
    await page.getByTestId('part-1-character').fill('Stage Manager');
    await page.getByTestId('part-1-range').selectOption('Mezzo-soprano');
    await page.getByTestId('song-genre').selectOption('Comedy');
    await page.getByTestId('song-subgenre').fill('Tongue-in-Cheek');
    await page.getByTestId('song-length').fill('2:45');
    await page.getByTestId('song-notes').fill('Great for a big, bright voice.');

    await page.getByTestId('find-preview').click();
    await expect(page.getByTestId('preview-candidate')).toHaveCount(2);
    await page.getByTestId('use-preview-0').click();
    await expect(page.getByTestId('chosen-preview')).toContainText('Opening Night Jitters');

    await page.getByTestId('submit-song').click();
    await expect(page.locator('canvas.confetti-canvas')).toBeAttached();
    await expect(page).toHaveURL(/\/songs\/\d+$/);
    await expect(page.getByTestId('toast').filter({ hasText: 'is now on the list' })).toBeVisible();
    await expect(page.getByTestId('song-detail-title')).toHaveText(title);
    await expect(page.getByTestId('song-show-link')).toContainText(showName);
    await expect(page.getByTestId('community-ribbon')).toBeVisible();
    await expect(page.getByTestId('added-by')).toContainText(account.displayName);
    await expect(page.getByTestId('song-part')).toContainText('Stage Manager');
    await expect(page.getByTestId('preview-track')).toBeVisible();
    await expect(page.getByTestId('directors-note')).toContainText('big, bright voice');
    const songId = Number(page.url().split('/').pop());

    // the new show exists with the Wikipedia description
    const show = await (await page.request.get(`/api/songs/${songId}`)).json();
    expect(show.show.name).toBe(showName);
    const showDetail = await (await page.request.get(`/api/shows/${show.show.slug}`)).json();
    expect(showDetail.description).toMatch(/theatre troupe/);
    expect(showDetail.composer).toBe('Pat Composer');
    expect(showDetail.source).toBe('community');

    // edit own song
    await page.getByTestId('edit-button').click();
    await expect(page).toHaveURL(new RegExp(`/songs/${songId}/edit$`));
    await expect(form.getByTestId('song-title')).toHaveValue(title);
    await form.getByTestId('song-title').fill(`${title} (Revised)`);
    await page.getByTestId('song-length').fill('6:30');
    await page.getByTestId('submit-song').click();
    await expect(page).toHaveURL(new RegExp(`/songs/${songId}$`));
    await expect(page.getByTestId('toast').filter({ hasText: 'are live' })).toBeVisible();
    await expect(page.getByTestId('song-detail-title')).toHaveText(`${title} (Revised)`);
    await expect(page.getByTestId('timing-card')).toHaveAttribute('data-status', 'over');
    // the preview was kept (not sent on edit)
    await expect(page.getByTestId('preview-track')).toBeVisible();
  });

  test('find-first: a catalog song pre-fills the form, the best recording is picked, album art uploads', async ({ page, request }, testInfo) => {
    if (testInfo.retry) {
      // The server refuses a second solo of the same catalog song in the same show (a true
      // duplicate, whatever its title): an admin removes what a failed attempt left behind.
      await apiLogin(request, ADMIN);
      for (const s of await allSongs(request, `q=${encodeURIComponent("I'm Not That Girl")}`)) {
        if (s.show.name === 'Wicked') await request.delete(`/api/songs/${s.id}`, { headers: CSRF });
      }
    }
    await apiSignup(page.request);
    // Apple is mocked (the catalog is the committed fixture: Wicked isn't on the site yet)
    await page.route('**/api/catalog/songs/*/recordings', (route) =>
      route.fulfill({
        json: {
          candidates: [
            {
              trackId: 880001,
              trackName: "I'm Not That Girl",
              collectionId: 77,
              collectionName: 'Wicked (Original Broadway Cast Recording)',
              artistName: 'Idina Menzel',
              previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/e2e/wicked-1.m4a',
              artworkUrl: '/media/art/e2e-cover.png',
              appleMusicUrl: 'https://music.apple.com/ca/album/e2e/880001',
              durationSeconds: 177,
              score: 100,
              castAlbum: true,
              albumLabel: 'original cast recording',
            },
          ],
        },
      }),
    );

    await page.goto('/add');
    await expect(page.getByTestId('find-song')).toBeVisible();
    await page.getByTestId('catalog-search').fill('not that girl');
    await page.locator('[data-testid="catalog-option"][data-type="song"]').filter({ hasText: "I'm Not That Girl" }).first().click();
    await expect(page).toHaveURL(/\/add\?catalogSong=\d+/);

    const form = page.getByTestId('add-song-form');
    await expect(page.getByTestId('catalog-banner')).toContainText('Wicked');
    await expect(form.getByTestId('song-title')).toHaveValue("I'm Not That Girl");
    await expect(page.getByTestId('song-show')).toHaveValue('Wicked');
    await expect(page.getByTestId('song-kind-solo')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('part-1-character')).toHaveValue('Elphaba');
    await expect(page.getByTestId('part-1-range')).toHaveValue('Mezzo-soprano');
    // the best recording is picked by itself and brings the length
    await expect(page.getByTestId('chosen-preview')).toContainText('Wicked (Original Broadway Cast Recording)');
    await expect(page.getByTestId('song-length')).toHaveValue('2:57');

    const title = `I'm Not That Girl ${uniq()}`; // unique title (a retry also clears the catalog-song duplicate above)
    await form.getByTestId('song-title').fill(title);
    await page.getByTestId('song-art-file-input').setInputFiles(path.join(__dirname, '..', 'server', 'test', 'fixtures', 'plain.png'));
    await page.getByTestId('submit-song').click();
    await expect(page).toHaveURL(/\/songs\/\d+$/);
    await expect(page.getByTestId('song-detail-title')).toHaveText(title);
    await expect(page.getByTestId('media-panel')).toBeVisible();

    const id = Number(new URL(page.url()).pathname.split('/').pop());
    const song = await (await page.request.get(`/api/songs/${id}`)).json();
    expect(song.catalogSongId).toBeGreaterThan(0);
    expect(song.lengthSeconds).toBe(177);
    expect(song.parts).toEqual([{ position: 1, character: 'Elphaba', vocalRange: 'Mezzo-soprano' }]);
    expect(song.media).toMatchObject({ artworkSource: 'upload', recordingArtworkUrl: '/media/art/e2e-cover.png' });
    expect(song.media.artworkUrl).toMatch(/^\/uploads\/art\//);
    // the new show was made from the catalog: linked, with its credits
    const show = await (await page.request.get(`/api/shows/${song.show.id}`)).json();
    expect(show).toMatchObject({ name: 'Wicked', composer: 'Stephen Schwartz', year: 2003 });
    expect(show.catalogShowId).toBeGreaterThan(0);
  });

  test('add a duet to an existing show', async ({ page }) => {
    await apiSignup(page.request);
    const title = `Road to Hadestown ${uniq()}`;
    await page.goto('/add?manual=1');
    await page.getByTestId('song-kind-duet').click();
    await chooseShow(page, 'hades', /Hadestown/);
    await expect(page.getByTestId('new-show-panel')).toHaveCount(0);

    await page.getByTestId('add-song-form').getByTestId('song-title').fill(title);
    await page.getByTestId('part-1-character').fill('Orpheus');
    await page.getByTestId('part-1-range').selectOption('Tenor');
    await page.getByTestId('part-2-character').fill('Eurydice');
    await page.getByTestId('part-2-range').selectOption('Alto');
    await page.getByTestId('song-genre').selectOption('Romantic');
    await page.getByTestId('song-length').fill('3:10');
    await page.getByTestId('submit-song').click();

    await expect(page.locator('canvas.confetti-canvas')).toBeAttached();
    await expect(page).toHaveURL(/\/songs\/\d+$/);
    await expect(page.getByTestId('song-detail-title')).toHaveText(title);
    await expect(page.getByTestId('song-show-link')).toContainText('Hadestown');
    const parts = page.getByTestId('song-part');
    await expect(parts).toHaveCount(2);
    await expect(parts.nth(0)).toContainText('Orpheus');
    await expect(parts.nth(1)).toContainText('Eurydice');

    // it shows up on the show page and in browse
    await page.goto('/shows/hadestown');
    await expect(page.getByTestId('duets-section')).toContainText(title);
    await page.goto(`/songs?q=${encodeURIComponent(title)}`);
    await expect(page.getByTestId('song-card')).toHaveCount(1);

    // adding it again → friendly duplicate message
    await page.goto('/add?manual=1&show=hadestown&kind=duet');
    await expect(page.getByTestId('song-show')).toHaveValue('Hadestown');
    await page.getByTestId('add-song-form').getByTestId('song-title').fill(title);
    await page.getByTestId('part-1-character').fill('Orpheus');
    await page.getByTestId('part-2-character').fill('Eurydice');
    await page.getByTestId('submit-song').click();
    await expect(page.getByTestId('duplicate-song')).toBeVisible();
  });

  test('validation errors are listed and focus the first bad field', async ({ page }) => {
    await apiSignup(page.request);
    await page.goto('/add?manual=1');
    await page.getByTestId('song-length').fill('3:75');
    await page.getByTestId('submit-song').click();
    await expect(page.getByTestId('form-error-summary')).toBeVisible();
    await expect(page.getByTestId('form-error-summary')).toContainText(/title/i);
    await expect(page.getByTestId('form-error-summary')).toContainText(/show/i);
    await expect(page.getByTestId('form-error-summary')).toContainText(/minutes:seconds|seconds/i);
    // focus jumps to the first problem on screen (the show picker)
    await expect(page.getByTestId('song-show')).toBeFocused();
    await expect(page).toHaveURL(/\/add\?manual=1$/);
  });

  test('other users can’t edit your song (no Edit button, 403 from the API)', async ({ page }) => {
    await apiSignup(page.request);
    const song = await apiCreateSolo(page.request);
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId('edit-button')).toBeVisible();
    await expect(page.getByTestId('delete-button')).toBeVisible();

    await apiLogout(page.request);
    const { account: other } = await apiSignup(page.request);
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId('account-menu-button')).toContainText(other.displayName);
    await expect(page.getByTestId('song-detail-title')).toHaveText(song.title);
    await expect(page.getByTestId('added-by')).toBeVisible();
    await expect(page.getByTestId('edit-button')).toHaveCount(0);
    await expect(page.getByTestId('delete-button')).toHaveCount(0);

    const put = await page.request.put(`/api/songs/${song.id}`, {
      headers: CSRF,
      data: { kind: 'solo', title: 'Hijacked', showId: song.show.id, parts: [{ character: 'Nobody' }] },
    });
    expect(put.status()).toBe(403);
    expect((await put.json()).error).toBe('You can only edit songs you added');
    expect((await page.request.delete(`/api/songs/${song.id}`, { headers: CSRF })).status()).toBe(403);

    await page.goto(`/songs/${song.id}/edit`);
    await expect(page.getByTestId('edit-locked')).toBeVisible();
    await expect(page.getByTestId('submit-song')).toHaveCount(0);
  });

  test('spreadsheet songs are read-only for normal users', async ({ page }) => {
    await apiSignup(page.request);
    const song = await songByTitle(page.request, 'Flowers');
    expect(song.source).toBe('spreadsheet');
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId('added-by')).toContainText(/STAR spreadsheet/i);
    await expect(page.getByTestId('edit-button')).toHaveCount(0);

    const put = await page.request.put(`/api/songs/${song.id}`, {
      headers: CSRF,
      data: { kind: 'solo', title: 'Flowers', showId: song.show.id, parts: [{ character: 'Eurydice' }] },
    });
    expect(put.status()).toBe(403);
    await page.goto(`/songs/${song.id}/edit`);
    await expect(page.getByTestId('edit-locked')).toContainText(/admin/i);
  });

  test('the owner uploads practice audio, plays it, and removes it', async ({ page }) => {
    await stubAudio(page);
    await apiSignup(page.request);
    const song = await apiCreateSolo(page.request);
    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId('audio-manager')).toBeVisible();

    // a file that isn't audio is refused before upload
    await page.getByTestId('audio-file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') });
    await expect(page.getByTestId('audio-upload-error')).toContainText(/MP3|audio/i);

    // a real (tiny) MP3 — the server checks for actual MPEG frames, not just an "ID3" prefix
    const mp3 = fs.readFileSync(path.join(__dirname, '..', 'server', 'test', 'fixtures', 'tone.mp3'));
    await page.getByTestId('audio-file-input').setInputFiles({ name: 'practice-track.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
    await expect(page.getByTestId('uploaded-track')).toBeVisible();
    await expect(page.getByTestId('audio-upload-error')).toHaveCount(0);
    const updated = await (await page.request.get(`/api/songs/${song.id}`)).json();
    expect(updated.media.audioUrl).toMatch(/^\/uploads\/audio\/[\w-]+\.mp3$/);
    const file = await page.request.get(updated.media.audioUrl);
    expect(file.status()).toBe(200);
    expect(file.headers()['x-content-type-options']).toBe('nosniff');

    await page.getByTestId('uploaded-track').getByTestId('play-preview').click();
    await expect(page.getByTestId('mini-player')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __plays: string[] }).__plays.at(-1))).toContain(updated.media.audioUrl);

    await page.getByTestId('audio-remove').click();
    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('uploaded-track')).toHaveCount(0);
    await expect(page.getByTestId('mini-player')).toHaveCount(0);
    expect((await page.request.get(updated.media.audioUrl)).status()).toBe(404);
  });

  test('the owner can delete their song', async ({ page }) => {
    await apiSignup(page.request);
    const song = await apiCreateSolo(page.request);
    await page.goto(`/songs/${song.id}`);
    await page.getByTestId('delete-button').click();
    await page.getByTestId('confirm-button').click();
    await expect(page).toHaveURL(/\/songs$/);
    await expect(page.getByTestId('toast').first()).toBeVisible();
    expect((await page.request.get(`/api/songs/${song.id}`)).status()).toBe(404);
  });
});
