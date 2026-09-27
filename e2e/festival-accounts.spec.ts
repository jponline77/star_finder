import type { Browser, BrowserContext, Page, PlaywrightWorkerArgs, TestInfo } from '@playwright/test';
import { ADMIN, apiFestivals, apiLogin, apiSignup, type ApiFestival, CSRF, expect, newAccount, storedFestival, test, uniq } from './helpers';

/**
 * Festivals with accounts (SPEC §7b): the choice is saved to the account and follows the student
 * to other browsers; admins add / edit / hide / delete festivals in Admin → Festivals and every
 * picker and the Home countdown follow.
 *
 * Runs in the accounts-and-writes project (after the read-only festivals.spec.ts has seen the
 * seeded list). Admin changes only touch a festival this spec creates, then deletes.
 */
const SEASON = new Date('2026-11-15T12:00:00-08:00');

async function pinClock(page: Page) {
  await page.clock.setFixedTime(SEASON);
}

/** A second browser (no cookies, no localStorage) set up like the configured project. */
async function otherBrowser(browser: Browser, testInfo: TestInfo): Promise<{ context: BrowserContext; page: Page }> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport ?? { width: 1280, height: 900 },
    locale: use.locale,
    timezoneId: use.timezoneId,
    colorScheme: use.colorScheme,
  });
  const page = await context.newPage();
  await pinClock(page);
  return { context, page };
}

/** Wait for the account save that a festival choice triggers. */
const festivalSaved = (page: Page, slug: string | null) =>
  page.waitForResponse((r) => r.url().endsWith('/api/auth/me') && r.request().method() === 'PUT' && r.ok() && (r.request().postDataJSON() as { festivalSlug?: unknown }).festivalSlug === slug);

async function accountFestival(page: Page): Promise<string | null | undefined> {
  const body = (await (await page.request.get('/api/auth/me')).json()) as { user: { festivalSlug: string | null } | null };
  return body.user?.festivalSlug;
}

async function loginThroughTheForm(page: Page, account: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(account.email);
  await page.getByTestId('login-password').fill(account.password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('account-menu-button')).toBeVisible();
}

test.describe('Festivals and accounts', () => {
  test.beforeEach(async ({ page }) => pinClock(page));

  test('a logged-in student’s festival is saved to the account and follows them to a new browser', async ({ page, browser }, testInfo) => {
    const { account } = await apiSignup(page.request, newAccount('Festival'));
    await page.goto('/');
    await expect(page.getByTestId('festival-where')).toBeVisible();

    const saved = festivalSaved(page, 'burnaby');
    await page.getByTestId('festival-chip-burnaby').click();
    await saved;
    await expect(page.getByTestId('home-eyebrow')).toContainText('Burnaby Regional STAR Fest');
    expect(await accountFestival(page)).toBe('burnaby');

    // My Stuff → My festival: shows it, and changes it
    await page.goto('/me');
    const card = page.getByTestId('me-festival');
    await expect(card.getByTestId('me-festival-select')).toHaveValue('burnaby');
    await expect(page.getByTestId('me-festival-status')).toHaveText('Saved to your account');
    await expect(card.getByTestId('festival-summary')).toContainText('Burnaby Mountain Secondary School');
    const changed = festivalSaved(page, 'prince-george');
    await card.getByTestId('me-festival-select').selectOption('prince-george');
    await changed;
    await expect(card.getByTestId('festival-summary')).toContainText('Prince George Secondary School');
    await expect(page.getByTestId('me-festival-status')).toHaveText('Saved to your account');
    expect(await accountFestival(page)).toBe('prince-george');

    // Another browser that had picked something else: logging in brings the account's festival
    const other = await otherBrowser(browser, testInfo);
    try {
      const p2 = other.page;
      await p2.goto('/?festival=victoria');
      await expect(p2.getByTestId('home-eyebrow')).toContainText('Victoria Regional STAR Fest');
      await loginThroughTheForm(p2, account);
      await p2.getByTestId('logo').click();
      await expect(p2.getByTestId('home-eyebrow')).toContainText('Prince George Regional STAR Fest · Friday, November 20, 2026');
      await expect(p2.getByTestId('header-festival')).toHaveAccessibleName('Your festival: Prince George');
      expect(await storedFestival(p2)).toBe('prince-george');
      // …and it wasn't overwritten by that browser's old choice
      expect(await accountFestival(p2)).toBe('prince-george');

      // logging out keeps the festival on that device
      await p2.getByTestId('account-menu-button').click();
      await p2.getByTestId('logout-button').click();
      await expect(p2.getByTestId('login-link')).toBeVisible();
      await expect(p2.getByTestId('home-eyebrow')).toContainText('Prince George Regional STAR Fest');
    } finally {
      await other.context.close();
    }

    // clearing it on My Stuff
    const cleared = festivalSaved(page, null);
    await page.getByTestId('me-festival-select').selectOption('');
    await cleared;
    expect(await accountFestival(page)).toBeNull();
    await page.getByTestId('logo').click();
    await expect(page.getByTestId('festival-where')).toBeVisible();
  });

  test('signing up keeps the festival you already picked', async ({ page }) => {
    await page.goto('/?festival=surrey');
    await expect(page.getByTestId('home-eyebrow')).toContainText('Surrey Regional STAR Fest');
    const acct = newAccount('Signup');
    await page.goto('/signup');
    await page.getByTestId('signup-name').fill(acct.displayName);
    await page.getByTestId('signup-email').fill(acct.email);
    await page.getByTestId('signup-password').fill(acct.password);
    await page.getByTestId('signup-submit').click();
    await expect(page.getByTestId('account-menu-button')).toContainText(acct.displayName);
    expect(await accountFestival(page)).toBe('surrey');
  });

  test('changing your mind while a save is on its way: the account keeps the last choice (A→B→A)', async ({ page }) => {
    await apiSignup(page.request, newAccount('Mind'));
    expect((await page.request.put('/api/auth/me', { data: { festivalSlug: 'burnaby' }, headers: CSRF })).ok()).toBe(true);
    // slow saves, so the second choice is made before the first one has answered
    await page.route('**/api/auth/me', async (route) => {
      if (route.request().method() === 'PUT') await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    const sent: unknown[] = [];
    const answered: number[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/auth/me') && r.method() === 'PUT') sent.push((r.postDataJSON() as { festivalSlug?: unknown }).festivalSlug);
    });
    page.on('response', (r) => {
      if (r.url().endsWith('/api/auth/me') && r.request().method() === 'PUT') answered.push(r.status());
    });
    await page.goto('/me');
    const select = page.getByTestId('me-festival-select');
    await expect(select).toHaveValue('burnaby');
    await select.selectOption('surrey');
    await select.selectOption('burnaby'); // back to the account's festival before Surrey's save answers
    await expect.poll(() => answered.length, { timeout: 10_000 }).toBe(2);
    expect(sent).toEqual(['surrey', 'burnaby']);
    expect(answered).toEqual([200, 200]);
    await expect(page.getByTestId('me-festival-status')).toHaveText('Saved to your account');
    await expect(select).toHaveValue('burnaby');
    await expect(page.getByTestId('header-festival')).toHaveAccessibleName('Your festival: Burnaby');
    expect(await storedFestival(page)).toBe('burnaby');
    expect(await accountFestival(page)).toBe('burnaby');
  });

  test('an account without a festival gets this browser’s choice when you log in', async ({ page, request }) => {
    const { account } = await apiSignup(request, newAccount('Local'));
    await page.goto('/');
    await page.getByTestId('festival-chip-online').click();
    await expect(page.getByTestId('home-festival')).toContainText('Online entries close in…');
    const saved = festivalSaved(page, 'online');
    await loginThroughTheForm(page, account);
    await saved;
    expect(await accountFestival(page)).toBe('online');
    await expect(page.getByTestId('header-festival')).toHaveAccessibleName('Your festival: Online');
  });
});

test.describe('Festivals and a temporary password', () => {
  test.beforeEach(async ({ page }) => pinClock(page));

  /** An admin resets the user's password (as in class); returns the temporary password. */
  async function adminReset(playwright: PlaywrightWorkerArgs['playwright'], testInfo: TestInfo, userId: number): Promise<string> {
    const admin = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL, extraHTTPHeaders: CSRF });
    try {
      await apiLogin(admin, ADMIN);
      const res = await admin.post(`/api/admin/users/${userId}/reset-password`);
      expect(res.status()).toBe(200);
      return ((await res.json()) as { temporaryPassword: string }).temporaryPassword;
    } finally {
      await admin.dispose();
    }
  }

  async function chooseNewPassword(page: Page, temp: string) {
    const next = newAccount().password;
    await page.getByTestId('password-current').fill(temp);
    await page.getByTestId('password-new').fill(next);
    await page.getByTestId('password-confirm').fill(next);
    await page.getByTestId('password-save').click();
  }

  test('the choice stays on this device until a new password is chosen, then goes to the account', async ({ page, request, playwright }, testInfo) => {
    const { account, user } = await apiSignup(request, newAccount('Temp'));
    const temp = await adminReset(playwright, testInfo, user.id);

    await loginThroughTheForm(page, { email: account.email, password: temp });
    await expect(page).toHaveURL(/\/me$/);
    const status = page.getByTestId('me-festival-status');
    await expect(status).toHaveText('Choose a new password first — then this is saved to your account too.');
    const puts: unknown[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/auth/me') && r.method() === 'PUT') puts.push(r.postDataJSON());
    });
    await page.getByTestId('me-festival-select').selectOption('victoria');
    await expect(page.getByTestId('me-festival').getByTestId('festival-summary')).toContainText('Victoria Regional STAR Fest');
    expect(await storedFestival(page)).toBe('victoria');
    expect(puts).toEqual([]);
    expect(await accountFestival(page)).toBeNull();

    const saved = festivalSaved(page, 'victoria');
    await chooseNewPassword(page, temp);
    await saved;
    expect(await accountFestival(page)).toBe('victoria');
    await expect(status).toHaveText('Saved to your account');
  });

  test('…also when the account already had a festival: the new choice wins over the old one', async ({ page, request, playwright }, testInfo) => {
    const { account, user } = await apiSignup(request, newAccount('Temp2'));
    expect((await request.put('/api/auth/me', { data: { festivalSlug: 'surrey' }, headers: CSRF })).ok()).toBe(true);
    const temp = await adminReset(playwright, testInfo, user.id);

    await loginThroughTheForm(page, { email: account.email, password: temp });
    await expect(page).toHaveURL(/\/me$/);
    const select = page.getByTestId('me-festival-select');
    await expect(select).toHaveValue('surrey');
    await select.selectOption('victoria');
    await expect(page.getByTestId('me-festival').getByTestId('festival-summary')).toContainText('Victoria Regional STAR Fest');
    expect(await accountFestival(page)).toBe('surrey');

    const saved = festivalSaved(page, 'victoria');
    await chooseNewPassword(page, temp);
    await saved;
    expect(await accountFestival(page)).toBe('victoria');
    await expect(select).toHaveValue('victoria');
    await expect(page.getByTestId('me-festival-status')).toHaveText('Saved to your account');
    await expect(page.getByTestId('header-festival')).toHaveAccessibleName('Your festival: Victoria');
    expect(await storedFestival(page)).toBe('victoria');
  });
});

test.describe('Admin → Festivals', () => {
  test.beforeEach(async ({ page }) => pinClock(page));

  test('add, edit (Home follows), hide (gone from the pickers), show again, delete', async ({ page, browser }, testInfo) => {
    await apiLogin(page.request, ADMIN);
    const id = uniq();
    const name = `Kelowna ${id} Regional STAR Fest`;
    const short = `Kelowna ${id}`;

    await page.goto('/admin');
    await page.getByTestId('admin-tab-festivals').click();
    await expect(page).toHaveURL(/[?&]tab=festivals/);
    const panel = page.getByTestId('festivals-panel');
    // every festival (hidden ones too) has a row
    for (const f of await apiFestivals(page.request, true)) await expect(panel.locator(`[data-testid=festival-row][data-slug="${f.slug}"]`)).toHaveCount(1);
    await expect(panel.locator('[data-testid=festival-row][data-slug=star-fest-west]')).toContainText('National');

    // ---- add (a clash and a bad link are refused first, against the right field)
    await page.getByTestId('festival-add').click();
    const modal = page.getByTestId('festival-modal');
    await expect(modal.getByRole('heading', { name: 'Add a festival' })).toBeVisible();
    await modal.getByTestId('festival-input-name').fill('Surrey Regional STAR Fest');
    await modal.getByTestId('festival-save').click();
    await expect(modal.getByTestId('festival-input-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(modal).toContainText('already uses the link name');

    await modal.getByTestId('festival-input-name').fill(name);
    await modal.getByTestId('festival-input-startDate').fill('2027-02-05');
    await modal.getByTestId('festival-input-venue').fill('Kelowna Community Theatre');
    await modal.getByTestId('festival-input-city').fill('Kelowna');
    await modal.getByTestId('festival-input-infoUrl').fill('http://example.com');
    await modal.getByTestId('festival-save').click();
    await expect(modal.getByTestId('festival-input-infoUrl')).toHaveAttribute('aria-invalid', 'true');
    await modal.getByTestId('festival-input-infoUrl').fill('https://taeacanada.ca/regional-star-fest/');
    const created = page.waitForResponse((r) => r.url().endsWith('/api/admin/festivals') && r.request().method() === 'POST' && r.status() === 201);
    await modal.getByTestId('festival-save').click();
    const festival = (await (await created).json()) as ApiFestival;
    expect(festival).toMatchObject({ name, kind: 'regional', province: 'BC', city: 'Kelowna', startDate: '2027-02-05', venue: 'Kelowna Community Theatre', active: true });
    expect(festival.slug).toBe(`kelowna-${id}`.toLowerCase());
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('toast').filter({ hasText: `${name} added` })).toBeVisible();
    const row = panel.locator(`[data-testid=festival-row][data-slug="${festival.slug}"]`);
    await expect(row).toContainText('Friday, February 5, 2027');
    await expect(row).toContainText(`/?festival=${festival.slug}`);

    // the new festival is in the header picker straight away (no reload)
    await page.getByTestId('header-festival').click();
    await page.getByTestId(`festival-option-${festival.slug}`).click();
    await expect(page.getByTestId('header-festival')).toHaveAccessibleName(`Your festival: ${short}`);
    await page.getByTestId('logo').click();
    await expect(page.getByTestId('home-eyebrow')).toContainText(`${name} · Friday, February 5, 2027`);
    await expect(page.getByTestId('home-festival')).toContainText('Curtain up at Kelowna Community Theatre in…');

    // a student who follows the teacher's link
    const student = await otherBrowser(browser, testInfo);
    try {
      await student.page.goto(`/?festival=${festival.slug}`);
      await expect(student.page.getByTestId('home-eyebrow')).toContainText(`${name} · Friday, February 5, 2027`);

      // ---- edit: new date and venue → Home follows
      await page.goto('/admin?tab=festivals');
      await row.getByTestId('festival-edit').click();
      await expect(modal.getByRole('heading', { name: `Edit ${name}` })).toBeVisible();
      await expect(modal.getByTestId('festival-input-venue')).toHaveValue('Kelowna Community Theatre');
      await modal.getByTestId('festival-input-startDate').fill('2027-02-12');
      await modal.getByTestId('festival-input-venue').fill('Kelowna Secondary School');
      await modal.getByTestId('festival-save').click();
      await expect(modal).toBeHidden();
      await expect(page.getByTestId('toast').filter({ hasText: `${name} saved` })).toBeVisible();
      await expect(row).toContainText('Friday, February 12, 2027');
      await expect(row).toContainText('Kelowna Secondary School');

      await page.getByTestId('logo').click(); // no reload: the site-wide list was refreshed
      await expect(page.getByTestId('home-eyebrow')).toContainText(`${name} · Friday, February 12, 2027`);
      await expect(page.getByTestId('home-festival')).toContainText('Curtain up at Kelowna Secondary School in…');
      await student.page.reload();
      await expect(student.page.getByTestId('home-eyebrow')).toContainText(`${name} · Friday, February 12, 2027`);
      await expect(student.page.getByTestId('home-festival')).toContainText('Curtain up at Kelowna Secondary School in…');

      // ---- hide: gone from every picker; people who chose it are asked again
      await page.goto('/admin?tab=festivals');
      await row.getByTestId('festival-active-switch').click({ force: true });
      await expect(row.getByTestId('festival-active-switch')).not.toBeChecked();
      await expect(row).toContainText('Hidden');
      expect((await apiFestivals(page.request)).map((f) => f.slug)).not.toContain(festival.slug);

      await page.getByTestId('header-festival').click();
      await expect(page.getByTestId('header-festival-listbox')).toBeVisible();
      await expect(page.getByTestId(`festival-option-${festival.slug}`)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.getByTestId('logo').click();
      await expect(page.getByTestId('festival-where')).toBeVisible();
      await expect(page.getByTestId(`festival-chip-${festival.slug}`)).toHaveCount(0);

      await student.page.reload();
      await expect(student.page.getByTestId('festival-where')).toBeVisible();
      await expect(student.page.getByTestId(`festival-chip-${festival.slug}`)).toHaveCount(0);
      await expect(student.page.getByTestId('festival-chip-surrey')).toBeVisible();
      await student.page.goto('/star-prep');
      await expect(student.page.locator(`[data-testid=festival-card][data-slug="${festival.slug}"]`)).toHaveCount(0);
      await student.page.goto(`/?festival=${festival.slug}`);
      await expect(student.page.getByTestId('toast').filter({ hasText: 'didn’t match a current festival' })).toBeVisible();

      // ---- show again: the admin's own choice (kept on the account) comes back
      await page.goto('/admin?tab=festivals');
      await row.getByTestId('festival-active-switch').click({ force: true });
      await expect(row.getByTestId('festival-active-switch')).toBeChecked();
      await expect(row).not.toContainText('Hidden');
      await page.getByTestId('logo').click();
      await expect(page.getByTestId('home-eyebrow')).toContainText(name);
    } finally {
      await student.context.close();
    }

    // ---- delete (confirmed): gone, and nobody has it chosen any more
    await page.goto('/admin?tab=festivals');
    await row.getByTestId('festival-delete').click();
    await expect(page.getByTestId('confirm-dialog')).toContainText(`Delete ${name}?`);
    await page.getByTestId('confirm-button').click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId('toast').filter({ hasText: `${name} deleted` })).toBeVisible();
    expect((await apiFestivals(page.request, true)).map((f) => f.slug)).not.toContain(festival.slug);
    expect(await accountFestival(page)).toBeNull();
  });
});
