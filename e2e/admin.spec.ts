import { ADMIN, allSongs, apiLogin, apiPostComment, apiSignup, CSRF, expect, newAccount, test, uniq } from './helpers';

test.describe('Admin', () => {
  test('non-admins see the polite “Admins only” page', async ({ page }) => {
    await apiSignup(page.request);
    await page.goto('/admin');
    await expect(page.getByTestId('admin-denied')).toBeVisible();
    expect((await page.request.get('/api/admin/users')).status()).toBe(403);
  });

  test('promote a user to admin, then disable and re-enable their account', async ({ page, request }) => {
    const { account, user } = await apiSignup(request);
    await apiLogin(page.request, ADMIN);
    await page.goto('/admin');
    await expect(page.getByTestId('admin-overview')).toBeVisible();
    await page.getByTestId('user-search').fill(account.email);
    const row = page.locator(`[data-testid=user-row][data-user-id="${user.id}"]`);
    await expect(row).toContainText(account.displayName);
    await expect(row).toContainText(account.email);

    // promote
    await row.getByTestId('user-role-switch').click({ force: true });
    await page.getByTestId('confirm-button').click();
    await expect(row.getByTestId('user-role-switch')).toBeChecked();
    await expect(row).toContainText('👑');
    let me = await (await request.get('/api/auth/me')).json();
    expect(me.user.role).toBe('admin');

    // demote again
    await row.getByTestId('user-role-switch').click({ force: true });
    await page.getByTestId('confirm-button').click();
    await expect(row.getByTestId('user-role-switch')).not.toBeChecked();

    // disable → their session is revoked and they can't log in
    await row.getByTestId('user-active-switch').click({ force: true });
    await page.getByTestId('confirm-button').click();
    await expect(row.getByTestId('user-active-switch')).not.toBeChecked();
    await expect(row).toContainText('Disabled');
    me = await (await request.get('/api/auth/me')).json();
    expect(me.user).toBeNull();
    const login = await request.post('/api/auth/login', { headers: CSRF, data: { email: account.email, password: account.password } });
    expect(login.status()).toBe(403);
    expect((await login.json()).error).toMatch(/disabled/);

    // re-enable
    await row.getByTestId('user-active-switch').click({ force: true });
    await page.getByTestId('confirm-button').click();
    await expect(row.getByTestId('user-active-switch')).toBeChecked();
    expect((await request.post('/api/auth/login', { headers: CSRF, data: { email: account.email, password: account.password } })).status()).toBe(200);
  });

  test('the only admin can’t demote themself into a locked-out site', async ({ page }) => {
    await apiLogin(page.request, ADMIN);
    const users = (await (await page.request.get('/api/admin/users')).json()).users as { id: number; email: string; role: string; disabled: boolean }[];
    const me = users.find((u) => u.email === ADMIN.email)!;
    // the e2e database is fresh, and the promotion test above demotes its user again
    expect(users.filter((u) => u.role === 'admin' && !u.disabled).map((u) => u.email)).toEqual([ADMIN.email]);

    // through the UI: flip your own admin switch → confirm → refused, still an admin
    await page.goto('/admin');
    await page.getByTestId('user-search').fill(ADMIN.email);
    const row = page.locator(`[data-testid=user-row][data-user-id="${me.id}"]`);
    await expect(row.getByTestId('user-role-switch')).toBeChecked();
    await row.getByTestId('user-role-switch').click({ force: true });
    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('toast').filter({ hasText: /last admin/ })).toBeVisible();
    await expect(row.getByTestId('user-role-switch')).toBeChecked();

    // and through the API
    const demote = await page.request.patch(`/api/admin/users/${me.id}`, { headers: CSRF, data: { role: 'user' } });
    expect(demote.status()).toBe(409);
    expect((await demote.json()).error).toMatch(/last admin/);
    expect((await (await page.request.get('/api/auth/me')).json()).user.role).toBe('admin');
    // disabling yourself is always refused
    const res = await page.request.patch(`/api/admin/users/${me.id}`, { headers: CSRF, data: { disabled: true } });
    expect(res.status()).toBe(409);
  });

  test('reset a password → the user must choose a new one on /me', async ({ page, request }) => {
    const { account, user } = await apiSignup(request);
    await apiLogin(page.request, ADMIN);
    await page.goto('/admin');
    await page.getByTestId('user-search').fill(account.email);
    const row = page.locator(`[data-testid=user-row][data-user-id="${user.id}"]`);
    await row.getByTestId('reset-password').click();
    await page.getByTestId('confirm-button').click();
    const temp = page.getByTestId('temp-password');
    await expect(temp).toBeVisible();
    const tempPassword = (await temp.textContent())!.trim();
    expect(tempPassword.length).toBeGreaterThanOrEqual(10);
    await page.getByTestId('temp-password-done').click();
    await expect(row).toContainText('Temp password');

    // the old password no longer works; the old session was revoked
    expect((await (await request.get('/api/auth/me')).json()).user).toBeNull();
    expect((await request.post('/api/auth/login', { headers: CSRF, data: { email: account.email, password: account.password } })).status()).toBe(401);

    // log out the admin, log in as the user with the temporary password
    await page.getByTestId('account-menu-button').click();
    await page.getByTestId('logout-button').click();
    await expect(page.getByTestId('login-link')).toBeVisible();
    await page.goto('/login');
    await page.getByTestId('login-email').fill(account.email);
    await page.getByTestId('login-password').fill(tempPassword);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByTestId('me-password-banner')).toBeVisible();

    const next = newAccount().password;
    await page.getByTestId('password-current').fill(tempPassword);
    await page.getByTestId('password-new').fill(next);
    await page.getByTestId('password-confirm').fill(next);
    await page.getByTestId('password-save').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Password updated' })).toBeVisible();
    await expect(page.getByTestId('me-password-banner')).toHaveCount(0);
    await expect(page.getByTestId('must-change-password-banner')).toHaveCount(0);

    const fresh = await request.post('/api/auth/login', { headers: CSRF, data: { email: account.email, password: next } });
    expect(fresh.status()).toBe(200);
    expect((await fresh.json()).user.mustChangePassword).toBe(false);
  });

  test('an admin can edit a spreadsheet show (even one with a long licensing note)', async ({ page }) => {
    const before = await (await page.request.get('/api/shows/smash')).json();
    expect(before.licensingNote.length).toBeGreaterThan(300);
    await apiLogin(page.request, ADMIN);
    await page.goto('/shows/smash');
    await page.getByTestId('edit-button').click();
    const modal = page.getByTestId('edit-show-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('show-licensing-note')).toHaveValue(before.licensingNote);
    await modal.getByTestId('show-book').fill('Rick Elice and Bob Martin');
    await modal.getByTestId('save-show').click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('show-credits')).toContainText('Rick Elice and Bob Martin');
    const after = await (await page.request.get('/api/shows/smash')).json();
    expect(after.bookWriter).toBe('Rick Elice and Bob Martin');
    expect(after.licensingNote).toBe(before.licensingNote);
  });

  test('users tab and comments tab render for admins; export link present', async ({ page }) => {
    await apiLogin(page.request, ADMIN);
    // the e2e database starts empty of comments — make sure the moderation feed has one to show
    const [song] = await allSongs(page.request);
    const body = `Moderation feed check ${uniq()}`;
    await apiPostComment(page.request, song.id, body);
    await page.goto('/admin');
    await expect(page.getByTestId('users-table')).toBeVisible();
    await expect(page.getByTestId('admin-download-xlsx')).toHaveAttribute('href', '/api/export.xlsx');
    await page.getByTestId('admin-tab-comments').click();
    await expect(page.getByTestId('comment-search')).toBeVisible();
    await page.getByTestId('comment-search').fill(body);
    await expect(page.getByText(body)).toBeVisible();
  });
});
