// lib/types/index.ts
// Single source of truth for TrustLink. Change only via PR seen by all four.
// Derived from the sealed quotation loop flow specification.

export type ISODateTime = string; // "2026-09-01T14:00:00+08:00"
export type BusinessId = string;
export type RequirementRef = string; // "RQ-0042"
export type QuotationRef = string;   // "QT-0117"

/* ─── Business ──────────────────────────────────────── */

export type BusinessStatus =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED'; // proposed, pending decision 02

export type TrustTier = 1 | 2 | 3;

export type BusinessType =
  | 'SOLE_PROP'
  | 'PARTNERSHIP'
  | 'CORPORATION'
  | 'COOPERATIVE';

/** Seven observed facts. No ratings, no reviews, no response-time averages. */
export interface CredibilityBlock {
  status: BusinessStatus;
  verifiedAt: ISODateTime | null;
  recheckDueAt: ISODateTime | null;
  tier: TrustTier | null;
  requirementsPosted: number;
  requirementsAwarded: number;
  quotationsSubmitted: number;
  quotationsAwarded: number;
}

export interface Business {
  id: BusinessId;
  registeredName: string;
  displayName: string | null;
  businessType: BusinessType;
  category: string;
  city: string;
  province: string;
  contactPerson: string;
  contactMobile: string;
  capabilities: string[];   // 3–8, drives feed matching
  serviceAreas: string[];
  credibility: CredibilityBlock;
  profileCompletionPct: number; // 0–100
  memberSinceYear: number;
}

/* ─── Requirement ───────────────────────────────────── */

export type RequirementStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'CLOSED'          // clock trigger, never a person
  | 'AWARDED'
  | 'CLOSED_NO_AWARD'
  | 'CANCELLED';      // proposed, pending decision 04

export interface SpecRow {
  label: string;
  value: string;
}

export interface DeliverySite {
  name: string;        // "Bayan Logistics Hub 3"
  address: string;     // "Barangay Canlubang, Calamba, Laguna"
  accessHours: string; // "Mon–Sat, 7:00 AM – 6:00 PM"
  accessNote: string;  // "Warehouse remains in partial operation"
}

export interface Attachment {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  uri: string;
}

export interface Requirement {
  id: string;
  ref: RequirementRef;
  buyerId: BusinessId;
  status: RequirementStatus;
  category: string;
  title: string;
  scope: string;
  specifications: SpecRow[];
  quantity: string; 
  budgetMin: number | null;   // PHP, indicative
  budgetMax: number | null;
  deliverySite: DeliverySite;
  deliveryWindow: string;
  attachments: Attachment[];
  closingAt: ISODateTime;     // the only field that fires a platform event
  publishedAt: ISODateTime | null;
  quotationCount: number;     // count only while sealed — never contents
  lastQuotationAt: ISODateTime | null; // timing only, never contents — recency signal for feed cards
  awardedQuotationId: string | null;
  isSaved: boolean;           // personal bookmark, viewer-scoped
}

/* ─── Quotation ─────────────────────────────────────── */

export type QuotationStatus =
  | 'SUBMITTED'      // only state where withdrawal is possible
  | 'RELEASED'       // clock trigger, all move together
  | 'SHORTLISTED'
  | 'AWARDED'
  | 'NOT_SELECTED'
  | 'WITHDRAWN';

export type IntegrityResult = 'VALID' | 'FLAGGED';

export interface Quotation {
  id: string;
  ref: QuotationRef;
  requirementId: string;
  respondentId: BusinessId;
  status: QuotationStatus;
  totalPrice: number;         // PHP
  leadTimeDays: number;
  paymentTerms: string;
  validityDays: number;
  notesToBuyer: string;
  attachments: Attachment[];
  submittedAt: ISODateTime;
  hashTruncated: string;      // server-computed, display only
  ledgerEntryId: string;
  integrity: IntegrityResult | null;  // null until RELEASED
  withdrawnAt: ISODateTime | null;
  replacedByQuotationId: string | null;
}

/* ─── Ledger ────────────────────────────────────────── */

export type LedgerEntryType =
  | 'REQUIREMENT_PUBLISHED'
  | 'QUOTATION_SUBMITTED'
  | 'QUOTATION_WITHDRAWN'
  | 'REQUIREMENT_CLOSED'
  | 'REQUIREMENT_CANCELLED'
  | 'AWARD_RECORDED';

export interface LedgerEntry {
  id: string;
  sequence: number;
  type: LedgerEntryType;
  subjectId: string;
  hash: string;
  previousHash: string | null;
  createdAt: ISODateTime;
}

/* ─── Alerts ────────────────────────────────────────── */

/** No QUOTATION_RECEIVED here, deliberately — the buyer is never notified of an
 *  individual submission, not even that one arrived. See requirement_service.py's
 *  submit_quotation for why. */
export type AlertType =
  | 'REQUIREMENT_CLOSING'
  | 'DECISION'
  | 'VERIFICATION'
  | 'MESSAGE_RECEIVED'
  | 'QUESTION_ASKED'
  | 'QUESTION_ANSWERED';

export interface Alert {
  id: string;
  type: AlertType;
  title: string;
  detail: string;
  createdAt: ISODateTime;
  urgent: boolean;
  read: boolean;
}

/* ─── Pre-closing clarification Q&A ─────────────────────
 * Public on an OPEN requirement — every respondent sees every question and its
 * answer, unlike a sealed quotation. Unanswered questions have answer: null. */
export interface ClarificationQuestion {
  id: string;
  requirementId: string;
  askerId: BusinessId;
  askerName: string;
  question: string;
  answer: string | null;
  answeredAt: ISODateTime | null;
  createdAt: ISODateTime;
}

/* ─── Messaging ─────────────────────────────────────── */

/** A thread exists only once a requirement is awarded, and only between the buyer and the
 *  respondent that requirement was awarded to — requirementId and awardedQuotationId are
 *  what a thread is for, not incidental metadata. Nothing before that award can create one;
 *  the sealed quotation process is not negotiable outside it. */
export interface MessageThread {
  id: string;
  requirementId: string;
  requirementRef: RequirementRef;
  awardedQuotationId: string;
  counterpartyId: BusinessId;
  counterpartyName: string;
  lastMessagePreview: string;
  lastMessageAt: ISODateTime;
  unread: boolean;
}

/** Plain text only — no attachments. Documents belong to the quotation, not the thread. */
export interface Message {
  id: string;
  threadId: string;
  senderId: BusinessId;
  body: string;
  sentAt: ISODateTime;
  read: boolean;
}

/* ─── Screen state unions ───────────────────────────── */

export type RequirementDetailState =
  | 'RESPONDENT'
  | 'OWNER_SEALED'
  | 'OWNER_RELEASED';

export type QuotationSubmissionState = 'FORM' | 'SEALED_RECEIPT';

export type OnboardingStep = 'IDENTITY' | 'OPERATIONS' | 'DOCUMENTS' | 'ARRIVAL';

export type PostRequirementState = 'DETAILS' | 'DELIVERY' | 'CLOSING' | 'REVIEW';

/** Segmented control on the identity step. Decays; never a profile label. */
export type SignupIntent = 'FIND_SUPPLIERS' | 'FIND_WORK' | 'BOTH';