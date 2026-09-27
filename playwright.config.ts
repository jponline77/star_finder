import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (`npm run e2e`).
 *
 * The web server is the real production build: the client is built, a fresh database is imported
 * from the committed seed files into test-results/ (e2e/prepare-db.mjs), then Express serves the
 * API + client/dist on port 3501 (E2E_PORT to change it; E2E_DATA_DIR moves the test-results/
 * data). Nothing in server/data, server/media or server/uploads is read or modified.
 * e2e/global-setup.ts then signs up the admin account (admin@test.local) and promotes it with
 * `make-admin`.
 *
 * Uses the Chromium that ships with @playwright/test 1.63.0 (already cached — never run
 * `playwright install`).
 */
const PORT = Number(process.env.E2E_PORT) || 3501;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = process.env.E2E_DATA_DIR ? path.resolve(process.env.E2E_DATA_DIR) : path.join(__dirname, 'test-results');
const out = (p: string) => path.join(DATA_DIR, p);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/artifacts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
    locale: 'en-CA',
    timezoneId: 'America/Vancouver',
  },
  projects: [
    // Specs that compare the UI with live counts from the API run first, while nothing is being
    // added to the database (they only read, so they run in parallel with each other).
    {
      name: 'read-only',
      testMatch: /(browse|shows|song-detail|fun|stats-export|mobile)\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    // Specs that sign up, add songs, comment and moderate.
    {
      name: 'accounts-and-writes',
      testMatch: /(auth|contribute|comments|admin|routes)\.spec\.ts$/,
      dependencies: ['read-only'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: 'npm run build && node e2e/prepare-db.mjs && node server/src/index.js',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      // absolute, so it doesn't matter which directory `npm run e2e` was started from
      E2E_DATA_DIR: DATA_DIR,
      STAR_DB_PATH: out('e2e.db'),
      STAR_UPLOADS_DIR: out('e2e-uploads'),
      STAR_MEDIA_DIR: out('e2e-media'),
      // one IP runs every test — lift the per-minute/per-day limits (login limits stay real)
      STAR_WRITE_LIMIT: '100000',
      STAR_READ_LIMIT: '100000',
      STAR_EXPORT_LIMIT: '100000',
      STAR_COMMENT_LIMIT: '100000',
      STAR_SIGNUP_LIMIT: '100000',
      STAR_SIGNUP_CONFLICT_LIMIT: '100000',
      STAR_LOOKUP_LIMIT: '100000',
      STAR_DAILY_SONG_LIMIT: '100000',
      STAR_DAILY_SHOW_LIMIT: '100000',
    },
  },
});
