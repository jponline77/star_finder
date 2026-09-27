import { createRequire } from 'node:module';
import path from 'node:path';
import { allSongs, expect, test } from './helpers';

const requireFromServer = createRequire(path.resolve(__dirname, '..', 'server', 'package.json'));

test.describe('Stats & export', () => {
  test('stats page renders every chart', async ({ page }) => {
    const songs = await allSongs(page.request);
    await page.goto('/stats');
    await expect(page.getByTestId('stats-tiles')).toBeVisible();
    await expect(page.getByTestId('stats-tile-value').first()).toContainText(/\d/);
    for (const id of ['chart-kind', 'chart-genre', 'chart-subgenre', 'chart-range', 'chart-length', 'chart-shows', 'chart-mature', 'chart-preview']) {
      await expect(page.getByTestId(id), id).toBeVisible();
    }
    await expect(page.getByTestId('stats-ticker')).toContainText(`${songs.length} songs`);
    await expect(page.getByTestId('fun-facts')).toBeVisible();
    // bars link to the matching browse filter
    await page.getByTestId('chart-genre').getByRole('link').first().click();
    await expect(page).toHaveURL(/\/songs\?.*genre=/);
  });

  test('export.xlsx downloads a workbook with Solos and Duets sheets', async ({ page }, testInfo) => {
    await page.goto('/stats');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-xlsx').click()]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);

    // exceljs lives in server/node_modules (plain JS there), so describe just the bits we use
    interface Sheet {
      getRow(n: number): { values: unknown };
      actualRowCount: number;
    }
    const ExcelJS = requireFromServer('exceljs') as {
      Workbook: new () => { xlsx: { readFile(file: string): Promise<unknown> }; getWorksheet(name: string): Sheet | undefined };
    };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const solos = wb.getWorksheet('Solos');
    const duets = wb.getWorksheet('Duets');
    expect(solos).toBeTruthy();
    expect(duets).toBeTruthy();
    const headers = (solos!.getRow(1).values as unknown[]).filter(Boolean);
    expect(headers).toEqual(expect.arrayContaining(['Song', 'Character', 'Show', 'Genre', 'Sub-Genre', 'Vocal Range', 'Length', 'Mature Content?']));
    const soloCount = (await allSongs(page.request, 'kind=solo')).length;
    expect(solos!.actualRowCount - 1).toBeGreaterThanOrEqual(soloCount);
  });
});
