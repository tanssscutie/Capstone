// lib/api/business.ts
// Maps to backend app/api/routes/business.py (prefix /business).
import { api } from './client';
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
  signup_intent: string;
  business_description: string | null;
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
}

/** POST /business/onboarding — identity + operations, combined into the
 *  shape app/schemas/business.py::OnboardingSubmit expects. */
export async function submitOnboarding(identity: IdentityDraft, operations: OperationsDraft): Promise<void> {
  await api.post<void>('/business/onboarding', {
    registered_name: identity.registeredName,
    display_name: identity.displayName.trim() || null,
    business_type: identity.businessType,
    industry_category: identity.category,
    city: identity.city,
    province: identity.province,
    contact_person: identity.contactPerson,
    contact_mobile: identity.contactMobile,
    capabilities: operations.capabilities,
    service_areas: operations.serviceAreas,
    signup_intent: identity.signupIntent,
    business_description: operations.businessDescription.trim() || null,
  });
}

export interface DescriptionSuggestionOut {
  description: string | null;
}

/** POST /business/suggest-description — AI profile assistant's draft bio.
 *  A suggestion only: the caller decides whether to use it, same contract
 *  as extractDocumentFields and requirementsApi.suggestCategory. */
export async function suggestDescription(
  identity: IdentityDraft, capabilities: string[], serviceAreas: string[],
): Promise<DescriptionSuggestionOut> {
  return api.post<DescriptionSuggestionOut>('/business/suggest-description', {
    business_type: identity.businessType,
    industry_category: identity.category,
    capabilities,
    service_areas: serviceAreas,
    city: identity.city,
    province: identity.province,
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
 *  quotations release. Never carries contact info — see PublicBusinessProfileOut. */
export async function getPublicProfile(businessId: number): Promise<PublicBusinessProfileOut> {
  return api.get<PublicBusinessProfileOut>(`/business/${businessId}/profile`);
}
