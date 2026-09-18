// lib/api/auth.ts
// Maps to backend app/api/routes/auth.py (prefix /auth).
import { api, tokenStore, API_BASE_URL } from './client';

export interface BackendUser {
  id: number;
  business_name: string;
  // Null until a Google sign-up completes its profile — see completeProfile().
  mobile_number: string | null;
  email: string | null;
  is_admin: boolean;
  notify_messages: boolean;
  notify_activity: boolean;
}

export interface RegisterInput {
  businessName: string;
  mobileNumber: string;
  password: string;
}

export interface LoginInput {
  mobileNumber: string;
  password: string;
}

/** POST /auth/register — creates the account only. Does NOT log in. */
export async function register(input: RegisterInput): Promise<BackendUser> {
  return api.post<BackendUser>(
    '/auth/register',
    {
      business_name: input.businessName,
      mobile_number: input.mobileNumber,
      password: input.password,
    },
    { auth: false },
  );
}

/** POST /auth/login — backend expects OAuth2PasswordRequestForm, i.e.
 *  application/x-www-form-urlencoded with `username` + `password` fields
 *  (mobile_number goes in as `username`). Stores the token on success. */
export async function login(input: LoginInput): Promise<string> {
  const body = new URLSearchParams();
  body.set('username', input.mobileNumber);
  body.set('password', input.password);

  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.detail ?? 'Invalid mobile number or password');
  }

  tokenStore.set(payload.access_token);
  return payload.access_token as string;
}

/** Convenience: register then immediately log in, since /auth/register
 *  doesn't return a token by itself. */
export async function registerAndLogin(input: RegisterInput): Promise<BackendUser> {
  await register(input);
  await login({ mobileNumber: input.mobileNumber, password: input.password });
  return me();
}

/** GET /auth/me */
export async function me(): Promise<BackendUser> {
  return api.get<BackendUser>('/auth/me');
}

export function isLoggedIn(): boolean {
  return !!tokenStore.get();
}

/** Full-page redirect target for "Sign in with Google" — not an API call,
 *  the browser navigates here directly (window.location.href). Google
 *  eventually bounces back to /auth-callback with our own token. */
export function googleLoginUrl(): string {
  return `${API_BASE_URL}/auth/google/login`;
}

/** POST /auth/complete-profile — the one-time mobile number a fresh Google
 *  sign-up still needs. Rejected by the backend if one is already set. */
export async function completeProfile(mobileNumber: string): Promise<BackendUser> {
  return api.post<BackendUser>('/auth/complete-profile', { mobile_number: mobileNumber });
}

export function logout() {
  tokenStore.clear();
}

/** PUT /auth/password */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.put<{ detail: string }>('/auth/password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

/** PUT /auth/mobile-number */
export async function changeMobileNumber(newMobileNumber: string, currentPassword: string): Promise<BackendUser> {
  return api.put<BackendUser>('/auth/mobile-number', {
    new_mobile_number: newMobileNumber,
    current_password: currentPassword,
  });
}

/** PUT /auth/notification-preferences */
export async function updateNotificationPreferences(notifyMessages: boolean, notifyActivity: boolean): Promise<BackendUser> {
  return api.put<BackendUser>('/auth/notification-preferences', {
    notify_messages: notifyMessages,
    notify_activity: notifyActivity,
  });
}
