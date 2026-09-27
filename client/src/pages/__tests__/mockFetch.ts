/**
 * Tiny fetch router for page tests (SongForm / Shows / ShowDetail):
 *
 *   const api = mockFetch({
 *     'GET /api/shows': () => json(200, { shows }),
 *     'POST /api/songs': (req) => json(201, makeSong({ id: 5, title: req.body.title })),
 *   });
 *   expect(api.calls('POST /api/songs')[0].body).toMatchObject({ title: 'Popular' });
 *
 * Keys are "METHOD /path" (no query string); unmatched requests return 404 JSON.
 */
import { vi } from 'vitest';

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Record<string, string>;
}

export type Handler = (req: MockRequest) => Response | Promise<Response>;

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function mockFetch(routes: Record<string, Handler>) {
  const log: MockRequest[] = [];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init?.body) body = init.body;
    const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
    const req: MockRequest = { method, path: url.pathname, query: url.searchParams, body, headers };
    log.push(req);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return json(404, { error: `No mock for ${method} ${url.pathname}` });
    return handler(req);
  });
  vi.stubGlobal('fetch', fn);
  return {
    fn,
    log,
    calls: (key: string) => log.filter((r) => `${r.method} ${r.path}` === key),
  };
}
