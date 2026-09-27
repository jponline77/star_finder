import { allSongs, expect, test } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.describe('Mobile (390px)', () => {
  test('hamburger menu opens, navigates and closes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('nav-browse')).toBeHidden();
    const toggle = page.getByTestId('menu-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#mobile-nav')).toBeVisible();
    await page.getByTestId('mobile-nav-shows').click();
    await expect(page).toHaveURL(/\/shows$/);
    await expect(page.locator('#mobile-nav')).toHaveCount(0);

    // Escape closes it too
    await toggle.click();
    await expect(page.locator('#mobile-nav')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-nav')).toHaveCount(0);
  });

  test('browse filters live in a slide-over drawer', async ({ page }) => {
    const sopranos = await allSongs(page.request, 'range=Soprano');
    await page.goto('/songs');
    await expect(page.getByTestId('filter-panel')).toHaveCount(0);
    await page.getByTestId('open-filters').click();
    const drawer = page.getByTestId('filter-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByTestId('filter-range-Soprano').click();
    await expect(page).toHaveURL(/range=Soprano/);
    await expect(page.getByTestId('apply-filters')).toContainText(String(sopranos.length));
    await page.getByTestId('apply-filters').click();
    await expect(drawer).toBeHidden();
    await expect(page.getByTestId('result-count')).toHaveAttribute('data-count', String(sopranos.length));
    await expect(page.getByTestId('open-filters')).toContainText('1');
  });
});
