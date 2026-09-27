/**
 * Typed fetch wrapper for the STAR Song Finder API (SPEC §5, §5a, §5b, §5c).
 *
 *  - Always `credentials: 'same-origin'` (session cookie `star_sid`).
 *  - Every non-GET request carries `X-Requested-With: star-song-finder` (CSRF guard).
 *  - JSON bodies are sent with `Content-Type: application/json`; FormData is sent as multipart.
 *  - Non-2xx responses throw `ApiError { status, message, details }`. Network failures throw
 *    ApiError with status 0.
 *  - A 401 on a *write* (non-GET, outside /api/auth/*), or on a read of a login-only endpoint
 *    (/api/me/*, /api/admin/*) — i.e. the session ended — calls the handler registered with
 *    `setUnauthorizedHandler` (AuthProvider uses it to redirect to /login?next=…) and still throws.
 *  - A 403 with `code: 'MUST_CHANGE_PASSWORD'` (the account is on an admin-issued temporary
 *    password) calls the handler registered with `setPasswordChangeHandler` (AuthProvider sends
 *    them to /me) and still throws.
 */
import type {
  AdminUser,
  AdminUserPatch,
  ApiErrorBody,
  Comment,
  CommentInput,
  CommentPatch,
  CommentTarget,
  Contributions,
  ItunesLookupResult,
  LoginInput,
  Meta,
  ProfileUpdateInput,
  Show,
  ShowDetail,
  ShowInput,
  SignupInput,
  Song,
  SongDetail,
  SongInput,
  SongQuery,
  Stats,
  User,
  WikipediaLookupResult,
} from './types';

export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'star-song-finder';

/** Error thrown for every failed API call. `status` 0 = network error / server unreachable. */
export class ApiError extends Error {
  readonly status: number;
  readonly details: Record<string, string>;
  /** Machine-readable reason the server sent alongside the status, e.g. 'MUST_CHANGE_PASSWORD'. */
  readonly code: string | undefined;

  constructor(status: number, message: string, details?: Record<string, string>, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details ?? {};
    this.code = code;
  }

  /** Message for a specific form field (from `details`), if the server sent one. */
  field(name: string): string | undefined {
    return this.details[name];
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** Narrowing helper: `if (isApiError(e) && e.status === 409) …` */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** A friendly message for any thrown value (for toasts). */
export function errorMessage(e: unknown, fallback = 'Something went wrong backstage. Please try again.'): string {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof DOMException && e.name === 'AbortError') return 'Request cancelled';
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

// ---------------------------------------------------------------------------
// 401 handling
// ---------------------------------------------------------------------------

export interface UnauthorizedContext {
  method: string;
  path: string;
}
type UnauthorizedHandler = (error: ApiError, context: UnauthorizedContext) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Register the callback run when a write request (non-GET, not /api/auth/*) or a read of a
 * login-only endpoint (/api/me/*, /api/admin/*) returns 401.
 * Returns an unregister function. AuthProvider installs one that clears the user and redirects
 * to /login?next=<current path>.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

/** Server code on a 403 while the account must replace an admin-issued temporary password. */
export const MUST_CHANGE_PASSWORD = 'MUST_CHANGE_PASSWORD';

type PasswordChangeHandler = (error: ApiError, context: UnauthorizedContext) => void;
let passwordChangeHandler: PasswordChangeHandler | null = null;

/**
 * Register the callback run when any request answers 403 `code: 'MUST_CHANGE_PASSWORD'` (the
 * user is still on a temporary password, e.g. set in another tab). Returns an unregister function.
 */
export function setPasswordChangeHandler(handler: PasswordChangeHandler | null): () => void {
  passwordChangeHandler = handler;
  return () => {
    if (passwordChangeHandler === handler) passwordChangeHandler = null;
  };
}

// ---------------------------------------------------------------------------
// Core request helpers
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;
export type Query = Record<string, QueryValue>;

/**
 * Build a query string. Skips null/undefined/''/false/empty arrays; `true` → '1';
 * arrays are joined with commas (OR semantics on the server).
 */
export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === false || value === '') continue;
    if (Array.isArray(value)) {
      const joined = value.map(String).filter(Boolean).join(',');
      if (joined) params.set(key, joined);
    } else if (value === true) {
      params.set(key, '1');
    } else {
      params.set(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export interface RequestOptions {
  query?: Query;
  /** Plain object → JSON; FormData → multipart. */
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/api/auth/');
}

/** GET endpoints that only answer for a logged-in user — a 401 there means the session is gone. */
function isLoginOnlyRead(path: string): boolean {
  return path.startsWith('/api/me/') || path.startsWith('/api/admin/');
}

function toDetails(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

function defaultMessageFor(status: number): string {
  switch (status) {
    case 400:
      return 'Please check the form and try again.';
    case 401:
      return 'Please log in first';
    case 403:
      return "You don't have permission to do that.";
    case 404:
      return "We couldn't find that — it may have been removed.";
    case 409:
      return 'That already exists.';
    case 413:
      return 'That file is too big.';
    case 429:
      return 'Whoa, slow down! Too many requests — try again in a minute.';
    case 503:
      return 'The server is busy right now — please try again in a few seconds.';
    case 507:
      return 'The server is out of storage space — please tell your teacher.';
    default:
      return status >= 500 ? 'The server had a stage-fright moment. Please try again.' : `Request failed (${status})`;
  }
}

/** Parse a Response into data or throw ApiError. Exported for tests and custom calls. */
export async function parseResponse<T>(res: Response, method: string, path: string): Promise<T> {
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (res.ok) {
    if (data === undefined && text) {
      throw new ApiError(res.status, 'The server sent something unexpected (not JSON). Is the API running?');
    }
    return data as T;
  }
  const body = (data && typeof data === 'object' ? data : {}) as Partial<ApiErrorBody>;
  const message = typeof body.error === 'string' && body.error ? body.error : defaultMessageFor(res.status);
  const code = typeof body.code === 'string' && body.code ? body.code : undefined;
  const error = new ApiError(res.status, message, toDetails(body.details), code);
  if (res.status === 403 && code === MUST_CHANGE_PASSWORD && passwordChangeHandler) {
    try {
      passwordChangeHandler(error, { method, path });
    } catch {
      /* never let the handler mask the original error */
    }
  }
  const sessionLost = method === 'GET' || method === 'HEAD' ? isLoginOnlyRead(path) : !isAuthPath(path);
  if (res.status === 401 && sessionLost && unauthorizedHandler) {
    try {
      unauthorizedHandler(error, { method, path });
    } catch {
      /* never let the handler mask the original error */
    }
  }
  throw error;
}

/** Low-level request. Prefer the typed endpoint functions below. */
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const upper = method.toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: BodyInit | undefined;
  if (upper !== 'GET' && upper !== 'HEAD') {
    headers[CSRF_HEADER] = CSRF_VALUE;
  }
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      body = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  } else if (upper === 'POST' || upper === 'PUT' || upper === 'PATCH') {
    // The server requires JSON content-type on JSON endpoints even when there is no payload.
    headers['Content-Type'] = 'application/json';
    body = '{}';
  }
  const url = path + buildQuery(options.query);
  let res: Response;
  try {
    res = await fetch(url, {
      method: upper,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, "Can't reach the server — check your connection and try again.");
  }
  return parseResponse<T>(res, upper, path);
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) =>
  request<T>('GET', path, { query, signal });
export const post = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>('POST', path, { body, signal });
export const put = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>('PUT', path, { body, signal });
export const patch = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>('PATCH', path, { body, signal });
export const del = <T = void>(path: string, signal?: AbortSignal) => request<T>('DELETE', path, { signal });

export interface UploadOptions {
  /** Called with 0..1 as the file uploads. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Multipart field name (default 'file'). */
  field?: string;
}

/**
 * Multipart upload (POST) with optional progress. Uses XMLHttpRequest when `onProgress` is
 * given (fetch can't report upload progress), otherwise fetch.
 */
export async function upload<T>(path: string, file: Blob, options: UploadOptions = {}): Promise<T> {
  const form = new FormData();
  const name = file instanceof File ? file.name : 'upload';
  form.append(options.field ?? 'file', file, name);
  if (!options.onProgress || typeof XMLHttpRequest === 'undefined') {
    return request<T>('POST', path, { body: form, signal: options.signal });
  }
  const onProgress = options.onProgress;
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = false; // same-origin cookies are sent automatically
    xhr.setRequestHeader(CSRF_HEADER, CSRF_VALUE);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "Can't reach the server — check your connection and try again."));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.onload = () => {
      onProgress(1);
      const res = new Response(xhr.status === 204 ? null : xhr.responseText, {
        status: xhr.status,
        headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') ?? 'application/json' },
      });
      parseResponse<T>(res, 'POST', path).then(resolve, reject);
    };
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

const enc = (v: string | number) => encodeURIComponent(String(v));

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

/** GET /api/health */
export const getHealth = (signal?: AbortSignal) => get<{ ok: true }>('/api/health', undefined, signal);

/** GET /api/meta */
export const getMeta = (signal?: AbortSignal) => get<Meta>('/api/meta', undefined, signal);

/** GET /api/stats */
export const getStats = (signal?: AbortSignal) => get<Stats>('/api/stats', undefined, signal);

/** URL of the spreadsheet export (use as an <a href download>). */
export const EXPORT_XLSX_URL = '/api/export.xlsx';

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

/** GET /api/songs — the Browse page filters client-side instead; use this for server-side queries. */
export function listSongs(query: SongQuery = {}, signal?: AbortSignal) {
  return get<{ songs: Song[]; total: number }>(
    '/api/songs',
    {
      q: query.q,
      kind: query.kind,
      show: query.show,
      genre: query.genre,
      subGenre: query.subGenre,
      range: query.range,
      maxSeconds: query.maxSeconds,
      minSeconds: query.minSeconds,
      hideMature: query.hideMature,
      hasAudio: query.hasAudio,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    },
    signal,
  );
}

/** GET /api/songs/:id → Song & { similar } */
export const getSong = (id: number | string, signal?: AbortSignal) =>
  get<SongDetail>(`/api/songs/${enc(id)}`, undefined, signal);

/** POST /api/songs → 201 Song. 409 → details.existingId */
export const createSong = (input: SongInput) => post<Song>('/api/songs', input);

/** PUT /api/songs/:id → Song (full replace of editable fields) */
export const updateSong = (id: number, input: SongInput) => put<Song>(`/api/songs/${enc(id)}`, input);

/** DELETE /api/songs/:id → 204 (409 for a non-admin owner while other people have commented) */
export const deleteSong = (id: number) => del(`/api/songs/${enc(id)}`);

/** POST /api/songs/:id/audio (multipart `file`; mp3/m4a/aac/wav/aiff/ogg ≤ 25 MB) → Song */
export const uploadSongAudio = (id: number, file: File | Blob, options?: UploadOptions) =>
  upload<Song>(`/api/songs/${enc(id)}/audio`, file, options);

/** DELETE /api/songs/:id/audio → Song */
export const deleteSongAudio = (id: number) => del<Song>(`/api/songs/${enc(id)}/audio`);

// ---------------------------------------------------------------------------
// Shows
// ---------------------------------------------------------------------------

/** GET /api/shows → { shows } sorted by name */
export const listShows = (signal?: AbortSignal) => get<{ shows: Show[] }>('/api/shows', undefined, signal);

/** GET /api/shows/:idOrSlug → Show with songs + characters */
export const getShow = (idOrSlug: number | string, signal?: AbortSignal) =>
  get<ShowDetail>(`/api/shows/${enc(idOrSlug)}`, undefined, signal);

/** POST /api/shows → 201 Show (409 on duplicate name) */
export const createShow = (input: ShowInput) => post<Show>('/api/shows', input);

/** PUT /api/shows/:id → Show */
export const updateShow = (id: number, input: ShowInput) => put<Show>(`/api/shows/${enc(id)}`, input);

/** DELETE /api/shows/:id → 204 (409 if the show still has songs, or — for a non-admin owner — other people's comments) */
export const deleteShow = (id: number) => del(`/api/shows/${enc(id)}`);

/** POST /api/shows/:id/image (multipart `file`; jpeg/png/webp/gif ≤ 5 MB) → Show */
export const uploadShowImage = (id: number, file: File | Blob, options?: UploadOptions) =>
  upload<Show>(`/api/shows/${enc(id)}/image`, file, options);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** GET /api/lookup/itunes?title=&show= → top 8 candidates */
export const lookupItunes = (title: string, show: string, signal?: AbortSignal) =>
  get<ItunesLookupResult>('/api/lookup/itunes', { title, show }, signal);

/** GET /api/lookup/wikipedia?name= */
export const lookupWikipedia = (name: string, signal?: AbortSignal) =>
  get<WikipediaLookupResult>('/api/lookup/wikipedia', { name }, signal);

// ---------------------------------------------------------------------------
// Auth (SPEC §5a)
// ---------------------------------------------------------------------------

/** POST /api/auth/signup → 201 { user } + cookie */
export const signup = (input: SignupInput) => post<{ user: User }>('/api/auth/signup', input);

/** POST /api/auth/login → { user } + cookie (401 wrong credentials, 403 disabled, 429 rate limited) */
export const login = (input: LoginInput) => post<{ user: User }>('/api/auth/login', input);

/** POST /api/auth/logout → 204 */
export const logout = () => post<void>('/api/auth/logout');

/** GET /api/auth/me → { user: User | null } */
export const getMe = (signal?: AbortSignal) => get<{ user: User | null }>('/api/auth/me', undefined, signal);

/** PUT /api/auth/me → { user } (password change needs currentPassword) */
export const updateMe = (input: ProfileUpdateInput) => put<{ user: User }>('/api/auth/me', input);

// ---------------------------------------------------------------------------
// Comments (SPEC §5b)
// ---------------------------------------------------------------------------

function commentsPath(target: CommentTarget): string {
  return target.type === 'song' ? `/api/songs/${enc(target.id)}/comments` : `/api/shows/${enc(target.id)}/comments`;
}

/** GET /api/songs/:id/comments or /api/shows/:idOrSlug/comments → oldest first */
export const listComments = (target: CommentTarget, signal?: AbortSignal) =>
  get<{ comments: Comment[] }>(commentsPath(target), undefined, signal);

/** POST …/comments → 201 Comment */
export const postComment = (target: CommentTarget, input: CommentInput) => post<Comment>(commentsPath(target), input);

export const listSongComments = (songId: number, signal?: AbortSignal) =>
  listComments({ type: 'song', id: songId }, signal);
export const listShowComments = (showIdOrSlug: number | string, signal?: AbortSignal) =>
  listComments({ type: 'show', id: showIdOrSlug }, signal);
export const postSongComment = (songId: number, input: CommentInput) => postComment({ type: 'song', id: songId }, input);
export const postShowComment = (showIdOrSlug: number | string, input: CommentInput) =>
  postComment({ type: 'show', id: showIdOrSlug }, input);

/** PATCH /api/comments/:id → Comment (author or admin) */
export const updateComment = (id: number, input: CommentPatch) => patch<Comment>(`/api/comments/${enc(id)}`, input);

/** DELETE /api/comments/:id → 204 (author or admin) */
export const deleteComment = (id: number) => del(`/api/comments/${enc(id)}`);

// ---------------------------------------------------------------------------
// My stuff & admin (SPEC §5c)
// ---------------------------------------------------------------------------

/** GET /api/me/contributions (login) */
export const getContributions = (signal?: AbortSignal) => get<Contributions>('/api/me/contributions', undefined, signal);

/** GET /api/admin/users (admin) */
export const adminListUsers = (signal?: AbortSignal) => get<{ users: AdminUser[] }>('/api/admin/users', undefined, signal);

/** PATCH /api/admin/users/:id { role?, disabled? } → updated user (409 last admin / self-disable / demoting a STAR_ADMIN_EMAILS admin) */
export const adminUpdateUser = (id: number, input: AdminUserPatch) =>
  patch<AdminUser>(`/api/admin/users/${enc(id)}`, input);

/**
 * POST /api/admin/users/:id/reset-password → { temporaryPassword, expiresAt } (show once; the
 * temporary password stops working at `expiresAt` if unused). 409 when resetting yourself.
 */
export const adminResetPassword = (id: number) =>
  post<{ temporaryPassword: string; expiresAt?: string }>(`/api/admin/users/${enc(id)}/reset-password`);

/** GET /api/admin/comments?limit=100 → newest first */
export const adminListComments = (limit = 100, signal?: AbortSignal) =>
  get<{ comments: Comment[] }>('/api/admin/comments', { limit }, signal);
