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

/** Fixed at sign-up. A buyer posts requirements and awards them; a seller
 *  (supplier) browses open requirements and submits quotations. Admins are a
 *  separate login entirely and never carry one. */
export type AccountRole = 'buyer' | 'seller';

export interface Business {
  id: BusinessId;
  /** Null only for a Google sign-up that hasn't finished complete-profile. */
  role: AccountRole | null;
  registeredName: string;
  displayName: string | null;
  businessType: BusinessType;
  category: string;
  /** Optional public-facing bio, written by the business or drafted by the
   *  AI profile assistant — null means nothing set, same as before this
   *  field existed. */
  description: string | null;
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
  /** A Notice of Award went out but the proposed winner hasn't accepted or
   *  declined it yet — nothing is final. Every other released respondent
   *  still reads as an ordinary released quotation; only the proposed one
   *  shows a pending state. Reverts to CLOSED on decline or on the response
   *  window lapsing, so the buyer can propose someone else. */
  | 'AWARD_PENDING'
  | 'AWARDED'
  | 'CLOSED_NO_AWARD'
  /** Short of the minimum quotations even after the one extension —
   *  archived with every quotation voided unopened. */
  | 'INSUFFICIENT_QUOTATIONS'
  | 'CANCELLED';      // proposed, pending decision 04

export interface SpecRow {
  label: string;
  /** As the buyer typed it — always what's displayed. */
  value: string;
  /** Dictionary attribute id (GET /meta/categories); null on the buyer's own rows
   *  and on requirements posted before attribute ids existed. */
  attributeId?: string | null;
  /** value in its standard unit (cm / gsm / microns), set by the server. */
  normalizedValue?: string | null;
  normalizedUnit?: string | null;
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
  /** Which of the requirement's requiredDocuments this satisfies (a quotation
   *  attachment only) — null for a requirement's own attachments, and for a
   *  quotation's general/unlabeled ones. */
  documentLabel: string | null;
}

export interface Requirement {
  id: string;
  ref: RequirementRef;
  buyerId: BusinessId;
  status: RequirementStatus;
  category: string;
  /** The category item it's for (e.g. "tarpaulin"), "other", or null on
   *  requirements posted before items existed. */
  itemCode?: string | null;
  itemName?: string | null;
  title: string;
  scope: string;
  specifications: SpecRow[];
  quantity: string; 
  budgetMin: number | null;   // PHP, indicative
  budgetMax: number | null;
  /** The buyer set a strict maximum: quotations above budgetMax are refused. */
  strictBudget?: boolean;
  deliverySite: DeliverySite;
  deliveryWindow: string;
  attachments: Attachment[];
  /** Qualifying documents the buyer wants each respondent to attach to their
   *  quotation, e.g. ["PCAB License", "Sanitary Permit"] — surfaced on
   *  submission, never a hard backend gate on it. */
  requiredDocuments: string[];
  closingAt: ISODateTime;     // the only field that fires a platform event
  /** Set once the closing clock has actually fired and quotations released —
   *  null while still OPEN. Drives the "released N days ago, no decision
   *  yet" reminder banner while status === 'CLOSED'. */
  releasedAt: ISODateTime | null;
  publishedAt: ISODateTime | null;
  quotationCount: number;     // count only while sealed — never contents
  /** Set once closing was extended for too few quotations. */
  autoExtendedAt?: ISODateTime | null;
  lastQuotationAt: ISODateTime | null; // timing only, never contents — recency signal for feed cards
  awardedQuotationId: string | null;
  /** Set only while status === 'AWARD_PENDING' — when the proposed winner's
   *  response window closes. Null once accepted, declined, or expired. */
  awardResponseDeadline: ISODateTime | null;
  isSaved: boolean;           // personal bookmark, viewer-scoped
}

/* ─── Quotation ─────────────────────────────────────── */

export type QuotationStatus =
  | 'SUBMITTED'      // only state where withdrawal is possible
  | 'RELEASED'       // clock trigger, all move together
  | 'SHORTLISTED'
  /** This quotation is the proposed winner of a Notice of Award, awaiting
   *  its business's accept/decline — every other released quotation on the
   *  same requirement stays RELEASED until this resolves. */
  | 'AWARD_PENDING'
  | 'AWARDED'
  | 'NOT_SELECTED'
  | 'WITHDRAWN';

export type IntegrityResult = 'VALID' | 'FLAGGED';

export interface QuotationLineItem {
  description: string;
  quantity: number;
  unitPrice: number;   // PHP
}

/** A respondent's answer to one of the requirement's specification rows. */
export interface QuotationSpecResponse {
  label: string;
  attributeId: string | null;
  complies: boolean;
  /** What's quoted instead (for the preferred brand: the equivalent brand) —
   *  set only when complies is false. */
  offered: string | null;
}

export interface Quotation {
  id: string;
  ref: QuotationRef;
  requirementId: string;
  respondentId: BusinessId;
  status: QuotationStatus;
  totalPrice: number;         // PHP — always the authoritative grand total
  /** Itemized breakdown behind totalPrice — empty when the respondent chose
   *  "Total price only" instead of line items. Sealed with the rest of the
   *  quotation, same visibility rules as totalPrice itself. */
  lineItems: QuotationLineItem[];
  /** Sealed with the rest. Empty on quotations submitted before spec
   *  responses existed — shown as "not confirmed", not as a deviation. */
  specResponses: QuotationSpecResponse[];
  leadTimeDays: number;
  paymentTerms: string;
  validityDays: number;
  notesToBuyer: string;
  /** Why the price is above the buyer's indicative budget (sealed with it). */
  overBudgetReason?: string | null;
  attachments: Attachment[];
  submittedAt: ISODateTime;
  hashTruncated: string;      // server-computed, display only
  ledgerEntryId: string;
  integrity: IntegrityResult | null;  // null until RELEASED
  withdrawnAt: ISODateTime | null;
  replacedByQuotationId: string | null;
  /** My Quotations only — what happens next for the seller's own quotation. */
  progress?: {
    awardDeadline: ISODateTime | null;
    threadId: string | null;
    closeoutState: 'OPEN' | 'PENDING' | 'COMPLETED' | 'NOT_PUSHED_THROUGH' | null;
    closeoutAwaitingMe: boolean;
  };
}

/** A buyer asking a shortlisted respondent for one more supporting document
 *  after release (backend document_request_service). Separate from the
 *  quotation's own sealed attachments — never changes the quotation. */
export type DocumentRequestStatus = 'PENDING' | 'SUBMITTED' | 'CANCELLED';

export interface DocumentRequest {
  id: string;
  quotationId: string;
  documentLabel: string;
  note: string | null;
  status: DocumentRequestStatus;
  filename: string | null;
  responseNote: string | null;
  createdAt: ISODateTime;
  submittedAt: ISODateTime | null;
}

/** Both parties confirming how an awarded deal ended (backend closeout_service).
 *  Not post-award tracking — only the two parties' agreement on the outcome. */
export type CloseoutOutcome = 'COMPLETED' | 'NOT_PUSHED_THROUGH';
export type CloseoutState = 'OPEN' | 'PENDING' | CloseoutOutcome;

export interface CloseoutProposal {
  id: string;
  outcome: CloseoutOutcome;
  proposedByRole: 'buyer' | 'supplier';
  note: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'WITHDRAWN';
  responseNote: string | null;
  createdAt: ISODateTime;
  respondedAt: ISODateTime | null;
}

export interface TransactionCloseout {
  state: CloseoutState;
  viewerRole: 'buyer' | 'supplier' | 'admin';
  pending: CloseoutProposal | null;
  /** The viewer is the party who has to confirm or reject `pending`. */
  awaitingViewer: boolean;
  final: CloseoutProposal | null;
  history: CloseoutProposal[];
}

/* ─── Ledger ────────────────────────────────────────── */

export type LedgerEntryType =
  | 'REQUIREMENT_PUBLISHED'
  | 'QUOTATION_SUBMITTED'
  | 'QUOTATION_WITHDRAWN'
  | 'REQUIREMENT_CLOSED'
  | 'REQUIREMENT_CANCELLED'
  | 'AWARD_NOTICE_SENT'
  | 'AWARD_DECLINED'
  | 'AWARD_RECORDED'
  | 'CLOSED_NO_AWARD_RECORDED'
  | 'DOCUMENT_REQUESTED'
  | 'DOCUMENT_SUBMITTED'
  | 'AUTO_EXTENDED'
  | 'ARCHIVED_INSUFFICIENT'
  | 'CLOSEOUT_PROPOSED'
  | 'CLOSEOUT_CONFIRMED'
  | 'CLOSEOUT_REJECTED'
  | 'CLOSEOUT_WITHDRAWN'
  | 'FULFILLMENT_UPDATED'
  | 'ORDER_RECEIVED'
  | 'ORDER_AUTO_CONFIRMED'
  | 'ORDER_UNCONFIRMED'
  | 'DELIVERY_DATE_PROPOSED'
  | 'DELIVERY_DATE_CONFIRMED'
  | 'DELIVERY_DATE_DECLINED'
  | 'DELIVERY_DATE_WITHDRAWN';

export interface LedgerEntry {
  id: string;
  sequence: number;
  type: LedgerEntryType;
  subjectId: string;
  /** Who caused this entry — a business name, or null for a system-triggered
   *  one (RELEASED fires off the closing clock, not a person). */
  actorName: string | null;
  hash: string;
  previousHash: string | null;
  createdAt: ISODateTime;
}

/* ─── Alerts ────────────────────────────────────────── */

/** No QUOTATION_RECEIVED here, deliberately — the buyer is never notified of an
 *  individual submission, not even that one arrived. See requirement_service.py's
 *  submit_quotation for why. */
/** 11 system events (thesis Coverage of the Study — Alerts), each traceable to
 *  a recorded action. The buyer is never alerted about an individual
 *  quotation submission — only the sealed count, on demand. */
export type AlertType =
  | 'REQUIREMENT_CLOSING'
  | 'REQUIREMENT_RELEASED'
  | 'REQUIREMENT_CANCELLED'
  | 'DECISION'
  | 'CLOSED_NO_AWARD'
  | 'VERIFICATION'
  | 'TIER_UPGRADE'
  | 'DOCUMENT_FLAGGED'
  | 'MESSAGE_RECEIVED'
  | 'QUESTION_ASKED'
  | 'QUESTION_ANSWERED'
  /** A newly published requirement in the seller's category and items. */
  | 'REQUIREMENT_MATCH';

export interface Alert {
  id: string;
  type: AlertType;
  title: string;
  detail: string;
  createdAt: ISODateTime;
  urgent: boolean;
  read: boolean;
  /** The requirement this alert is about, when there is one. */
  relatedRequirementId: string | null;
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

/** Text and/or one attached file (post-award coordination: artwork, layouts, specs). */
export interface Message {
  id: string;
  threadId: string;
  senderId: BusinessId;
  body: string;
  /** Written by TrustLink when the award was accepted, not by either party. */
  isSystem: boolean;
  attachment: { filename: string; sizeBytes: number } | null;
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