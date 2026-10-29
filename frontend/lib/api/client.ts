import { ADMIN, isAdminPath } from '../adminRoutes';
// lib/api/client.ts
// Thin fetch wrapper shared by every lib/api/*.ts service module.
//
// Base URL: point EXPO_PUBLIC_API_URL at your FastAPI server. On Expo web
// this is baked in at build/start time (`EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start --web`).
// Falls back to http://localhost:8000, which is what `uvicorn app.main:app --reload` binds by default.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

const TOKEN_KEY = 'trustlink_access_token';

/** Token storage — web-only for now (uses window.localStorage). If/when this
 *  app targets native builds, swap this for @react-native-async-storage/async-storage
 *  or expo-secure-store; every call site goes through these three functions. */
export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

/** FastAPI's own validation failures (422) send `detail` as a list of
 *  {loc, msg, type} objects rather than a string — every call site's
 *  `typeof e?.detail === 'string' ? e.detail : e?.message ?? fallback`
 *  pattern was silently swallowing those into a useless "Request failed
 *  (422)", with no way to tell which field failed. This turns either shape
 *  (a plain string detail, or that Pydantic array) into one readable
 *  message, falling back to `err.message` / `fallback` for anything else. */
export function errorMessage(err: unknown, fallback: string): string {
  const detail = err instanceof ApiError ? err.detail : (err as any)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
          return field ? `${field}: ${d.msg}` : String(d.msg);
        }
        return typeof d === 'string' ? d : null;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join('; ');
  }
  return (err as any)?.message ?? fallback;
}

type RequestOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  auth?: boolean; // attach Bearer token — default true
  formData?: FormData; // when set, sent as multipart instead of JSON
};

/** 401 details that mean the session itself is no longer valid (backend core/security.py). */
const SESSION_ERRORS = new Set(['Invalid authentication credentials', 'Invalid token payload', 'User not found', 'Not authenticated']);

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, auth = true, formData } = opts;
  const headers: Record<string, string> = {};

  if (auth) {
    const token = tokenStore.get();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let requestBody: BodyInit | undefined;
  if (formData) {
    requestBody = formData; // browser sets multipart Content-Type + boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: requestBody,
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const detail = isJson && payload && typeof payload === 'object' && 'detail' in (payload as any)
      ? (payload as any).detail
      : payload;
    // The session is gone (expired or invalid token, account deleted): sign out
    // and go to the right login page instead of every screen failing. Only
    // these session errors — a wrong current password is a 401 too, and must
    // not sign anyone out.
    if (res.status === 401 && auth && headers['Authorization'] && typeof detail === 'string' && SESSION_ERRORS.has(detail)) {
      tokenStore.clear();
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (isAdminPath(path) && path !== ADMIN.login) {
          window.location.assign(ADMIN.login);
        } else if (!isAdminPath(path) && !path.startsWith('/login')) {
          window.location.assign(`/login?blocked=${encodeURIComponent('Your session expired. Log in again.')}`);
        }
      }
    }
    // Suspended, banned or deactivated mid-session (backend account_access):
    // sign out and land on login with the reason, instead of every screen failing.
    if (res.status === 403 && auth && typeof detail === 'string' && /suspended|banned|deactivated/i.test(detail)) {
      tokenStore.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.assign(`/login?blocked=${encodeURIComponent(detail)}`);
      }
    }
    throw new ApiError(res.status, detail);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  postForm: <T>(path: string, formData: FormData, opts?: Omit<RequestOpts, 'method' | 'formData'>) =>
    request<T>(path, { ...opts, method: 'POST', formData }),
  delete: <T>(path: string, opts?: Omit<RequestOpts, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};

export { API_BASE_URL };

/** An access-checked image as a blob: URL an <Image> can show — the
 *  endpoint needs the Authorization header, which an <Image source> can't
 *  send. The caller revokes it (URL.revokeObjectURL) when done. Web only. */
export async function fetchAuthedBlobUrl(path: string): Promise<string> {
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, `Could not load that image (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

/** Opens an access-checked file (raw bytes, not JSON) in a new tab. A plain
 *  <a href> to the endpoint would carry no Authorization header and 401, so
 *  this fetches with the token and opens the result as a blob: URL. The tab is
 *  opened *before* the fetch, while still inside the click, so popup blockers
 *  don't swallow it. Web only. Throws an ApiError on a refused request. */
export async function openAuthedFile(path: string): Promise<void> {
  if (typeof window === 'undefined') return;
  const tab = window.open('', '_blank');
  try {
    const token = tokenStore.get();
    const res = await fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new ApiError(res.status, payload?.detail ?? `Could not open that file (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    // Revoked after a delay — the new tab needs the blob alive while it loads.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Saves an access-checked file (a CSV export) under `filename` — the
 *  endpoint needs the Authorization header, so a plain link won't do. Web only.
 *  Throws an ApiError on a refused request. */
export async function downloadAuthedFile(path: string, filename: string): Promise<void> {
  if (typeof document === 'undefined') return;
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(res.status, payload?.detail ?? `Could not download that file (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
