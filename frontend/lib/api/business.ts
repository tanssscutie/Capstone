// lib/api/business.ts
// Maps to backend app/api/routes/business.py (prefix /business).
import { api } from './client';
import type { AccountRole } from '../types';
import type { IdentityDraft, OperationsDraft } from '../../features/onboarding/Onboarding';

export interface DocumentUploadOut {
  id: number;
  doc_type: string;
  declared_owner_name: string;
  declared_business_name: string;
  declared_id_number: string;
  declared_expiry_date: string | null;
  validation_status: string;
  validation_notes: string;
  uploaded_at: string;
}

export interface VerificationStatusOut {
  verification_status: string;
  is_verified: boolean;
  tier: number;
  submitted_at: string | null;
  verification_date: string | null;
  recheck_date: string | null;
  onboarding_completed: boolean;
  documents: DocumentUploadOut[];
  has_submitted: boolean;
  missing_documents: string[];
  registered_name: string | null;
  display_name: string | null;
  business_type: string | null;
  industry_category: string | null;
  city: string | null;
  province: string | null;
  contact_person: string | null;
  contact_mobile: string | null;
  capabilities: string[];
  service_areas: string[];
  business_description: string | null;
  offered_items: { code: string; other_text: string | null }[];
}

export interface DashboardStatsOut {
  requirements_posted_count: number;
  quotations_submitted_count: number;
  requirements_awarded_count: number;
  member_since_year: number;
  profile_completion_pct: number;
  tier_hint: string;
}

export interface PublicBusinessProfileOut {
  id: number;
  role: AccountRole | null;
  registered_name: string | null;
  display_name: string | null;
  business_type: string | null;
  industry_category: string | null;
  city: string | null;
  province: string | null;
  business_description: string | null;
  capabilities: string[];
  service_areas: string[];
  is_verified: boolean;
  tier: number;
  verification_date: string | null;
  member_since_year: number;
  requirements_posted_count: number;
  requirements_awarded_count: number;
  member_since: string;
  verification_status: string;
  registration_document_types: string[];
  quotations_submitted_count: number;
  quotations_awarded_count: number;
  requirements_cancelled_count: number;
  quotations_withdrawn_count: number;
  transactions_completed_count: number;
  transactions_not_pushed_through_count: number;
  /** Orders nobody updated — neither completed nor failed. */
  transactions_unconfirmed_count?: number;
  /** Completed ÷ awarded (0–1); null until there's an award. */
  completion_rate?: number | null;
  has_avatar?: boolean;
  has_cover?: boolean;
  headline?: string | null;
  website_url?: string | null;
  facebook_url?: string | null;
  years_in_business?: string | null;
  includes_sealed_activity: boolean;
  contact_details_visible: boolean;
  contact_person: string | null;
  contact_mobile: string | null;
}

/** POST /business/onboarding — identity + operations, combined into the
 *  shape app/schemas/business.py::OnboardingSubmit expects. */
export async function submitOnboarding(identity: IdentityDraft, operations: OperationsDraft): Promise<void> {
  await api.post<void>('/business/onboarding', {
    registered_name: identity.registeredName,
    display_name: identity.displayName.trim() || null,
    business_type: identity.businessType,
    // Omitted when blank: the backend then keeps the one from registration.
    industry_category: operations.category || undefined,
    city: identity.city,
    province: identity.province,
    contact_person: identity.contactPerson,
    contact_mobile: identity.contactMobile,
    capabilities: operations.capabilities,
    service_areas: operations.serviceAreas,
    business_description: operations.businessDescription.trim() || null,
    offered_items: operations.offeredItems.map((i) => ({ code: i.code, other_text: i.otherText })),
  });
}

export interface UploadDocumentInput {
  docType: 'DTI' | 'SEC' | 'BIR' | 'MAYORS_PERMIT' | string;
  declaredOwnerName: string;
  declaredBusinessName: string;
  declaredIdNumber: string;
  declaredExpiryDate?: string; // YYYY-MM-DD
  file: File | Blob;
  fileName: string;
}

/** POST /business/documents — multipart/form-data. */
export async function uploadDocument(input: UploadDocumentInput): Promise<DocumentUploadOut> {
  const form = new FormData();
  form.append('doc_type', input.docType);
  form.append('declared_owner_name', input.declaredOwnerName);
  form.append('declared_business_name', input.declaredBusinessName);
  form.append('declared_id_number', input.declaredIdNumber);
  if (input.declaredExpiryDate) form.append('declared_expiry_date', input.declaredExpiryDate);
  form.append('file', input.file, input.fileName);
  return api.postForm<DocumentUploadOut>('/business/documents', form);
}

export interface DocumentExtractionOut {
  id_number: string | null;
}

/** POST /business/documents/extract — Assistive Document Extraction. A
 *  suggestion only: the caller pre-fills an editable field with the result,
 *  never submits it directly. `id_number: null` just means nothing was
 *  confidently found (no Gemini key configured, unreadable image, etc.) —
 *  never surfaced as an error, the field is just left for manual entry. */
export async function extractDocumentFields(docType: string, file: File | Blob, fileName: string): Promise<DocumentExtractionOut> {
  const form = new FormData();
  form.append('doc_type', docType);
  form.append('file', file, fileName);
  return api.postForm<DocumentExtractionOut>('/business/documents/extract', form);
}

/** POST /business/submit-for-verification */
export async function submitForVerification(): Promise<VerificationStatusOut> {
  return api.post<VerificationStatusOut>('/business/submit-for-verification');
}

/** GET /business/verification-status */
export async function getVerificationStatus(): Promise<VerificationStatusOut> {
  return api.get<VerificationStatusOut>('/business/verification-status');
}

/** GET /business/dashboard-stats */
export async function getDashboardStats(): Promise<DashboardStatsOut> {
  return api.get<DashboardStatsOut>('/business/dashboard-stats');
}

/** GET /business/{id}/profile — any other business's public-facing profile,
 *  e.g. "View buyer profile" from a requirement, or a respondent's card once
 *  quotations release. Contact info is shown only to verified viewers, the owner and admin. */
export async function getPublicProfile(businessId: number): Promise<PublicBusinessProfileOut> {
  return api.get<PublicBusinessProfileOut>(`/business/${businessId}/profile`);
}


/** Reasons a business can be reported for — same codes as
 *  backend/app/services/report_service.REASONS. */
export type ReportReason = 'FAKE_BUSINESS' | 'FRAUD' | 'NOT_HONORED' | 'MISLEADING' | 'SPAM' | 'MANIPULATION' | 'ABUSIVE' | 'OTHER';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'FAKE_BUSINESS', label: 'Fake or impersonated business' },
  { value: 'FRAUD', label: 'Scam or fraud' },
  { value: 'NOT_HONORED', label: "Didn't honor an award or agreement" },
  { value: 'MISLEADING', label: 'Misleading profile or documents' },
  { value: 'SPAM', label: 'Spam or fake requirements/quotations' },
  { value: 'MANIPULATION', label: 'Bid manipulation or collusion' },
  { value: 'ABUSIVE', label: 'Abusive or harassing behavior' },
  { value: 'OTHER', label: 'Something else' },
];

/** POST /business/{id}/report — reviewed by an admin; the business is never told who reported it. */
export async function reportBusiness(businessId: number, reason: ReportReason, details: string): Promise<void> {
  await api.post(`/business/${businessId}/report`, { reason, details: details.trim() });
}


export interface PortfolioItemOut {
  id: number;
  caption: string;
  item_code: string | null;
  item_name: string | null;
  created_at: string;
}

/** Most photos a seller's portfolio holds — same as portfolio_service.MAX_ITEMS. */
export const PORTFOLIO_MAX_ITEMS = 8;

/** GET /business/{id}/portfolio — newest first. */
export async function listPortfolio(businessId: number): Promise<PortfolioItemOut[]> {
  return api.get<PortfolioItemOut[]>(`/business/${businessId}/portfolio`);
}

export function portfolioImagePath(businessId: number, itemId: number): string {
  return `/business/${businessId}/portfolio/${itemId}/image`;
}

/** POST /business/portfolio — the signed-in seller's own portfolio. */
export async function addPortfolioItem(file: File | Blob, fileName: string, caption: string, itemCode?: string | null): Promise<PortfolioItemOut> {
  const form = new FormData();
  form.append('file', file, fileName);
  form.append('caption', caption.trim());
  if (itemCode) form.append('item_code', itemCode);
  return api.postForm<PortfolioItemOut>('/business/portfolio', form);
}

export type ProfileImageKind = 'avatar' | 'cover';

/** GET /business/{id}/avatar | cover — behind the login; load with fetchAuthedBlobUrl. */
export function profileImagePath(businessId: number | string, kind: ProfileImageKind): string {
  return `/business/${businessId}/${kind}`;
}

/** POST /business/profile/{avatar|cover} — resized, EXIF stripped, encrypted server-side. */
export async function uploadProfileImage(kind: ProfileImageKind, file: File | Blob, fileName: string): Promise<void> {
  const form = new FormData();
  form.append('file', file, fileName);
  await api.postForm<void>(`/business/profile/${kind}`, form);
}

export async function removeProfileImage(kind: ProfileImageKind): Promise<void> {
  await api.delete<void>(`/business/profile/${kind}`);
}

export interface ProfileDetailsIn {
  headline: string;
  about: string;
  website_url: string;
  facebook_url: string;
}

/** PUT /business/profile/details — links must be http(s). */
export async function updateProfileDetails(details: ProfileDetailsIn): Promise<void> {
  await api.put<void>('/business/profile/details', details);
}

/** A completed TrustLink order a supplier can show in Past work — never a price. */
export interface CompletedWorkOut {
  requirement_id: number;
  ref_code: string;
  title: string;
  category: string;
  item_name: string | null;
  quantity: string;
  city: string;
  buyer_name: string;
  completed_at: string | null;
  showcased: boolean;
}

/** GET /business/{id}/completed-work — the ones the supplier chose to show. */
export async function listCompletedWork(businessId: number): Promise<CompletedWorkOut[]> {
  return api.get<CompletedWorkOut[]>(`/business/${businessId}/completed-work`);
}

/** GET /business/portfolio/suggestions — your completed orders not shown yet. */
export async function listCompletedWorkSuggestions(): Promise<CompletedWorkOut[]> {
  return api.get<CompletedWorkOut[]>('/business/portfolio/suggestions');
}

/** POST /business/portfolio/showcase/{requirementId} */
export async function setShowcase(requirementId: number, show: boolean): Promise<void> {
  await api.post<void>(`/business/portfolio/showcase/${requirementId}`, { show });
}

/** DELETE /business/portfolio/{id} */
export async function removePortfolioItem(itemId: number): Promise<void> {
  await api.delete<void>(`/business/portfolio/${itemId}`);
}


export interface MyReportOut {
  id: number;
  reported_name: string;
  reason_label: string;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
  reviewed_at: string | null;
}

/** GET /business/reports/mine — reports you filed, newest first. */
export async function listMyReports(): Promise<MyReportOut[]> {
  return api.get<MyReportOut[]>('/business/reports/mine');
}

export interface BusinessSearchOut {
  id: number;
  name: string;
  role: string | null;
  category: string | null;
  city: string | null;
}

/** GET /business/search?q= — businesses to report, by name (verified accounts). */
export interface ReportSuggestionOut extends BusinessSearchOut {
  /** 'supplier' = quoted on your requirement; 'buyer' = you quoted on theirs. */
  relation: 'supplier' | 'buyer';
  context: string;
  dealt_at: string | null;
}

/** GET /business/reports/suggestions — businesses you've transacted with, newest first (max 8). */
export async function listReportSuggestions(): Promise<ReportSuggestionOut[]> {
  return api.get<ReportSuggestionOut[]>('/business/reports/suggestions');
}

export async function searchBusinesses(q: string): Promise<BusinessSearchOut[]> {
  return api.get<BusinessSearchOut[]>(`/business/search?q=${encodeURIComponent(q)}`);
}

/* ─── Locked business details: change requests ───────── */

/** Locked after onboarding — changed only through an admin-reviewed request. */
export const LOCKED_FIELDS = [
  { key: 'registered_name', label: 'Registered business name' },
  { key: 'display_name', label: 'Display name' },
  { key: 'business_type', label: 'Business type' },
  { key: 'industry_category', label: 'Business category' },
  { key: 'city', label: 'City' },
  { key: 'province', label: 'Province' },
  { key: 'contact_person', label: 'Contact person' },
  { key: 'contact_mobile', label: 'Contact mobile' },
] as const;
export type LockedField = (typeof LOCKED_FIELDS)[number]['key'];

export interface ChangeRequestOut {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  changes: Record<string, { from: string; to: string }>;
  reason: string;
  admin_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface AdminChangeRequestOut extends ChangeRequestOut {
  user_id: number;
  business_name: string;
  verification_status: string;
}

export function lockedFieldLabel(key: string): string {
  return LOCKED_FIELDS.find((f) => f.key === key)?.label ?? key;
}

export async function requestProfileChange(changes: Partial<Record<LockedField, string>>, reason: string): Promise<ChangeRequestOut> {
  return api.post<ChangeRequestOut>('/business/change-requests', { changes, reason });
}

export async function listMyChangeRequests(): Promise<ChangeRequestOut[]> {
  return api.get<ChangeRequestOut[]>('/business/change-requests/mine');
}

export async function listChangeRequestsForAdmin(): Promise<AdminChangeRequestOut[]> {
  return api.get<AdminChangeRequestOut[]>('/business/admin/change-requests');
}

export async function reviewChangeRequest(requestId: number, approve: boolean, notes: string): Promise<void> {
  await api.post<void>(`/business/admin/change-requests/${requestId}/review`, { approve, notes });
}
