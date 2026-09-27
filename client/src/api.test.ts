import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, createSong, deleteComment, getMe, getSong, listComments, login, logout, postComment, setPasswordChangeHandler, setUnauthorizedHandler, errorMessage, uploadSongAudio, updateMe } from './api';

function mockFetch(status: number, body?: unknown, contentType = 'application/json') {
  const fn = vi.fn(async (..._args: unknown[]) =>
    new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': contentType },
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

const headersOf = (fn: ReturnType<typeof mockFetch>, i = 0) => (fn.mock.calls[i]?.[1] as RequestInit).headers as Record<string, string>;
const initOf = (fn: ReturnType<typeof mockFetch>, i = 0) => fn.mock.calls[i]?.[1] as RequestInit;

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  setPasswordChangeHandler(null);
});

describe('buildQuery', () => {
  it('skips empties, joins arrays, maps true → 1', () => {
    expect(buildQuery({ q: 'les mis', kind: undefined, range: ['Soprano', 'Alto'], hideMature: true, hasAudio: false, show: '', n: 0 })).toBe(
      '?q=les+mis&range=Soprano%2CAlto&hideMature=1&n=0',
    );
    expect(buildQuery({})).toBe('');
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({ range: [] })).toBe('');
  });
});

describe('request', () => {
  it('GET sends credentials but no CSRF header', async () => {
    const fn = mockFetch(200, { user: null });
    await expect(getMe()).resolves.toEqual({ user: null });
    expect(fn.mock.calls[0]?.[0]).toBe('/api/auth/me');
    expect(initOf(fn).credentials).toBe('same-origin');
    expect(initOf(fn).method).toBe('GET');
    expect(headersOf(fn)['X-Requested-With']).toBeUndefined();
  });
  it('non-GET sends CSRF header + JSON body', async () => {
    const fn = mockFetch(201, { id: 1 });
    await createSong({ kind: 'solo', title: 'X', showName: 'Y', parts: [{ character: 'Z' }] });
    const h = headersOf(fn);
    expect(h['X-Requested-With']).toBe('star-song-finder');
    expect(h['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(initOf(fn).body))).toMatchObject({ title: 'X', parts: [{ character: 'Z' }] });
  });
  it('POST without body still sends JSON content-type + {}', async () => {
    const fn = mockFetch(204);
    await expect(logout()).resolves.toBeUndefined();
    expect(headersOf(fn)['Content-Type']).toBe('application/json');
    expect(initOf(fn).body).toBe('{}');
  });
  it('DELETE returns undefined on 204', async () => {
    const fn = mockFetch(204);
    await expect(deleteComment(5)).resolves.toBeUndefined();
    expect(fn.mock.calls[0]?.[0]).toBe('/api/comments/5');
    expect(initOf(fn).method).toBe('DELETE');
    expect(headersOf(fn)['X-Requested-With']).toBe('star-song-finder');
  });
  it('throws ApiError with status, message and details', async () => {
    mockFetch(400, { error: 'Please fix the form', details: { title: 'Too long', existingId: 12 } });
    const err = await createSong({ kind: 'solo', title: 'X', parts: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(400);
    expect(e.message).toBe('Please fix the form');
    expect(e.field('title')).toBe('Too long');
    expect(e.details.existingId).toBe('12');
  });
  it('uses a friendly default message when the body is not JSON', async () => {
    mockFetch(500, '<html>oops</html>', 'text/html');
    const e = (await getSong(1).catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(500);
    expect(e.message).toMatch(/stage-fright/);
  });
  it('rejects non-JSON success bodies', async () => {
    mockFetch(200, '<!doctype html>', 'text/html');
    await expect(getSong(1)).rejects.toThrow(/not JSON/);
  });
  it('network failures become status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const e = (await getSong(1).catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(0);
    expect(e.isNetworkError).toBe(true);
    expect(errorMessage(e)).toMatch(/reach the server/);
  });
  it('builds comment paths for songs and shows', async () => {
    const fn = mockFetch(200, { comments: [] });
    await listComments({ type: 'show', id: 'les-miserables' });
    await listComments({ type: 'song', id: 3 });
    expect(fn.mock.calls.map((c) => c[0])).toEqual(['/api/shows/les-miserables/comments', '/api/songs/3/comments']);
  });
});

describe('401 handling', () => {
  it('calls the handler on a 401 write', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { error: 'Please log in first' });
    await expect(postComment({ type: 'song', id: 1 }, { body: 'hi' })).rejects.toMatchObject({ status: 401, message: 'Please log in first' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('does not call it for GETs or /api/auth/* (e.g. wrong password)', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { error: 'Email or password is incorrect' });
    await expect(login({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({ status: 401 });
    await expect(getSong(1)).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });
  it('unregisters', async () => {
    const handler = vi.fn();
    const off = setUnauthorizedHandler(handler);
    off();
    mockFetch(401, { error: 'nope' });
    await expect(deleteComment(1)).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('403 MUST_CHANGE_PASSWORD (still on a temporary password)', () => {
  it('carries the code and calls the password-change handler', async () => {
    const handler = vi.fn();
    setPasswordChangeHandler(handler);
    mockFetch(403, { error: 'Please choose a new password first', code: 'MUST_CHANGE_PASSWORD' });
    await expect(postComment({ type: 'song', id: 1 }, { body: 'hi' })).rejects.toMatchObject({
      status: 403,
      code: 'MUST_CHANGE_PASSWORD',
      message: 'Please choose a new password first',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[1]).toEqual({ method: 'POST', path: '/api/songs/1/comments' });
  });
  it('ignores other 403s (e.g. "You can only edit songs you added")', async () => {
    const handler = vi.fn();
    setPasswordChangeHandler(handler);
    mockFetch(403, { error: 'You can only edit songs you added' });
    await expect(updateMe({ displayName: 'Sam' })).rejects.toMatchObject({ status: 403, code: undefined });
    expect(handler).not.toHaveBeenCalled();
  });
  it('gives friendly defaults for 503/507 without a message', async () => {
    mockFetch(503, {});
    await expect(getSong(1)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/busy/i) });
    mockFetch(507, {});
    await expect(getSong(1)).rejects.toMatchObject({ status: 507, message: expect.stringMatching(/storage/i) });
  });
});

describe('uploads', () => {
  it('sends multipart FormData with the CSRF header', async () => {
    const fn = mockFetch(200, { id: 1 });
    const file = new File(['abc'], 'track.mp3', { type: 'audio/mpeg' });
    await uploadSongAudio(1, file);
    const init = initOf(fn);
    expect(fn.mock.calls[0]?.[0]).toBe('/api/songs/1/audio');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(headersOf(fn)['X-Requested-With']).toBe('star-song-finder');
    expect(headersOf(fn)['Content-Type']).toBeUndefined();
  });
});
