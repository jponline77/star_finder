import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { request, type FullConfig } from '@playwright/test';
import { ADMIN, CSRF } from './helpers';

const ROOT = path.resolve(__dirname, '..');
/** Must match STAR_DB_PATH in playwright.config.ts. */
const E2E_DB = path.join(process.env.E2E_DATA_DIR ? path.resolve(process.env.E2E_DATA_DIR) : path.join(ROOT, 'test-results'), 'e2e.db');

/**
 * Runs after the web server is up (Playwright starts `webServer` first; the fresh database is
 * built by e2e/prepare-db.mjs inside the webServer command). Creates the admin account used by the
 * admin/moderation specs the way a school would: sign up on the site, then promote the account with
 * `make-admin` (signing up never makes anyone an admin).
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('baseURL is not configured');
  const api = await request.newContext({ baseURL, extraHTTPHeaders: CSRF });
  try {
    const songs = await api.get('/api/songs');
    if (!songs.ok()) throw new Error(`GET /api/songs → ${songs.status()}`);
    const { total } = (await songs.json()) as { total: number };
    if (total < 100) throw new Error(`The e2e database only has ${total} songs — check e2e/prepare-db.mjs`);

    const signup = await api.post('/api/auth/signup', { data: ADMIN });
    if (signup.status() !== 201 && signup.status() !== 409) {
      throw new Error(`Admin signup failed: ${signup.status()} ${await signup.text()}`);
    }
    execFileSync(process.execPath, [path.join(ROOT, 'server', 'scripts', 'make-admin.js'), ADMIN.email], {
      cwd: ROOT,
      env: { ...process.env, STAR_DB_PATH: E2E_DB },
      stdio: 'pipe',
    });
    const login = await api.post('/api/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } });
    const body = (await login.json()) as { user?: { role: string } };
    if (!login.ok() || body.user?.role !== 'admin') {
      throw new Error(`Admin account is not an admin: ${login.status()} ${JSON.stringify(body)}`);
    }
  } finally {
    await api.dispose();
  }
}
