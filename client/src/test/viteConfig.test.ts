// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

// vite.config.ts lives outside src/ (a different TS project), so load it by a computed path.
const CONFIG = ['..', '..', 'vite.config.ts'].join('/');

interface ProxyConfig {
  server: { proxy: Record<string, { target: string }> };
}

async function loadConfig(): Promise<ProxyConfig> {
  vi.resetModules();
  const mod = (await import(/* @vite-ignore */ CONFIG)) as { default: ProxyConfig };
  return mod.default;
}

afterEach(() => vi.unstubAllEnvs());

describe('vite dev proxy target', () => {
  it('follows PORT when VITE_API_TARGET is not set (PORT=4000 npm run dev)', async () => {
    vi.stubEnv('VITE_API_TARGET', '');
    vi.stubEnv('PORT', '4000');
    const config = await loadConfig();
    expect(config.server.proxy['/api']?.target).toBe('http://localhost:4000');
    expect(config.server.proxy['/media']?.target).toBe('http://localhost:4000');
  });
  it('prefers VITE_API_TARGET, and defaults to 3001', async () => {
    vi.stubEnv('PORT', '4000');
    vi.stubEnv('VITE_API_TARGET', 'http://localhost:3101');
    expect((await loadConfig()).server.proxy['/api']?.target).toBe('http://localhost:3101');
    vi.stubEnv('VITE_API_TARGET', '');
    vi.stubEnv('PORT', '');
    expect((await loadConfig()).server.proxy['/api']?.target).toBe('http://localhost:3001');
  });
});
