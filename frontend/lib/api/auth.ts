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
  email: string;
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
      email: input.email,
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
    // Right password, but the sign-up email was never confirmed — the caller
    // sends them to the OTP step for this address instead of showing an error.
    if (res.status === 403 && payload?.detail?.code === 'EMAIL_NOT_VERIFIED') {
      throw new EmailNotVerifiedError(payload.detail.email);
    }
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : 'Invalid mobile number or password');
  }

  tokenStore.set(payload.access_token);
  return payload.access_token as string;
}

export class EmailNotVerifiedError extends Error {
  email: string;
  constructor(email: string) {
    super('Please verify your email to continue.');
    this.email = email;
  }
}

/** POST /auth/verify-email — a correct 6-digit code completes sign-up and
 *  returns a login token, stored here exactly like login() does. */
export async function verifyEmail(email: string, code: string): Promise<void> {
  const res = await api.post<{ access_token: string }>('/auth/verify-email', { email, code }, { auth: false });
  tokenStore.set(res.access_token);
}

/** POST /auth/resend-otp — the backend enforces a cooldown and answers 429
 *  with a "wait N seconds" message when asked too soon. */
export async function resendOtp(email: string): Promise<void> {
  await api.post<{ detail: string }>('/auth/resend-otp', { email }, { auth: false });
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

/** POST /auth/password/request-otp — emails a 6-digit code to the account's
 *  address; changePassword() needs it. The backend enforces a resend cooldown
 *  and answers 429 with a "wait N seconds" message when asked too soon. */
export async function requestPasswordChangeOtp(): Promise<void> {
  await api.post<{ detail: string }>('/auth/password/request-otp', {});
}

/** PUT /auth/password */
export async function changePassword(currentPassword: string, newPassword: string, code: string): Promise<void> {
  await api.put<{ detail: string }>('/auth/password', {
    current_password: currentPassword,
    new_password: newPassword,
    code,
  });
}

/** POST /auth/password/forgot — always resolves the same way whether or not
 *  the email has an account (the backend never reveals which), so the
 *  frontend just moves on to the "enter code" step either way. The backend
 *  still enforces a resend cooldown and answers 429 when asked too soon. */
export async function requestPasswordReset(email: string): Promise<void> {
  await api.post<{ detail: string }>('/auth/password/forgot', { email }, { auth: false });
}

/** POST /auth/password/reset — the code from requestPasswordReset() plus a
 *  brand-new password, no current password needed. Does not log the user in;
 *  they log in fresh with the new password afterward. */
export async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
  await api.post<{ detail: string }>(
    '/auth/password/reset',
    { email, code, new_password: newPassword },
    { auth: false },
  );
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
