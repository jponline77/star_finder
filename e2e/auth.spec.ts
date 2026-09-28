import { expect, newAccount, test } from './helpers';

test.describe('Accounts', () => {
  test('sign up, log out, log back in (and a wrong password is refused)', async ({ page }) => {
    const acct = newAccount('Signup');

    await page.goto('/');
    await page.getByTestId('login-link').click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByRole('link', { name: /backstage pass/i }).click();
    await expect(page).toHaveURL(/\/signup/);

    await page.getByTestId('signup-name').fill(acct.displayName);
    await page.getByTestId('signup-email').fill(acct.email);
    await page.getByTestId('signup-password').fill(acct.password);
    await page.getByTestId('signup-submit').click();

    const menuButton = page.getByTestId('account-menu-button');
    await expect(menuButton).toContainText(acct.displayName);
    await expect(page).toHaveURL(/\/$/);

    // duplicate email is refused with a friendly message
    const dup = await page.request.post('/api/auth/signup', {
      data: acct,
      headers: { 'X-Requested-With': 'star-song-finder' },
    });
    expect(dup.status()).toBe(409);

    await menuButton.click();
    await expect(page.getByTestId('account-menu')).toContainText(acct.email);
    await expect(page.getByTestId('admin-link')).toHaveCount(0);
    await page.getByTestId('logout-button').click();
    await expect(page.getByTestId('login-link')).toBeVisible();
    await expect(page.getByTestId('account-menu-button')).toHaveCount(0);

    // wrong password
    await page.goto('/login?next=%2Fsetlist');
    await page.getByTestId('login-email').fill(acct.email);
    await page.getByTestId('login-password').fill('definitely-not-it');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toHaveText(/Email or password is incorrect/);
    await expect(page).toHaveURL(/\/login/);

    // right password → honours ?next=
    await page.getByTestId('login-password').fill(acct.password);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/setlist$/);
    await expect(page.getByTestId('account-menu-button')).toContainText(acct.displayName);

    // the session survives a reload
    await page.reload();
    await expect(page.getByTestId('account-menu-button')).toContainText(acct.displayName);
  });

  test('pages that need an account send you to log in and back', async ({ page }) => {
    await page.goto('/add');
    await expect(page).toHaveURL(/\/login\?next=%2Fadd/);
    const acct = newAccount('Redirect');
    await page.request.post('/api/auth/signup', { data: acct, headers: { 'X-Requested-With': 'star-song-finder' } });
    await page.goto('/login?next=%2Fadd');
    await expect(page).toHaveURL(/\/add$/);
    // "/add" starts with "Find your song" (SPEC §7c)
    await expect(page.getByTestId('find-song')).toBeVisible();
  });

  test('signup validates the display name and password', async ({ page }) => {
    await page.goto('/signup');
    await page.getByTestId('signup-name').fill('x');
    await page.getByTestId('signup-email').fill('not-an-email');
    await page.getByTestId('signup-password').fill('short');
    await page.getByTestId('signup-submit').click();
    await expect(page).toHaveURL(/\/signup/);
    await expect(page.locator('.field-error').first()).toBeVisible();
    await expect(page.getByTestId('account-menu-button')).toHaveCount(0);
  });
});
