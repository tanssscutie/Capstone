// lib/api/mappers.ts
//
// The backend's response shapes (see lib/api/requirements.ts, business.ts) don't line up
// 1:1 with lib/types/index.ts — that file was written against a fuller product spec than
// the backend currently implements. Rather than fabricate the missing fields, every mapper
// below fills gaps with an explicit, obviously-a-placeholder value (empty string / array,
// or a `// BACKEND GAP` comment) so it's easy to grep for what still needs a real field.
//
// Known gaps, so they're in one place instead of scattered as inline comments:
//  - PosterOut (requirements.ts) has no category/city/province/capabilities/serviceAreas,
//    so the FeedBuyer built from it only has id/registeredName/credibility.tier populated.
//  - Requirement.deliverySite is a rich object (name/address/accessHours/accessNote) but
//    the backend only stores city + site_address — accessHours/accessNote are always ''.
//  - Attachment.sizeBytes/mimeType/uri aren't returned by AttachmentOut — left as 0/''/''.
//  - Alert and MessageThread/Message now have real backends too — see mapNotification /
//    lib/api/notifications.ts and mapMessageThread+mapMessage / lib/api/messages.ts.

import type {
  Alert,
  AlertType,
  Business,
  CredibilityBlock,
  Requirement,
  RequirementStatus,
  BusinessType,
  BusinessId,
  MessageThread,
  Message,
  ClarificationQuestion,
} from '../types';
import type { RequirementOut, MyRequirementOut, PosterOut, MyQuotationOut, QuotationDetailOut, LedgerEntryOut, ClarificationQuestionOut } from './requirements';
import type { VerificationStatusOut, DashboardStatsOut, PublicBusinessProfileOut } from './business';
import type { NotificationOut } from './notifications';
import type { MessageThreadOut, MessageOut } from './messages';
import type { BackendUser } from './auth';
import type { Quotation, QuotationStatus, IntegrityResult, LedgerEntry, LedgerEntryType } from '../types';

const REQUIREMENT_STATUS_MAP: Record<string, RequirementStatus> = {
  open: 'OPEN',
  closed: 'CLOSED',
  awarded: 'AWARDED',
  closed_no_award: 'CLOSED_NO_AWARD',
  cancelled: 'CANCELLED',
  draft: 'DRAFT',
};

export function mapRequirementStatus(status: string): RequirementStatus {
  return REQUIREMENT_STATUS_MAP[status.toLowerCase()] ?? 'OPEN';
}

/** PosterOut -> partial CredibilityBlock. Only tier/verified/counts are known;
 *  verifiedAt/recheckDueAt aren't part of PosterOut so they're null. */
function posterCredibility(poster: PosterOut): CredibilityBlock {
  return {
    status: poster.is_verified ? 'VERIFIED' : 'UNVERIFIED',
    verifiedAt: null,
    recheckDueAt: null,
    tier: (poster.tier as 1 | 2 | 3) ?? null,
    requirementsPosted: poster.requirements_posted_count,
    requirementsAwarded: poster.requirements_awarded_count,
    quotationsSubmitted: 0, // BACKEND GAP — not exposed per-poster
    quotationsAwarded: 0, // BACKEND GAP
  };
}

/** Builds the `FeedBuyer` shape HomeFeed needs, keyed by poster id. Fields the
 *  backend doesn't send (category/capabilities) are left blank. */
export function mapPosterToFeedBuyer(poster: PosterOut) {
  return {
    id: String(poster.id) as BusinessId,
    registeredName: poster.registered_name ?? poster.business_name,
    displayName: null,
    category: '', // BACKEND GAP
    city: poster.city ?? '',
    province: poster.province ?? '',
    capabilities: [] as string[], // BACKEND GAP
    credibility: posterCredibility(poster),
  };
}

export function mapRequirement(r: RequirementOut): Requirement {
  return {
    id: String(r.id),
    ref: r.ref_code,
    buyerId: String(r.poster.id),
    status: mapRequirementStatus(r.status),
    category: r.category,
    title: r.title,
    scope: r.scope,
    specifications: r.specifications,
    quantity: r.quantity,
    budgetMin: r.price_min,
    budgetMax: r.price_max,
    deliverySite: {
      name: r.city,
      address: r.site_address ?? r.location,
      accessHours: r.site_access_hours,
      accessNote: r.site_access_notes,
    },
    deliveryWindow:
      r.delivery_start && r.delivery_end
        ? `${r.delivery_start} – ${r.delivery_end}`
        : r.delivery_start ?? r.delivery_end ?? '',
    attachments: r.attachments.map((a) => ({
      id: String(a.id),
      filename: a.filename,
      sizeBytes: 0, // BACKEND GAP
      mimeType: '', // BACKEND GAP
      uri: '', // BACKEND GAP — no download URL in AttachmentOut yet
    })),
    closingAt: r.closes_at,
    publishedAt: r.created_at,
    quotationCount: r.quotations_count,
    lastQuotationAt: r.latest_quotation_at,
    awardedQuotationId: r.awarded_quotation_id ? String(r.awarded_quotation_id) : null,
    isSaved: r.is_saved,
  };
}

/** MyRequirementOut is lighter than RequirementOut (no poster — it's always
 *  the viewer's own requirement). Fields Requirement expects but this
 *  endpoint doesn't return are filled with safe defaults. */
export function mapMyRequirement(r: MyRequirementOut, ownerId: BusinessId): Requirement {
  return {
    id: String(r.id),
    ref: r.ref_code,
    buyerId: ownerId,
    status: mapRequirementStatus(r.status),
    category: r.category,
    title: r.title,
    scope: r.scope,
    specifications: r.specifications,
    quantity: r.quantity,
    budgetMin: r.price_min,
    budgetMax: r.price_max,
    deliverySite: { name: r.city, address: '', accessHours: '', accessNote: '' },
    deliveryWindow: '',
    attachments: [],
    closingAt: r.closes_at,
    publishedAt: r.created_at,
    quotationCount: r.quotations_count,
    lastQuotationAt: null,
    awardedQuotationId: r.awarded_quotation_id ? String(r.awarded_quotation_id) : null,
    isSaved: false, // BACKEND GAP — /requirements/mine doesn't return this; not needed for the owner's own listing anyway
  };
}

/** Fuller Business built from PosterOut, for spots that need a `Business` rather
 *  than a `FeedBuyer` (e.g. MyQuotations' `buyers` map). Same gaps as
 *  mapPosterToFeedBuyer — PosterOut has no city/province/capabilities/etc. */
export function mapPosterToBusiness(poster: PosterOut): Business {
  return {
    id: String(poster.id),
    registeredName: poster.registered_name ?? poster.business_name,
    displayName: null,
    businessType: 'SOLE_PROP', // BACKEND GAP — not in PosterOut
    category: '', // BACKEND GAP
    city: poster.city ?? '',
    province: poster.province ?? '',
    contactPerson: '', // BACKEND GAP
    contactMobile: '', // BACKEND GAP
    capabilities: [],
    serviceAreas: [],
    credibility: posterCredibility(poster),
    profileCompletionPct: 0, // BACKEND GAP
    memberSinceYear: poster.member_since_year,
  };
}

/** Another business's public-facing profile — narrower than `Business` on
 *  purpose: no contact person/mobile, no login mobile number. See
 *  PublicBusinessProfileOut (lib/api/business.ts) for what the backend
 *  deliberately excludes. */
export interface PublicBusinessProfile {
  id: BusinessId;
  registeredName: string;
  businessType: string;
  category: string;
  city: string;
  province: string;
  capabilities: string[];
  serviceAreas: string[];
  credibility: Pick<CredibilityBlock, 'status' | 'verifiedAt' | 'tier' | 'requirementsPosted' | 'requirementsAwarded'>;
  memberSinceYear: number;
}

export function mapPublicBusinessProfile(p: PublicBusinessProfileOut): PublicBusinessProfile {
  return {
    id: String(p.id),
    registeredName: p.registered_name ?? '',
    businessType: p.business_type ?? '',
    category: p.industry_category ?? '',
    city: p.city ?? '',
    province: p.province ?? '',
    capabilities: p.capabilities,
    serviceAreas: p.service_areas,
    credibility: {
      status: p.is_verified ? 'VERIFIED' : 'UNVERIFIED',
      verifiedAt: p.verification_date,
      tier: (p.tier as 1 | 2 | 3) ?? null,
      requirementsPosted: p.requirements_posted_count,
      requirementsAwarded: p.requirements_awarded_count,
    },
    memberSinceYear: p.member_since_year,
  };
}

const QUOTATION_OUTCOME_MAP: Record<string, QuotationStatus> = {
  sealed: 'SUBMITTED',
  released: 'RELEASED',
  awarded: 'AWARDED',
  not_awarded: 'NOT_SELECTED',
  withdrawn: 'WITHDRAWN',
  voided: 'WITHDRAWN', // closest existing status — frontend has no separate VOIDED
};

function mapIntegrity(status: string | null): IntegrityResult | null {
  if (status === 'valid') return 'VALID';
  if (status === 'flagged') return 'FLAGGED';
  return null;
}

const LEDGER_EVENT_MAP: Record<string, LedgerEntryType> = {
  SUBMITTED: 'QUOTATION_SUBMITTED',
  WITHDRAWN: 'QUOTATION_WITHDRAWN',
  RELEASED: 'REQUIREMENT_CLOSED',
  CANCELLED: 'REQUIREMENT_CANCELLED',
  AWARDED: 'AWARD_RECORDED',
};

// The chain's starting point — see backend app/services/ledger_service.py GENESIS_HASH.
const LEDGER_GENESIS_HASH = '0'.repeat(64);

export function mapLedgerEntry(e: LedgerEntryOut): LedgerEntry {
  return {
    id: `led-${e.id}`,
    sequence: e.sequence,
    type: LEDGER_EVENT_MAP[e.event_type] ?? 'QUOTATION_SUBMITTED',
    subjectId: String(e.quotation_id ?? e.requirement_id),
    hash: e.entry_hash,
    previousHash: e.prev_hash === LEDGER_GENESIS_HASH ? null : e.prev_hash,
    createdAt: e.created_at,
  };
}

/** Pulls a leading integer out of strings like "5 days" / "30 days" — best-effort
 *  since the backend stores these as free text, not structured numbers. */
function parseLeadingInt(text: string | null | undefined): number {
  if (!text) return 0;
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

export function mapMyQuotation(q: MyQuotationOut): Quotation {
  return {
    id: String(q.quotation_id),
    ref: q.quotation_ref,
    requirementId: String(q.requirement_id),
    respondentId: '', // BACKEND GAP — it's always the viewer, but no id echoed back here
    status: QUOTATION_OUTCOME_MAP[q.outcome] ?? 'SUBMITTED',
    totalPrice: q.total_price ?? 0,
    leadTimeDays: parseLeadingInt(q.delivery_lead_time),
    paymentTerms: q.payment_terms ?? '',
    validityDays: parseLeadingInt(q.validity_period),
    notesToBuyer: q.notes,
    attachments: q.attachments.map((a) => ({
      id: String(a.id),
      filename: a.filename,
      sizeBytes: 0, // BACKEND GAP
      mimeType: '', // BACKEND GAP
      uri: '', // BACKEND GAP — no download URL in AttachmentOut yet
    })),
    submittedAt: q.submitted_at,
    hashTruncated: '', // BACKEND GAP — only returned once, on the initial sealed receipt
    ledgerEntryId: '', // BACKEND GAP
    integrity: mapIntegrity(q.integrity_status),
    withdrawnAt: q.outcome === 'withdrawn' ? q.submitted_at : null, // BACKEND GAP — no real withdrawn_at field
    replacedByQuotationId: null,
  };
}

/** A lightweight Requirement built from a MyQuotationOut's embedded requirement
 *  fields — enough for MyQuotations' `requirements` lookup map, not a full detail view. */
export function mapMyQuotationRequirement(q: MyQuotationOut): Requirement {
  return {
    id: String(q.requirement_id),
    ref: q.requirement_ref_code,
    buyerId: String(q.poster.id),
    status: mapRequirementStatus(q.requirement_status),
    category: '',
    title: q.requirement_title,
    scope: '',
    specifications: [],
    quantity: '',
    budgetMin: null,
    budgetMax: null,
    deliverySite: { name: q.requirement_location, address: '', accessHours: '', accessNote: '' },
    deliveryWindow: '',
    attachments: [],
    closingAt: q.closes_at,
    publishedAt: q.submitted_at,
    quotationCount: 0,
    lastQuotationAt: null,
    awardedQuotationId: null,
    isSaved: false, // BACKEND GAP — MyQuotationOut doesn't return this; not needed for this lookup map
  };
}

export function mapNotification(n: NotificationOut): Alert {
  return {
    id: String(n.id),
    type: n.type as AlertType,
    title: n.title,
    detail: n.detail,
    createdAt: n.created_at,
    urgent: n.urgent,
    read: n.read,
  };
}

export function mapMessageThread(t: MessageThreadOut): MessageThread {
  return {
    id: String(t.id),
    requirementId: String(t.requirement_id),
    requirementRef: t.requirement_ref_code,
    awardedQuotationId: String(t.awarded_quotation_id),
    counterpartyId: String(t.counterparty_id),
    counterpartyName: t.counterparty_name,
    lastMessagePreview: t.last_message_preview,
    // A freshly-awarded thread has no messages yet — fall back to "now" so
    // ThreadRow's relative-time formatting never has to parse an empty string.
    lastMessageAt: t.last_message_at ?? new Date().toISOString(),
    unread: t.unread,
  };
}

export function mapMessage(m: MessageOut): Message {
  return {
    id: String(m.id),
    threadId: String(m.thread_id),
    senderId: String(m.sender_id),
    body: m.body,
    sentAt: m.created_at,
    read: m.read,
  };
}

export function mapClarificationQuestion(q: ClarificationQuestionOut): ClarificationQuestion {
  return {
    id: String(q.id),
    requirementId: String(q.requirement_id),
    askerId: String(q.asker_id),
    askerName: q.asker_name,
    question: q.question,
    answer: q.answer,
    answeredAt: q.answered_at,
    createdAt: q.created_at,
  };
}

const QUOTATION_DETAIL_STATUS_MAP: Record<string, QuotationStatus> = {
  released: 'RELEASED',
  shortlisted: 'SHORTLISTED',
  awarded: 'AWARDED',
  not_selected: 'NOT_SELECTED',
  withdrawn: 'WITHDRAWN',
  voided: 'WITHDRAWN', // BACKEND GAP — no distinct "voided" state on the frontend's QuotationStatus
};

export function mapQuotationDetail(q: QuotationDetailOut, requirementId: string): Quotation {
  return {
    id: String(q.id),
    ref: q.quotation_ref,
    requirementId,
    respondentId: String(q.business.id),
    status: QUOTATION_DETAIL_STATUS_MAP[q.status] ?? 'RELEASED',
    totalPrice: q.total_price ?? 0,
    leadTimeDays: parseLeadingInt(q.delivery_lead_time),
    paymentTerms: q.payment_terms ?? '',
    validityDays: parseLeadingInt(q.validity_period),
    notesToBuyer: q.notes,
    attachments: q.attachments.map((a) => ({
      id: String(a.id),
      filename: a.filename,
      sizeBytes: 0, // BACKEND GAP
      mimeType: '', // BACKEND GAP
      uri: '', // BACKEND GAP — no download URL in AttachmentOut yet
    })),
    submittedAt: q.submitted_at,
    hashTruncated: '',
    ledgerEntryId: '',
    integrity: mapIntegrity(q.integrity_status),
    withdrawnAt: null,
    replacedByQuotationId: null,
  };
}

/** Builds the `viewer: Business` HomeFeed needs from /auth/me +
 *  /business/verification-status + /business/dashboard-stats. */
export function mapViewerBusiness(
  user: BackendUser,
  verification: VerificationStatusOut,
  stats: DashboardStatsOut,
): Business {
  return {
    id: String(user.id),
    registeredName: verification.registered_name ?? user.business_name,
    displayName: null,
    businessType: (verification.business_type as BusinessType) ?? 'SOLE_PROP',
    category: verification.industry_category ?? '',
    city: verification.city ?? '',
    province: verification.province ?? '',
    contactPerson: verification.contact_person ?? '',
    contactMobile: verification.contact_mobile ?? user.mobile_number,
    capabilities: verification.capabilities,
    serviceAreas: verification.service_areas,
    credibility: {
      status: verification.is_verified
        ? 'VERIFIED'
        : verification.verification_status === 'rejected'
        ? 'REJECTED'
        : verification.has_submitted
        ? 'PENDING'
        : 'UNVERIFIED',
      verifiedAt: verification.verification_date,
      recheckDueAt: verification.recheck_date,
      tier: (verification.tier as 1 | 2 | 3) ?? null,
      requirementsPosted: stats.requirements_posted_count,
      requirementsAwarded: stats.requirements_awarded_count,
      quotationsSubmitted: stats.quotations_submitted_count,
      quotationsAwarded: 0, // BACKEND GAP — dashboard-stats doesn't split this out
    },
    profileCompletionPct: stats.profile_completion_pct,
    memberSinceYear: stats.member_since_year,
  };
}
