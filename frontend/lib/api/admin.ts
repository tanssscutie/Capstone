// lib/api/admin.ts
// Maps to the admin-only endpoints in backend app/api/routes/business.py
// (prefix /business/admin — see require_admin in app/core/security.py).
import { api, API_BASE_URL, tokenStore } from './client';
import type { DocumentUploadOut } from './business';

export interface AdminFlaggedBusinessOut {
  user_id: number;
  business_name: string;
  mobile_number: string;
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

export interface AdminBusinessOut {
  user_id: number;
  business_name: string;
  mobile_number: string;
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
  verified_businesses: number;
  pending_review_count: number;
  total_requirements: number;
  open_requirements: number;
  total_quotations: number;
  registrations_last_7_days: RegistrationsByDay[];
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