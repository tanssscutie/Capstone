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
};

export { API_BASE_URL };
