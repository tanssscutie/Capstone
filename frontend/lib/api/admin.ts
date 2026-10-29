// lib/api/admin.ts
// Maps to the admin-only endpoints in backend app/api/routes/business.py
// (prefix /business/admin — see require_admin in app/core/security.py).
import { api, API_BASE_URL, tokenStore } from './client';
import type { DocumentUploadOut } from './business';
import type { AccountRole } from '../types';

export interface AdminFlaggedBusinessOut {
  user_id: number;
  role: AccountRole | null;
  business_name: string;
  mobile_number: string | null;
  registered_name: string | null;
  business_type: string | null;
  industry_category: string | null;
  city: string | null;
  province: string | null;
  contact_person: string | null;
  contact_mobile: string | null;
  submitted_at: string | null;
  documents: DocumentUploadOut[];
}

export interface RegistrationsByDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface AdminReviewRecordOut {
  admin_name: string;
  approved: boolean;
  result_status: string;
  reviewed_at: string;
}

export interface AdminBusinessOut {
  user_id: number;
  role: AccountRole | null;
  business_name: string;
  mobile_number: string | null;
  registered_name: string | null;
  business_type: string | null;
  industry_category: string | null;
  city: string | null;
  province: string | null;
  onboarding_completed: boolean;
  verification_status: string;
  is_verified: boolean;
  tier: number;
  submitted_at: string | null;
  created_at: string;
  documents: DocumentUploadOut[];
  suspended_until: string | null;
  banned_at: string | null;
  /** The latest verification decision and the administrator who made it. */
  last_review: AdminReviewRecordOut | null;
}

export interface AdminRequirementOut {
  id: number;
  ref_code: string;
  title: string;
  category: string;
  status: string;
  city: string;
  price_min: number | null;
  price_max: number | null;
  quotations_count: number;
  closes_at: string;
  released_at: string | null;
  awarded_quotation_id: number | null;
  created_at: string;
  owner_id: number;
  owner_business_name: string;
}

export interface AdminStatsOut {
  total_businesses: number;
  total_buyers: number;
  total_sellers: number;
  verified_businesses: number;
  pending_review_count: number;
  open_reports_count: number;
  total_requirements: number;
  open_requirements: number;
  total_quotations: number;
  registrations_last_7_days: RegistrationsByDay[];
  needs_action: AdminNeedsActionOut;
  marketplace: AdminMarketplaceOut;
  trust: AdminTrustOut;
}

export interface LabelCount {
  label: string;
  count: number;
}

/** Work waiting on an administrator — each links to its page. */
export interface AdminNeedsActionOut {
  verification_queue: number;
  oldest_waiting_days: number | null;
  documents_different: number;
  documents_not_checked: number;
  open_reports: number;
  withdrawal_flags: number;
  pending_change_requests: number;
  awards_awaiting_supplier: number;
  delivery_dates_awaiting_reply: number;
  overdue_orders: number;
  unconfirmed_orders: number;
}

export interface AdminMarketplaceOut {
  open: number;
  closing_today: number;
  released: number;
  award_pending: number;
  awarded: number;
  archived_insufficient: number;
  closed_no_award: number;
  cancelled: number;
  avg_quotations_per_requirement: number;
  posted: number;
  reached_release: number;
  reached_award: number;
  completed: number;
  completion_rate: number | null; // 0–1
  top_categories: LabelCount[];
  top_cities: LabelCount[];
}

export interface AdminTrustOut {
  reviews_total: number;
  approval_rate: number | null; // 0–1
  avg_review_hours: number | null;
  tiers: LabelCount[];
  withdrawals_90_days: number;
  suspended: number;
  banned: number;
}

/** GET /business/admin/whoami — 204 if the current token belongs to an
 *  admin, 403 otherwise. Used as a lightweight auth guard: never throws,
 *  just resolves to whether the caller is allowed in. */
export async function checkAdminAccess(): Promise<boolean> {
  try {
    await api.get<void>('/business/admin/whoami');
    return true;
  } catch {
    return false;
  }
}

/** GET /business/admin/system-status — admin Settings: rules in force and
 *  which services are on. Read-only; set in the server's .env. */
export interface AdminSystemStatus {
  min_quotations_to_release: number;
  auto_extend_days: number;
  withdrawal_window_days: number;
  ai_enabled: boolean;
  email_enabled: boolean;
  files_encrypted: boolean;
}

export async function getSystemStatus(): Promise<AdminSystemStatus> {
  return api.get<AdminSystemStatus>('/business/admin/system-status');
}

/** GET /business/admin/flagged — businesses currently waiting on review. */
export async function listFlagged(): Promise<AdminFlaggedBusinessOut[]> {
  return api.get<AdminFlaggedBusinessOut[]>('/business/admin/flagged');
}

/** GET /business/admin/stats */
export async function getAdminStats(): Promise<AdminStatsOut> {
  return api.get<AdminStatsOut>('/business/admin/stats');
}

/** GET /business/admin/businesses — every registered business, not just
 *  the ones currently waiting on review. */
export async function listAllBusinesses(): Promise<AdminBusinessOut[]> {
  return api.get<AdminBusinessOut[]>('/business/admin/businesses');
}

/** GET /requirements/admin/all — every requirement ever posted. */
export async function listAllRequirements(): Promise<AdminRequirementOut[]> {
  return api.get<AdminRequirementOut[]>('/requirements/admin/all');
}

/** POST /business/admin/{user_id}/review */
export async function reviewBusiness(userId: number, approve: boolean, notes?: string): Promise<void> {
  await api.post<void>(`/business/admin/${userId}/review`, {
    approve,
    notes: notes && notes.trim().length > 0 ? notes.trim() : null,
  });
}

/** GET /business/admin/documents/{document_id}/file — the uploaded file's raw
 *  bytes, not JSON, so this goes around `api.get` (which always parses
 *  JSON/text) and fetches directly with the auth header attached by hand.
 *  Returns a blob: URL good for the lifetime of this page — the caller opens
 *  it (e.g. window.open) rather than getting back something itself openable,
 *  since a plain <a href> to the real endpoint would carry no Authorization
 *  header and just 401. Web-only, same as this project's other raw-DOM escape
 *  hatches (see PostRequirement.tsx's DateField). */
export async function openAdminDocumentFile(documentId: number): Promise<void> {
  if (typeof window === 'undefined') return;
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE_URL}/business/admin/documents/${documentId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Could not load that document (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Revoked after a delay rather than immediately — the new tab needs the
  // blob to still be alive by the time it actually loads it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export interface AdminReportOut {
  id: number;
  reason: string;
  reason_label: string;
  details: string;
  status: 'open' | 'resolved' | 'dismissed';
  admin_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  reporter_id: number;
  reporter_name: string;
  reported_id: number;
  reported_name: string;
  reported_role: string | null;
  reported_verification_status: string | null;
  /** Open reports against the same business, this one included. */
  reported_open_reports: number;
  related_requirement_id: number | null;
  related_requirement_ref: string | null;
  reported_suspended_until: string | null;
  reported_banned: boolean;
  reported_history: { action: string; reason: string; until: string | null; created_at: string }[];
  /** Automatic withdrawal-policy reports: the action pre-selected for the admin. */
  recommended_action: ModerationAction | null;
  /** The withdrawals behind it (last 90 days), with the reasons suppliers gave. */
  withdrawals: AdminWithdrawalOut[];
}

export interface AdminWithdrawalOut {
  id: number;
  requirement_ref: string | null;
  requirement_title: string | null;
  created_at: string;
  reason_label: string;
  reason_details: string | null;
  has_proof: boolean;
}

/** GET /requirements/admin/withdrawals/{id}/proof — opened in a new tab, like a document. */
export async function openWithdrawalProof(strikeId: number): Promise<void> {
  if (typeof window === 'undefined') return;
  const token = tokenStore.get();
  const res = await fetch(`${API_BASE_URL}/requirements/admin/withdrawals/${strikeId}/proof`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Could not load that file (${res.status})`);
  }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type ModerationAction = 'dismiss' | 'warn' | 'suspend_7' | 'suspend_30' | 'ban';

/** POST /business/admin/users/{id}/lift — end a suspension or ban. */
export async function liftRestriction(userId: number, notes?: string): Promise<void> {
  await api.post<void>(`/business/admin/users/${userId}/lift`, { notes: notes && notes.trim() ? notes.trim() : null });
}

/** GET /business/admin/reports — newest first. */
export async function listReports(): Promise<AdminReportOut[]> {
  return api.get<AdminReportOut[]>('/business/admin/reports');
}

/** POST /business/admin/reports/{id}/review */
/** Anything but "dismiss" also acts on the reported account and needs notes (the reason it's told). */
export async function reviewReport(reportId: number, action: ModerationAction, notes?: string): Promise<void> {
  await api.post<void>(`/business/admin/reports/${reportId}/review`, {
    action,
    notes: notes && notes.trim() ? notes.trim() : null,
  });
}
