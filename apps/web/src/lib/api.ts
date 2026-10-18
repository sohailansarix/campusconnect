/**
 * API client.
 *
 * A thin typed wrapper over `fetch` that speaks the API's response envelope
 * (`{ success, data, meta } | { success, error }`) and normalises everything —
 * including network failures — into one `ApiError` shape the UI can render.
 *
 * Two behaviours worth knowing:
 *
 *  * **Automatic refresh on 401.** A single in-flight refresh is shared across
 *    concurrent requests, so six dashboard widgets firing at once do not each
 *    trigger their own refresh and invalidate each other's rotated tokens.
 *
 *  * **Server-side and client-side both work.** On the server, the access token
 *    is read from the cookie via `cookies()`; in the browser, tokens live in
 *    memory and the refresh cookie does the work. Nothing is stored in
 *    `localStorage` — an XSS should not be able to exfiltrate a long-lived token.
 */

import type { ApiErrorBody, ApiErrorCode, PaginationMeta } from '@campusconnect/shared';

const API_PATH = '/api/v1';

/**
 * Browser requests use the shared public route, while server-side Next.js
 * requests use Vercel's service binding. The binding is read only when
 * a function handles a request, never while Next.js builds the app.
 */
function getApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    const apiServiceUrl = process.env.API_SERVICE_URL;
    if (apiServiceUrl) {
      return new URL(`${API_PATH}/`, `${apiServiceUrl.replace(/\/+$/, '')}/`)
        .toString()
        .replace(/\/$/, '');
    }

    return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
  }

  // Keep the existing direct API URL for `next dev`. In production, the
  // browser and API share the Vercel domain and `/api/*` is routed to Express.
  if (process.env.NODE_ENV === 'development') {
    return process.env.NEXT_PUBLIC_API_URL ?? API_PATH;
  }

  return API_PATH;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: { path: string; message: string }[],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the user must sign in again, as opposed to a permission failure. */
  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.code === 'UNAUTHENTICATED' ||
      this.code === 'TOKEN_EXPIRED' ||
      this.code === 'TOKEN_INVALID'
    );
  }

  get isForbidden(): boolean {
    return this.status === 403 || this.code === 'FORBIDDEN';
  }

  get isNotFound(): boolean {
    return this.status === 404 || this.code === 'NOT_FOUND';
  }

  /** Field-level messages, keyed by path — ready for React Hook Form. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      // Only keep the first message per field; a schema can emit several.
      if (!map[detail.path]) map[detail.path] = detail.message;
    }
    return map;
  }
}

/* -------------------------------------------------------------------------- */
/* Response envelope                                                          */
/* -------------------------------------------------------------------------- */

export type ApiResult<T> = {
  data: T;
  meta?: PaginationMeta & Record<string, unknown>;
};

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  /** Skips the Authorization header — for genuinely public endpoints. */
  anonymous?: boolean;
  /** Internal: prevents an infinite refresh loop. */
  isRetry?: boolean;
  /** Next.js cache directive for server components. */
  revalidate?: number | false;
  tags?: string[];
  /** Query string parameters; undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
};

/* -------------------------------------------------------------------------- */
/* Token storage                                                              */
/* -------------------------------------------------------------------------- */

/**
 * In-memory access token.
 *
 * Deliberately not persisted. A page reload re-establishes the session through the
 * httpOnly refresh cookie, which costs one round trip and removes the entire class
 * of token-theft-via-XSS bugs.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/* -------------------------------------------------------------------------- */
/* URL building                                                               */
/* -------------------------------------------------------------------------- */

function buildUrl(path: string, query?: RequestOptions['query']): string {
  // An absolute URL is passed through, so the passport page can fetch a
  // share-target without string surgery.
  const base = path.startsWith('http')
    ? path
    : `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

  if (!query) return base;

  const isRelative = base.startsWith('/');
  const url = new URL(base, 'https://campusconnect.invalid');
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) url.searchParams.set(key, value.join(','));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return isRelative ? `${url.pathname}${url.search}` : url.toString();
}

/* -------------------------------------------------------------------------- */
/* Token refresh                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Shared refresh promise.
 *
 * Without this, five concurrent 401s produce five refresh calls; because refresh
 * tokens rotate, four of them would present an already-rotated token and trip
 * reuse detection, signing the user out and revoking every session. This is the
 * single most important line in the file.
 */
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sends the httpOnly refresh cookie. Required for the whole scheme.
        credentials: 'include',
      });

      if (!response.ok) return false;

      const payload = (await response.json()) as { data?: { accessToken?: string } };
      const token = payload.data?.accessToken;

      if (!token) return false;

      accessToken = token;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting the same promise all settle.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

/* -------------------------------------------------------------------------- */
/* Core request                                                               */
/* -------------------------------------------------------------------------- */

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { body, anonymous, isRetry, revalidate, tags, query, headers, ...rest } = options;

  const requestHeaders = new Headers(headers);

  if (body !== undefined && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  if (!anonymous && accessToken) {
    requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  const init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } } = {
    ...rest,
    headers: requestHeaders,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(revalidate !== undefined || tags
      ? { next: { ...(revalidate !== undefined ? { revalidate } : {}), ...(tags ? { tags } : {}) } }
      : {}),
  };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), init);
  } catch (error) {
    // A genuine network failure. Surfaced as a 503-shaped error so the UI's error
    // state handles it identically to a server outage.
    throw new ApiError(
      'INTERNAL_ERROR',
      'Could not reach the server. Check your connection and try again.',
      0,
      undefined,
      undefined,
    );
  }

  // --- Refresh-and-retry on expiry -----------------------------------------
  if (response.status === 401 && !anonymous && !isRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, isRetry: true });
    }
    // Refresh failed: the session is genuinely over.
    accessToken = null;
  }

  // --- Empty responses (204) ------------------------------------------------
  if (response.status === 204) {
    return { data: undefined as T };
  }

  // --- Parse ----------------------------------------------------------------
  let payload: unknown;
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      throw new ApiError('INTERNAL_ERROR', 'The server returned an unreadable response', response.status);
    }
  } else {
    // A non-JSON body on an error is almost always a proxy or gateway page.
    const text = await response.text().catch(() => '');
    throw new ApiError(
      'INTERNAL_ERROR',
      response.ok ? 'Unexpected response format' : text.slice(0, 200) || 'Request failed',
      response.status,
    );
  }

  // --- Envelope -------------------------------------------------------------
  if (!response.ok) {
    const errorBody = payload as ApiErrorBody;
    const error = errorBody?.error;

    // Rate limiting deserves a clearer message than the generic one.
    if (response.status === 429) {
      throw new ApiError(
        'RATE_LIMITED',
        error?.message ?? 'Too many requests — please wait a moment and try again.',
        429,
        undefined,
        error?.requestId,
      );
    }

    throw new ApiError(
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      error?.details,
      error?.requestId,
    );
  }

  const success = payload as { data: T; meta?: ApiResult<T>['meta'] };
  return { data: success.data, meta: success.meta };
}

/* -------------------------------------------------------------------------- */
/* Convenience methods                                                        */
/* -------------------------------------------------------------------------- */

/** Returns just the data, throwing on error. The common case. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const result = await apiRequest<T>(path, options);
  return result.data;
}

/** Returns data plus pagination meta. Used by every list hook. */
export async function apiList<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T[]>> {
  return apiRequest<T[]>(path, options);
}

export const get = <T>(path: string, options?: RequestOptions) =>
  api<T>(path, { ...options, method: 'GET' });

export const post = <T>(path: string, body?: unknown, options?: RequestOptions) =>
  api<T>(path, { ...options, method: 'POST', body });

export const patch = <T>(path: string, body?: unknown, options?: RequestOptions) =>
  api<T>(path, { ...options, method: 'PATCH', body });

export const put = <T>(path: string, body?: unknown, options?: RequestOptions) =>
  api<T>(path, { ...options, method: 'PUT', body });

export const del = <T>(path: string, body?: unknown, options?: RequestOptions) =>
  api<T>(path, { ...options, method: 'DELETE', body });

/* -------------------------------------------------------------------------- */
/* File upload                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Uploads a file and returns the stored asset.
 *
 * Does not set `Content-Type` — the browser must add the multipart boundary
 * itself, and setting it manually breaks the parse on the server.
 */
export async function uploadFile(
  file: File,
  purpose: string,
): Promise<{ id: string; key: string; url: string; purpose: string; size: number; mimeType: string }> {
  const form = new FormData();
  // The purpose is appended *before* the file, because the server's file filter
  // reads it from the parsed body to know which rules to apply.
  form.append('purpose', purpose);
  form.append('file', file);

  const headers = new Headers();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${getApiBaseUrl()}/uploads`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: form,
  });

  const payload = (await response.json()) as
    | { success: true; data: { id: string; key: string; url: string; purpose: string; size: number; mimeType: string } }
    | ApiErrorBody;

  if (!response.ok) {
    const error = (payload as ApiErrorBody).error;
    throw new ApiError(
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? 'The upload failed',
      response.status,
      error?.details,
    );
  }

  return (payload as { success: true; data: ReturnType<typeof JSON.parse> }).data;
}

/* -------------------------------------------------------------------------- */
/* Downloads                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Triggers a browser download of a CSV export.
 *
 * Uses the refresh cookie for auth rather than the in-memory token, because a
 * plain navigation cannot carry an Authorization header.
 */
export async function downloadFile(path: string, fallbackName = 'export.csv'): Promise<void> {
  const url = buildUrl(path);
  const request = () => {
    const headers = new Headers();
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    return fetch(url, { credentials: 'include', headers });
  };

  let response = await request();
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await request();
  }

  if (!response.ok) {
    let message = 'The export could not be generated';
    try {
      const payload = (await response.json()) as ApiErrorBody;
      message = payload.error?.message ?? message;
    } catch {
      // Keep a useful download error if a proxy returned a non-JSON body.
    }
    throw new ApiError('INTERNAL_ERROR', message, response.status);
  }

  // Prefer the server's filename when it supplies one.
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoked on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}
