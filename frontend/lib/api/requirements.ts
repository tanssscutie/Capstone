// lib/api/requirements.ts
// Maps to backend app/api/routes/requirements.py (prefix /requirements).
import { api, openAuthedFile } from './client';

export interface SpecRowOut {
  label: string;
  value: string;
  attribute_id?: string | null;
  normalized_value?: string | null;
  normalized_unit?: string | null;
}

export interface PosterOut {
  id: number;
  business_name: string;
  registered_name: string | null;
  display_name: string | null;
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
  /** Null on requirements posted before items existed. */
  item_code: string | null;
  item_name: string | null;
  scope: string;
  specifications: SpecRowOut[];
  quantity: string;
  price_min: number | null;
  price_max: number | null;
  strict_budget?: boolean;
  city: string;
  site_address: string | null;
  barangay?: string | null;
  zip_code?: string | null;
  auto_extended_at?: string | null;
  location: string;
  site_access_hours: string;
  site_access_notes: string;
  required_documents: string[];
  delivery_start: string | null;
  delivery_end: string | null;
  attachments: AttachmentOut[];
  match_note: string | null;
  status: string;
  quotations_count: number;
  latest_quotation_at: string | null;
  closes_at: string;
  released_at: string | null;
  my_active_quotation_ref: string | null;
  created_at: string;
  awarded_quotation_id: number | null;
  award_response_deadline: string | null;
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

export interface DocumentRequestOut {
  id: number;
  requirement_id: number;
  quotation_id: number;
  document_label: string;
  note: string | null;
  status: 'pending' | 'submitted' | 'cancelled';
  filename: string | null;
  response_note: string | null;
  created_at: string;
  submitted_at: string | null;
}

export interface CloseoutProposalOut {
  id: number;
  outcome: 'completed' | 'not_pushed_through';
  proposed_by_role: 'buyer' | 'supplier';
  note: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'withdrawn';
  response_note: string | null;
  created_at: string;
  responded_at: string | null;
}

export interface CloseoutOut {
  requirement_id: number;
  state: 'open' | 'pending' | 'completed' | 'not_pushed_through';
  viewer_role: 'buyer' | 'supplier' | 'admin';
  pending: CloseoutProposalOut | null;
  awaiting_viewer: boolean;
  final: CloseoutProposalOut | null;
  history: CloseoutProposalOut[];
}

export type OrderStatus =
  | 'awarded' | 'in_production' | 'out_for_delivery' | 'delivered'
  | 'completed' | 'not_pushed_through' | 'unconfirmed';

export interface OrderUpdateOut {
  status: OrderStatus;
  actor_role: 'buyer' | 'supplier' | 'system';
  note: string | null;
  created_at: string;
}

/** Order status of an awarded requirement (backend fulfillment_service). */
export interface FulfillmentOut {
  requirement_id: number;
  status: OrderStatus;
  viewer_role: 'buyer' | 'supplier' | 'admin';
  next_action: 'seller_update' | 'buyer_confirm' | null;
  next_action_by: 'buyer' | 'supplier' | null;
  next_status: OrderStatus | null;
  auto_confirm_at: string | null;
  auto_confirmed: boolean;
  timeline: OrderUpdateOut[];
  closeout: CloseoutOut | null;
}

export interface MyRequirementOut {
  id: number;
  ref_code: string;
  title: string;
  category: string;
  item_code: string | null;
  item_name: string | null;
  scope: string;
  specifications: SpecRowOut[];
  quantity: string;
  required_documents: string[];
  status: string;
  city: string;
  price_min: number | null;
  price_max: number | null;
  quotations_count: number;
  closes_at: string;
  released_at: string | null;
  awarded_quotation_id: number | null;
  award_response_deadline: string | null;
  created_at: string;
}

export interface AttachmentOut {
  id: number;
  filename: string;
  document_label: string | null;
  uploaded_at: string;
}

export interface LineItemOut {
  description: string;
  quantity: number;
  unit_price: number;
}

/** A respondent's answer to one specification row of the requirement. */
export interface SpecResponseOut {
  label: string;
  attribute_id: string | null;
  complies: boolean;
  /** What's quoted instead — set only when complies is false. */
  offered: string | null;
}

export interface MyQuotationOut {
  quotation_id: number;
  quotation_ref: string;
  status: string;
  outcome: string;
  award_response_deadline?: string | null;
  thread_id?: number | null;
  closeout_state?: 'open' | 'pending' | 'completed' | 'not_pushed_through' | null;
  closeout_awaiting_me?: boolean;
  total_price: number | null;
  line_items: LineItemOut[];
  delivery_lead_time: string | null;
  payment_terms: string | null;
  validity_period: string | null;
  notes: string;
  over_budget_reason?: string | null;
  spec_responses: SpecResponseOut[];
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
  line_items: LineItemOut[];
  delivery_lead_time: string | null;
  payment_terms: string | null;
  validity_period: string | null;
  notes: string;
  over_budget_reason?: string | null;
  /** Empty on quotations submitted before spec responses existed. */
  spec_responses: SpecResponseOut[];
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
  /** "Request a quote" from a seller's profile (max 5) — they get an invite alert;
   *  the requirement stays public and sealed. */
  invited_business_ids?: number[];
  category: string;
  /** One of the category's items — see lib/data/categories.ts. */
  item_code: string;
  title: string;
  scope: string;
  specifications?: SpecRowOut[];
  quantity: string;
  price_min?: number | null;
  price_max?: number | null;
  strict_budget?: boolean;
  city: string;
  /** Street / building / unit number — the server composes the full line. */
  site_address?: string | null;
  /** One of the city's PSGC barangays (GET /meta/ncr-addresses). */
  barangay?: string | null;
  zip_code?: string | null;
  delivery_start?: string | null; // ISO datetime
  delivery_end?: string | null;
  required_documents?: string[];
  closes_at: string; // ISO datetime
}

export interface QuotationCreateInput {
  total_price: number; // required, must be > 0 — backend rejects otherwise
  line_items?: LineItemOut[];
  delivery_lead_time?: string | null;
  payment_terms?: string | null;
  validity_period?: string | null;
  notes?: string | null;
  over_budget_reason?: string | null;
  /** One per specification row of the requirement — the backend 422s on a missing one. */
  spec_responses?: { label: string; complies: boolean; offered: string | null }[];
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
  actor_name: string | null;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
}

export interface RequirementLedgerView {
  requirement_id: number;
  entries: LedgerEntryOut[];
}

export interface CategorySuggestionOut {
  category: string | null;
}

/** POST /requirements/{id}/quotation-draft — never saved, never sealed. */
/** "Write with AI" on Post a requirement — Step 1 as typed so far. */
export interface DetailDraftInput {
  category: string;
  item: string;
  title: string;
  specifications: { label: string; value: string }[];
  quantity: string;
  price_min: number | null;
  price_max: number | null;
  strict_budget: boolean;
  current_text: string;
}

/** A suggested Detail text. Never saved — the buyer edits it. */
export interface DetailDraftOut {
  text: string;
  source: 'ai' | 'template';
  message: string;
}

export interface QuotationDraftOut {
  source: 'ai' | 'template';
  message: string;
  line_items: { description: string; quantity: number; unit_price: number }[];
  spec_responses: { label: string; complies: boolean; offered: string | null }[];
  lead_time_weeks: number;
  payment_terms: string;
  validity_days: number;
  notes: string;
  over_budget_reason?: string | null;
}

/** GET /requirements/withdrawal-preview — what one more withdrawal (not replaced
 *  before closing) would do, counted over the last window_days. */
export interface WithdrawalPreviewOut {
  withdrawals_so_far: number;
  next_number: number;
  next: 'recorded' | 'warning' | 'review';
  message: string;
  window_days: number;
}

export const requirementsApi = {
  listOpen: () => api.get<RequirementOut[]>('/requirements'),
  suggestCategory: (title: string, scope: string) =>
    api.post<CategorySuggestionOut>('/requirements/suggest-category', { title, scope }),
  getById: (requirementId: number) => api.get<RequirementOut>(`/requirements/${requirementId}`),
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

  detailDraft: (input: DetailDraftInput) => api.post<DetailDraftOut>('/requirements/detail-draft', input),
  withdrawalPreview: () => api.get<WithdrawalPreviewOut>('/requirements/withdrawal-preview'),
  quotationDraft: (requirementId: number) =>
    api.post<QuotationDraftOut>(`/requirements/${requirementId}/quotation-draft`, {}),
  submitQuotation: (requirementId: number, data: QuotationCreateInput) =>
    api.post<QuotationSealedReceipt>(`/requirements/${requirementId}/quotations`, data),

  uploadQuotationAttachment: (
    requirementId: number,
    quotationId: number,
    file: File | Blob,
    fileName: string,
    documentLabel?: string,
  ) => {
    const form = new FormData();
    form.append('file', file, fileName);
    if (documentLabel) form.append('document_label', documentLabel);
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

  /** Sends a Notice of Award — proposes a winner, doesn't confirm one. See
   *  acceptAward/declineAward, the proposed business's own response. */
  award: (requirementId: number, quotationId: number) =>
    api.post<RequirementOut>(`/requirements/${requirementId}/award`, { quotation_id: quotationId }),

  acceptAward: (requirementId: number) =>
    api.post<RequirementOut>(`/requirements/${requirementId}/award/accept`),

  declineAward: (requirementId: number) =>
    api.post<RequirementOut>(`/requirements/${requirementId}/award/decline`),

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

  // ---- order status (awarded requirements) ----

  getFulfillment: (requirementId: number) => api.get<FulfillmentOut>(`/requirements/${requirementId}/fulfillment`),

  updateFulfillment: (requirementId: number, status: OrderStatus, note?: string) =>
    api.post<FulfillmentOut>(`/requirements/${requirementId}/fulfillment`, {
      status,
      note: note && note.trim().length > 0 ? note.trim() : null,
    }),

  confirmReceived: (requirementId: number, note?: string) =>
    api.post<FulfillmentOut>(`/requirements/${requirementId}/fulfillment/confirm`, {
      note: note && note.trim().length > 0 ? note.trim() : null,
    }),

  // ---- transaction close-out (awarded requirements, both parties confirm) ----

  getCloseout: (requirementId: number) => api.get<CloseoutOut>(`/requirements/${requirementId}/closeout`),

  proposeCloseout: (requirementId: number, outcome: 'completed' | 'not_pushed_through', note?: string) =>
    api.post<CloseoutOut>(`/requirements/${requirementId}/closeout`, {
      outcome,
      note: note && note.trim().length > 0 ? note.trim() : null,
    }),

  respondCloseout: (requirementId: number, confirm: boolean, note?: string) =>
    api.post<CloseoutOut>(`/requirements/${requirementId}/closeout/respond`, {
      confirm,
      note: note && note.trim().length > 0 ? note.trim() : null,
    }),

  withdrawCloseout: (requirementId: number) =>
    api.post<CloseoutOut>(`/requirements/${requirementId}/closeout/withdraw`),

  // ---- post-release document requests (shortlisted quotations only) ----

  listDocumentRequests: (requirementId: number, quotationId: number) =>
    api.get<DocumentRequestOut[]>(`/requirements/${requirementId}/quotations/${quotationId}/document-requests`),

  requestDocument: (requirementId: number, quotationId: number, documentLabel: string, note?: string) =>
    api.post<DocumentRequestOut>(`/requirements/${requirementId}/quotations/${quotationId}/document-requests`, {
      document_label: documentLabel,
      note: note && note.trim().length > 0 ? note.trim() : null,
    }),

  cancelDocumentRequest: (requirementId: number, requestId: number) =>
    api.post<DocumentRequestOut>(`/requirements/${requirementId}/document-requests/${requestId}/cancel`),

  uploadRequestedDocument: (requirementId: number, requestId: number, file: File | Blob, fileName: string, responseNote?: string) => {
    const form = new FormData();
    form.append('file', file, fileName);
    if (responseNote && responseNote.trim()) form.append('response_note', responseNote.trim());
    return api.postForm<DocumentRequestOut>(`/requirements/${requirementId}/document-requests/${requestId}/upload`, form);
  },
};

/** A shortlisted respondent's uploaded document — see openAuthedFile. */
export function openRequestedDocumentFile(requirementId: number, requestId: number): Promise<void> {
  return openAuthedFile(`/requirements/${requirementId}/document-requests/${requestId}/file`);
}

/** One of the requirement's own attachments — open to any signed-in business. */
export function openRequirementAttachment(requirementId: number, attachmentId: number): Promise<void> {
  return openAuthedFile(`/requirements/${requirementId}/attachments/${attachmentId}/file`);
}

/** A quotation's attachment — the respondent's own any time, the buyer's once released. */
export function openQuotationAttachment(requirementId: number, quotationId: number, attachmentId: number): Promise<void> {
  return openAuthedFile(`/requirements/${requirementId}/quotations/${quotationId}/attachments/${attachmentId}/file`);
}