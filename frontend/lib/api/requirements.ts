// lib/api/requirements.ts
// Maps to backend app/api/routes/requirements.py (prefix /requirements).
import { api } from './client';

export interface SpecRowOut {
  label: string;
  value: string;
}

export interface PosterOut {
  id: number;
  business_name: string;
  registered_name: string | null;
  city: string | null;
  province: string | null;
  is_verified: boolean;
  tier: number;
  member_since_year: number;
  requirements_posted_count: number;
  verified_since: string | null;
  requirements_awarded_count: number;
}

export interface RequirementOut {
  id: number;
  ref_code: string;
  title: string;
  tags: string[];
  poster: PosterOut;
  category: string;
  scope: string;
  specifications: SpecRowOut[];
  quantity: string;
  price_min: number | null;
  price_max: number | null;
  city: string;
  site_address: string | null;
  location: string;
  site_access_hours: string;
  site_access_notes: string;
  delivery_start: string | null;
  delivery_end: string | null;
  attachments: AttachmentOut[];
  match_note: string | null;
  status: string;
  quotations_count: number;
  latest_quotation_at: string | null;
  closes_at: string;
  my_active_quotation_ref: string | null;
  created_at: string;
  awarded_quotation_id: number | null;
  is_saved: boolean;
}

export interface ClarificationQuestionOut {
  id: number;
  requirement_id: number;
  asker_id: number;
  asker_name: string;
  question: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

export interface MyRequirementOut {
  id: number;
  ref_code: string;
  title: string;
  category: string;
  scope: string;
  specifications: SpecRowOut[];
  quantity: string;
  status: string;
  city: string;
  price_min: number | null;
  price_max: number | null;
  quotations_count: number;
  closes_at: string;
  released_at: string | null;
  awarded_quotation_id: number | null;
  created_at: string;
}

export interface AttachmentOut {
  id: number;
  filename: string;
  uploaded_at: string;
}

export interface MyQuotationOut {
  quotation_id: number;
  quotation_ref: string;
  status: string;
  outcome: string;
  total_price: number | null;
  delivery_lead_time: string | null;
  payment_terms: string | null;
  validity_period: string | null;
  notes: string;
  submitted_at: string;
  integrity_status: string | null;
  attachments: AttachmentOut[];
  requirement_id: number;
  requirement_ref_code: string;
  requirement_title: string;
  requirement_location: string;
  requirement_status: string;
  closes_at: string;
  released_at: string | null;
  poster: PosterOut;
}

export interface QuotationDetailOut {
  id: number;
  quotation_ref: string;
  business: PosterOut;
  total_price: number | null;
  delivery_lead_time: string | null;
  payment_terms: string | null;
  validity_period: string | null;
  notes: string;
  status: string; // released | withdrawn | voided | shortlisted | awarded | not_selected
  shortlisted: boolean;
  submitted_at: string;
  integrity_status: string | null;
  attachments: AttachmentOut[];
}

export interface RequirementQuotationsView {
  requirement_status: string;
  sealed_count: number | null;
  quotations: QuotationDetailOut[] | null;
  awarded_quotation_id: number | null;
}

export interface RequirementCreateInput {
  category: string;
  title: string;
  scope: string;
  specifications?: SpecRowOut[];
  quantity: string;
  price_min?: number | null;
  price_max?: number | null;
  city: string;
  site_address?: string | null;
  delivery_start?: string | null; // ISO datetime
  delivery_end?: string | null;
  closes_at: string; // ISO datetime
}

export interface QuotationCreateInput {
  total_price: number; // required, must be > 0 — backend rejects otherwise
  delivery_lead_time?: string | null;
  payment_terms?: string | null;
  validity_period?: string | null;
  notes?: string | null;
}

export interface QuotationSealedReceipt {
  quotation_id: number;
  quotation_ref: string;
  submitted_at: string;
  truncated_hash: string;
  ledger_entry_number: number;
  sealed_until: string;
}

export interface LedgerEntryOut {
  id: number;
  sequence: number;
  event_type: string;
  requirement_id: number;
  quotation_id: number | null;
  actor_id: number | null;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
}

export interface RequirementLedgerView {
  requirement_id: number;
  entries: LedgerEntryOut[];
}

export const requirementsApi = {
  listOpen: () => api.get<RequirementOut[]>('/requirements'),
  listClosingSoon: () => api.get<RequirementOut[]>('/requirements/closing-soon'),
  listMine: () => api.get<MyRequirementOut[]>('/requirements/mine'),
  listMyQuotations: () => api.get<MyQuotationOut[]>('/requirements/mine/quotations'),
  listSaved: () => api.get<RequirementOut[]>('/requirements/saved'),
  save: (requirementId: number) => api.post<void>(`/requirements/${requirementId}/save`),
  unsave: (requirementId: number) => api.post<void>(`/requirements/${requirementId}/unsave`),

  create: (data: RequirementCreateInput) => api.post<RequirementOut>('/requirements', data),

  uploadAttachment: (requirementId: number, file: File | Blob, fileName: string) => {
    const form = new FormData();
    form.append('file', file, fileName);
    return api.postForm<AttachmentOut>(`/requirements/${requirementId}/attachments`, form);
  },

  extend: (requirementId: number, newClosesAt: string) =>
    api.patch<RequirementOut>(`/requirements/${requirementId}/extend`, { new_closes_at: newClosesAt }),

  cancel: (requirementId: number) => api.post<RequirementOut>(`/requirements/${requirementId}/cancel`),

  updateSiteNotes: (requirementId: number, siteAccessHours: string, siteAccessNotes: string) =>
    api.patch<RequirementOut>(`/requirements/${requirementId}/site-notes`, {
      site_access_hours: siteAccessHours,
      site_access_notes: siteAccessNotes,
    }),

  submitQuotation: (requirementId: number, data: QuotationCreateInput) =>
    api.post<QuotationSealedReceipt>(`/requirements/${requirementId}/quotations`, data),

  uploadQuotationAttachment: (requirementId: number, quotationId: number, file: File | Blob, fileName: string) => {
    const form = new FormData();
    form.append('file', file, fileName);
    return api.postForm<AttachmentOut>(
      `/requirements/${requirementId}/quotations/${quotationId}/attachments`,
      form,
    );
  },

  withdrawQuotation: (requirementId: number) =>
    api.post<void>(`/requirements/${requirementId}/quotations/withdraw`),

  listQuotations: (requirementId: number) =>
    api.get<RequirementQuotationsView>(`/requirements/${requirementId}/quotations`),

  listLedger: (requirementId: number) =>
    api.get<RequirementLedgerView>(`/requirements/${requirementId}/ledger`),

  award: (requirementId: number, quotationId: number) =>
    api.post<RequirementOut>(`/requirements/${requirementId}/award`, { quotation_id: quotationId }),

  shortlistQuotation: (requirementId: number, quotationId: number) =>
    api.post<void>(`/requirements/${requirementId}/quotations/${quotationId}/shortlist`),

  unshortlistQuotation: (requirementId: number, quotationId: number) =>
    api.post<void>(`/requirements/${requirementId}/quotations/${quotationId}/unshortlist`),

  closeWithoutAward: (requirementId: number) =>
    api.post<RequirementOut>(`/requirements/${requirementId}/close-without-award`),

  listQuestions: (requirementId: number) =>
    api.get<ClarificationQuestionOut[]>(`/requirements/${requirementId}/questions`),

  askQuestion: (requirementId: number, question: string) =>
    api.post<ClarificationQuestionOut>(`/requirements/${requirementId}/questions`, { question }),

  answerQuestion: (requirementId: number, questionId: number, answer: string) =>
    api.post<ClarificationQuestionOut>(`/requirements/${requirementId}/questions/${questionId}/answer`, { answer }),
};