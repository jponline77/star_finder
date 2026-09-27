import { ADMIN, apiCreateSolo, apiLogin, apiLogout, apiPostComment, apiSignup, CSRF, expect, test, uniq } from './helpers';

test.describe('Backstage Chatter (comments)', () => {
  test('logged-out visitors see a log-in prompt', async ({ page, request }) => {
    const { songs } = (await (await request.get('/api/songs?q=stars')).json()) as { songs: { id: number }[] };
    await page.goto(`/songs/${songs[0].id}`);
    await expect(page.getByTestId('comments-section')).toBeVisible();
    await expect(page.getByTestId('comment-login-prompt')).toBeVisible();
    await expect(page.getByTestId('comment-input')).toHaveCount(0);
  });

  test('post, edit and delete your own comment', async ({ page }) => {
    const { account } = await apiSignup(page.request);
    const song = await apiCreateSolo(page.request);
    await page.goto(`/songs/${song.id}`);
    const section = page.getByTestId('comments-section');
    await expect(page.getByTestId('comment-count-link')).toHaveText(/Start the chatter/);

    const body = `Breathe before the last chorus! ${uniq()}`;
    await section.getByTestId('comment-input').fill(body);
    await section.getByTestId('comment-tag-tip').click();
    await section.getByTestId('comment-submit').click();

    const comment = section.getByTestId('comment').filter({ hasText: body });
    await expect(comment).toBeVisible();
    await expect(comment).toContainText(account.displayName);
    await expect(comment).toContainText(/Tip/);
    await expect(section.getByTestId('comment-input')).toHaveValue('');
    await expect(page.getByTestId('comment-count-link')).toHaveText('1 comment');

    // edit
    await comment.getByTestId('comment-edit').click();
    const editor = section.locator('li.comment.is-editing');
    await editor.getByTestId('comment-input').fill(`${body} (edited version)`);
    await editor.getByTestId('comment-save').click();
    const edited = section.getByTestId('comment').filter({ hasText: '(edited version)' });
    await expect(edited).toBeVisible();
    await expect(edited).toContainText(/edited/);

    // persists after reload
    await page.reload();
    await expect(section.getByTestId('comment').filter({ hasText: '(edited version)' })).toBeVisible();

    // delete
    await section.getByTestId('comment').filter({ hasText: '(edited version)' }).getByTestId('comment-delete').click();
    await page.getByTestId('confirm-button').click();
    await expect(section.getByTestId('comment')).toHaveCount(0);
    await expect(page.getByTestId('comment-count-link')).toHaveText(/Start the chatter/);
    const { comments } = await (await page.request.get(`/api/songs/${song.id}/comments`)).json();
    expect(comments).toEqual([]);
  });

  test("you can't edit or delete someone else's comment", async ({ page, request }) => {
    await apiSignup(request);
    const song = await apiCreateSolo(request);
    const theirs = await apiPostComment(request, song.id, `Their comment ${uniq()}`);
    await apiSignup(page.request);
    await page.goto(`/songs/${song.id}`);
    const comment = page.getByTestId('comment').filter({ hasText: 'Their comment' });
    await expect(comment).toBeVisible();
    await expect(comment.getByTestId('comment-edit')).toHaveCount(0);
    await expect(comment.getByTestId('comment-delete')).toHaveCount(0);
    expect((await page.request.delete(`/api/comments/${theirs.id}`, { headers: CSRF })).status()).toBe(403);
  });

  test('an admin removes another user’s comment from the song page', async ({ page, request }) => {
    const { account: author } = await apiSignup(request);
    const song = await apiCreateSolo(request);
    const text = `Please remove me ${uniq()}`;
    await apiPostComment(request, song.id, text, 'question');

    await apiLogin(page.request, ADMIN);
    await page.goto(`/songs/${song.id}`);
    const comment = page.getByTestId('comment').filter({ hasText: text });
    await expect(comment).toContainText(author.displayName);
    await comment.getByTestId('comment-delete').click();
    await page.getByTestId('confirm-button').click();
    await expect(comment).toHaveCount(0);
    const { comments } = await (await request.get(`/api/songs/${song.id}/comments`)).json();
    expect(comments).toEqual([]);
  });

  test('an admin removes a comment from the moderation feed', async ({ page, request }) => {
    await apiSignup(request);
    const song = await apiCreateSolo(request);
    const text = `Spam spam spam ${uniq()}`;
    await apiPostComment(request, song.id, text);

    await apiLogin(page.request, ADMIN);
    await page.goto('/admin');
    await page.getByTestId('admin-tab-comments').click();
    await page.getByTestId('comment-search').fill(text);
    const item = page.getByTestId('admin-comment').filter({ hasText: text });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(song.title);
    await item.getByTestId('admin-remove-comment').click();
    await page.getByTestId('confirm-button').click();
    await expect(item).toHaveCount(0);

    await page.goto(`/songs/${song.id}`);
    await expect(page.getByTestId('comments-section')).toBeVisible();
    await expect(page.getByTestId('comment').filter({ hasText: text })).toHaveCount(0);
    const { comments } = await (await request.get(`/api/songs/${song.id}/comments`)).json();
    expect(comments).toEqual([]);
  });

  test('comments on a show page', async ({ page }) => {
    await apiSignup(page.request);
    await page.goto('/shows/into-the-woods');
    const text = `Such a good show for duets ${uniq()}`;
    await page.getByTestId('comments-section').getByTestId('comment-input').fill(text);
    await page.getByTestId('comments-section').getByTestId('comment-submit').click();
    await expect(page.getByTestId('comment').filter({ hasText: text })).toBeVisible();
    await apiLogout(page.request);
  });
});
