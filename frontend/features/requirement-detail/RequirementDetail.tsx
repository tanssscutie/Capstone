// features/requirement-detail/RequirementDetail.tsx
// One component, three states, driven entirely by props. No screens, no tabs.

import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { View, Text, Pressable, Modal, TextInput, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import {
  color,
  font,
  fontSize,
  lineHeight,
  letterSpacing,
  space,
  radius,
  elevation,
  layout,
  breakpoint,
} from '../../components/ui/tokens';
import ScreenScroll from '../../components/ui/ScreenScroll';
import type {
  Requirement,
  Business,
  Quotation,
  LedgerEntry,
  RequirementDetailState,
  BusinessId,
  SpecRow,
  DeliverySite,
  Attachment,
  ISODateTime,
  TrustTier,
  RequirementStatus,
  QuotationStatus,
  IntegrityResult,
  BusinessStatus,
  ClarificationQuestion,
} from '../../lib/types';

/* ─── Props ─────────────────────────────────────────── */

interface RespondentNotSubmitted {
  state: Extract<RequirementDetailState, 'RESPONDENT'>;
  requirement: Requirement;
  buyer: Business;
  hasSubmitted: false;
  onSubmitQuotation?: () => void;
  questions: ClarificationQuestion[];
  onAskQuestion?: (question: string) => void;
  onViewBuyerProfile?: () => void;
  onViewLedger?: () => void;
}

interface RespondentSubmitted {
  state: Extract<RequirementDetailState, 'RESPONDENT'>;
  requirement: Requirement;
  buyer: Business;
  hasSubmitted: true;
  ownQuotation: Quotation;
  ledgerEntry: LedgerEntry;
  onWithdraw?: () => void;
  /** Only meaningful while ownQuotation.status === 'AWARD_PENDING' — this
   *  respondent is the proposed winner and needs to accept or decline the
   *  Notice of Award before it's ever final. */
  onAcceptAward?: () => void;
  onDeclineAward?: () => void;
  questions: ClarificationQuestion[];
  onAskQuestion?: (question: string) => void;
  onViewBuyerProfile?: () => void;
  onViewLedger?: () => void;
}

interface OwnerSealedProps {
  state: Extract<RequirementDetailState, 'OWNER_SEALED'>;
  requirement: Requirement;
  questions: ClarificationQuestion[];
  onAnswerQuestion?: (questionId: string, answer: string) => void;
  onExtendClosing?: (newClosesAt: string) => void;
  onCancelRequirement?: () => void;
  onUpdateSiteNotes?: (accessHours: string, accessNotes: string) => void;
  onViewLedger?: () => void;
}

/** Everything a released quotation card shows about its respondent — nothing more. */
type Respondent = Pick<Business, 'id' | 'registeredName' | 'city' | 'province' | 'credibility'>;

interface OwnerReleasedProps {
  state: Extract<RequirementDetailState, 'OWNER_RELEASED'>;
  requirement: Requirement;
  quotations: Quotation[];
  respondents: Record<BusinessId, Respondent>;
  onShortlistToggle?: (quotationId: string) => void;
  /** Return false (or reject) if the backend refused the award — the hook
   *  rolls the optimistic AWARD_PENDING state back rather than leaving the
   *  screen stuck showing "locked" for a decision that never actually went
   *  through. */
  onAward?: (quotationId: string) => Promise<boolean> | void;
  /** Same rollback contract as onAward — see its comment. Without this, a
   *  rejected close-without-award (e.g. the requirement already reached a
   *  final decision on the backend, from a stale screen or a double-click)
   *  left the screen optimistically locked forever with no way out. */
  onCloseWithoutAward?: () => Promise<boolean> | void;
  onViewRespondentProfile?: (businessId: string) => void;
  onMessageRespondent?: (businessId: string) => void;
  onViewLedger?: () => void;
}

export type RequirementDetailProps =
  | RespondentNotSubmitted
  | RespondentSubmitted
  | OwnerSealedProps
  | OwnerReleasedProps;

/* ─── Formatting helpers ────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: ISODateTime): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDateTime(iso: ISODateTime): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)}, ${h}:${mm} ${ampm}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function formatPHP(amount: number): string {
  const rounded = Math.round(amount);
  const withCommas = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₱${withCommas}`;
}

function formatBudget(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatPHP(min)} – ${formatPHP(max)}`;
  if (min !== null) return `From ${formatPHP(min)}`;
  if (max !== null) return `Up to ${formatPHP(max)}`;
  return 'Not specified';
}

/** submittedAt + validityDays, presented as an absolute date rather than a duration. */
function formatValidUntil(submittedAt: ISODateTime, validityDays: number): string {
  const d = new Date(submittedAt);
  d.setDate(d.getDate() + validityDays);
  return formatDate(d.toISOString());
}

/** Up to two letters for an avatar chip — "Bayan Logistics Corp." → "BL". */
function initials(name: string): string {
  const words = name.split(' ').filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/);
}

function tierLabel(tier: TrustTier | null): string {
  return tier === null ? 'Unrated' : `Tier ${tier}`;
}

function businessStatusLabel(status: BusinessStatus): string {
  switch (status) {
    case 'UNVERIFIED': return 'Unverified';
    case 'PENDING': return 'Pending verification';
    case 'VERIFIED': return 'Verified';
    case 'REJECTED': return 'Rejected';
    case 'EXPIRED': return 'Verification expired';
  }
}

function requirementStatusLabel(status: RequirementStatus): string {
  switch (status) {
    case 'DRAFT': return 'Draft';
    case 'OPEN': return 'Open';
    case 'CLOSED': return 'Closed';
    case 'AWARD_PENDING': return 'Award pending';
    case 'AWARDED': return 'Awarded';
    case 'CLOSED_NO_AWARD': return 'Closed — No Award';
    case 'CANCELLED': return 'Cancelled';
  }
}

function requirementStatusTone(status: RequirementStatus): 'primary' | 'danger' | 'neutral' {
  switch (status) {
    case 'OPEN':
    case 'AWARDED':
      return 'primary';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function quotationStatusLabel(status: QuotationStatus): string {
  switch (status) {
    case 'SUBMITTED': return 'Submitted';
    case 'RELEASED': return 'Released';
    case 'SHORTLISTED': return 'Shortlisted';
    case 'AWARD_PENDING': return 'Notice of Award — awaiting response';
    case 'AWARDED': return 'Awarded';
    case 'NOT_SELECTED': return 'Not selected';
    case 'WITHDRAWN': return 'Withdrawn';
  }
}

function integrityLabel(result: IntegrityResult | null): string {
  if (result === null) return 'Pending';
  return result === 'VALID' ? 'Valid' : 'Flagged';
}

/* ─── Countdown hook ────────────────────────────────── */

function pluralUnit(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "113 days, 17 hours" — drops to the next pair of units as each one empties out. */
function formatCountdownWords(days: number, hours: number, minutes: number): string {
  if (days > 0) return `${pluralUnit(days, 'day')}, ${pluralUnit(hours, 'hour')}`;
  if (hours > 0) return `${pluralUnit(hours, 'hour')}, ${pluralUnit(minutes, 'minute')}`;
  return pluralUnit(minutes, 'minute');
}

function useCountdown(closingAt: ISODateTime): { label: string; closed: boolean; urgent: boolean } {
  const target = new Date(closingAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = target - now;
  if (remainingMs <= 0) return { label: 'Closed', closed: true, urgent: false };

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return { label: formatCountdownWords(days, hours, minutes), closed: false, urgent: remainingMs < 24 * 3600_000 };
}

/* ─── Small building blocks ─────────────────────────── */

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function LabelValueRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.labelValueRow}>
      <Text style={styles.labelValueLabel}>{label}</Text>
      <Text style={[styles.labelValueValue, mono ? styles.mono : null]}>{value}</Text>
    </View>
  );
}

type BadgeTone = 'primary' | 'danger' | 'neutral' | 'ink';

function Badge({ label, tone, dot = false }: { label: string; tone: BadgeTone; dot?: boolean }) {
  const bg = tone === 'primary' ? color.primaryFaint : tone === 'danger' ? color.dangerFaint : tone === 'ink' ? color.ink : color.surfaceSunken;
  const borderColor = tone === 'primary' ? color.primary : tone === 'danger' ? color.dangerBorder : tone === 'ink' ? color.ink : color.border;
  const textColor = tone === 'primary' ? color.primary : tone === 'danger' ? color.danger : tone === 'ink' ? color.canvas : color.inkMuted;
  return (
    <View style={[styles.badge, styles.badgeRow, { backgroundColor: bg, borderColor }]}>
      {dot && <View style={[styles.badgeDot, { backgroundColor: textColor }]} />}
      <Text style={[styles.badgeLabel, { color: textColor }]}>{label}</Text>
    </View>
  );
}

type ActionButtonVariant = 'primary' | 'outline' | 'danger' | 'text' | 'tinted' | 'ink';

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: ActionButtonVariant;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor:
            variant === 'primary' ? (pressed ? color.primaryPressed : color.primary)
            : variant === 'ink' ? color.ink
            : variant === 'tinted' ? color.primaryFaint
            : variant === 'text' ? 'transparent'
            : color.surface,
          borderColor:
            variant === 'danger' ? color.dangerBorder
            : variant === 'outline' ? color.border
            : variant === 'text' ? 'transparent'
            : variant === 'tinted' ? color.primaryBorder
            : variant === 'ink' ? color.ink
            : color.primary,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.actionButtonLabel,
          {
            color:
              variant === 'primary' ? color.onPrimary
              : variant === 'ink' ? color.canvas
              : variant === 'danger' ? color.danger
              : variant === 'text' ? color.inkMuted
              : variant === 'tinted' ? color.primary
              : color.ink,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SpecTable({ rows }: { rows: SpecRow[] }) {
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((row, index) => (
        <View key={`${row.label}-${index}`} style={styles.specRow}>
          <Text style={styles.specLabel}>{row.label}</Text>
          <Text style={styles.specValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

function DeliverySiteView({ site }: { site: DeliverySite }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.bodyTextSemi}>{site.name}</Text>
      <Text style={styles.bodyText}>{site.address}</Text>
      <Text style={styles.mutedSmall}>{site.accessHours}</Text>
      <Text style={styles.mutedSmall}>{site.accessNote}</Text>
    </View>
  );
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) {
    return <Text style={styles.mutedSmall}>No attachments</Text>;
  }
  return (
    <View style={{ gap: space.sm }}>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.attachmentRow}>
          <Text style={styles.bodyText} numberOfLines={1}>{attachment.filename}</Text>
          <Text style={styles.mutedSmall}>{formatBytes(attachment.sizeBytes)}</Text>
        </View>
      ))}
    </View>
  );
}

function CredibilityBlockView({ label, business }: { label: string; business: Business }) {
  const c = business.credibility;
  const name = business.displayName ?? business.registeredName;
  return (
    <View style={styles.block}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={styles.bodyTextSemi}>{name}</Text>
      <View style={{ gap: space.xs, marginTop: space.xs }}>
        <LabelValueRow label="Status" value={businessStatusLabel(c.status)} />
        <LabelValueRow label="Tier" value={tierLabel(c.tier)} />
        <LabelValueRow label="Verified" value={c.verifiedAt ? formatDate(c.verifiedAt) : '—'} />
        <LabelValueRow label="Recheck due" value={c.recheckDueAt ? formatDate(c.recheckDueAt) : '—'} />
        <LabelValueRow label="Requirements posted" value={String(c.requirementsPosted)} />
        <LabelValueRow label="Requirements awarded" value={String(c.requirementsAwarded)} />
        <LabelValueRow label="Quotations submitted" value={String(c.quotationsSubmitted)} />
        <LabelValueRow label="Quotations awarded" value={String(c.quotationsAwarded)} />
      </View>
    </View>
  );
}

function CountdownBadge({ closingAt }: { closingAt: ISODateTime }) {
  const { label, closed } = useCountdown(closingAt);
  return (
    <View style={styles.block}>
      <SectionLabel>{closed ? 'Closed' : 'Closes in'}</SectionLabel>
      <Text style={[styles.countdown, closed ? styles.countdownClosed : null]}>{label}</Text>
      {!closed && <Text style={styles.mutedSmall}>{formatDateTime(closingAt)}</Text>}
    </View>
  );
}

function BareQuotationCount({ count }: { count: number }) {
  return (
    <View style={styles.block}>
      <SectionLabel>Quotations received</SectionLabel>
      <Text style={styles.countNumber}>{count}</Text>
    </View>
  );
}

/* ─── Shared requirement overview (all three states) ───── */
/** Split into atomic blocks so the wide layout can route them to different columns
 *  while the phone layout keeps composing them in this same original order. */

function ScopeBlock({ requirement }: { requirement: Requirement }) {
  return (
    <View style={styles.block}>
      <SectionLabel>Scope</SectionLabel>
      <Text style={styles.bodyText}>{requirement.scope}</Text>
    </View>
  );
}

function SpecificationsBlock({ requirement }: { requirement: Requirement }) {
  return (
    <View style={styles.block}>
      <SectionLabel>Specifications</SectionLabel>
      <SpecTable rows={requirement.specifications} />
    </View>
  );
}

function QuantityBudgetRow({ requirement }: { requirement: Requirement }) {
  return (
    <View style={styles.rowBlock}>
      <View style={styles.blockHalf}>
        <SectionLabel>Quantity</SectionLabel>
        <Text style={styles.bodyText}>{requirement.quantity}</Text>
      </View>
      <View style={styles.blockHalf}>
        <SectionLabel>Indicative budget</SectionLabel>
        <Text style={styles.bodyText}>{formatBudget(requirement.budgetMin, requirement.budgetMax)}</Text>
      </View>
    </View>
  );
}

function DeliveryWindowBlock({ requirement }: { requirement: Requirement }) {
  return (
    <View style={styles.block}>
      <SectionLabel>Delivery window</SectionLabel>
      <Text style={styles.bodyText}>{requirement.deliveryWindow}</Text>
    </View>
  );
}

function DeliverySiteBlock({ requirement }: { requirement: Requirement }) {
  return (
    <View style={styles.block}>
      <SectionLabel>Delivery site</SectionLabel>
      <DeliverySiteView site={requirement.deliverySite} />
    </View>
  );
}

function AttachmentsBlock({ requirement }: { requirement: Requirement }) {
  return (
    <View style={styles.block}>
      <SectionLabel>Attachments</SectionLabel>
      <AttachmentList attachments={requirement.attachments} />
    </View>
  );
}

function RequirementOverview({ requirement }: { requirement: Requirement }) {
  return (
    <View style={{ gap: space.xxl }}>
      <ScopeBlock requirement={requirement} />
      <SpecificationsBlock requirement={requirement} />
      <QuantityBudgetRow requirement={requirement} />
      <DeliveryWindowBlock requirement={requirement} />
      <DeliverySiteBlock requirement={requirement} />
      <AttachmentsBlock requirement={requirement} />
    </View>
  );
}

function Header({ requirement }: { requirement: Requirement }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.headerTopRow}>
        <SectionLabel>{requirement.category}</SectionLabel>
        <Badge label={requirementStatusLabel(requirement.status)} tone={requirementStatusTone(requirement.status)} />
      </View>
      <Text style={styles.title}>{requirement.title}</Text>
      <Text style={styles.ref}>{requirement.ref}</Text>
    </View>
  );
}

/* ─── RESPONDENT state ──────────────────────────────── */

/** The proposed winner's side of a Notice of Award — when the response window
 *  closes. Past that, the backend's scheduler auto-declines it. */
function AwardResponseNote({ deadline }: { deadline: ISODateTime | null }) {
  return (
    <Text style={styles.mutedSmall}>
      The buyer proposed you as the winner.{' '}
      {deadline
        ? `Respond by ${formatDateTime(deadline)}, or it auto-declines.`
        : 'Respond before the window closes, or it auto-declines.'}
    </Text>
  );
}

function SealedRecordPanel({
  quotation,
  ledgerEntry,
  awardResponseDeadline,
  onWithdraw,
  onAcceptAward,
  onDeclineAward,
}: {
  quotation: Quotation;
  ledgerEntry: LedgerEntry;
  awardResponseDeadline: ISODateTime | null;
  onWithdraw?: () => void;
  onAcceptAward?: () => void;
  onDeclineAward?: () => void;
}) {
  const canWithdraw = quotation.status === 'SUBMITTED';
  const isAwardPending = quotation.status === 'AWARD_PENDING';
  return (
    <View style={styles.sealedCard}>
      <SectionLabel>Your quotation</SectionLabel>
      <View style={{ gap: space.xs }}>
        <LabelValueRow label="Reference" value={quotation.ref} mono />
        <LabelValueRow label="Submitted" value={formatDateTime(quotation.submittedAt)} />
        <LabelValueRow label="Ledger entry" value={`#${ledgerEntry.sequence}`} mono />
        {!canWithdraw && <LabelValueRow label="Status" value={quotationStatusLabel(quotation.status)} />}
      </View>
      {isAwardPending ? (
        <>
          <AwardResponseNote deadline={awardResponseDeadline} />
          <ActionButton label="Accept award" variant="primary" onPress={onAcceptAward} />
          <ActionButton label="Decline" variant="danger" onPress={onDeclineAward} />
        </>
      ) : canWithdraw ? (
        <ActionButton label="Withdraw quotation" variant="danger" onPress={onWithdraw} />
      ) : (
        <Text style={styles.mutedSmall}>
          Withdrawal is only possible while a quotation is submitted and unreleased.
        </Text>
      )}
    </View>
  );
}

/** All of RESPONDENT's content lives in the side column on the wide layout. */
function RespondentSideContent(props: RespondentNotSubmitted | RespondentSubmitted) {
  const { requirement, buyer } = props;
  return (
    <>
      <CredibilityBlockView label="Posted by" business={buyer} />
      <CountdownBadge closingAt={requirement.closingAt} />
      <BareQuotationCount count={requirement.quotationCount} />
      {props.hasSubmitted ? (
        <SealedRecordPanel
          quotation={props.ownQuotation}
          ledgerEntry={props.ledgerEntry}
          awardResponseDeadline={requirement.awardResponseDeadline}
          onWithdraw={props.onWithdraw}
          onAcceptAward={props.onAcceptAward}
          onDeclineAward={props.onDeclineAward}
        />
      ) : (
        <ActionButton label="Submit quotation" variant="primary" onPress={props.onSubmitQuotation} />
      )}
    </>
  );
}

/* ─── Pre-closing clarification Q&A ──────────────────────
 * Public on an OPEN requirement — a question and its answer are visible to every
 * respondent, not sealed. Shared between RESPONDENT (ask) and OWNER_SEALED (answer);
 * unanswered questions read as "awaiting an answer" to anyone but the buyer. */

function QuestionRow({
  q,
  canAnswer,
  onAnswerQuestion,
}: {
  q: ClarificationQuestion;
  canAnswer: boolean;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
}) {
  const [answering, setAnswering] = useState(false);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAnswerQuestion?.(q.id, trimmed);
    setAnswering(false);
    setDraft('');
  };

  return (
    <View style={styles.qaRow}>
      <Text style={styles.bodyTextSemi}>{q.askerName} asked</Text>
      <Text style={styles.bodyText}>{q.question}</Text>
      {q.answer ? (
        <View style={styles.qaAnswerBlock}>
          <Text style={styles.mutedSmall}>Answer</Text>
          <Text style={styles.bodyText}>{q.answer}</Text>
        </View>
      ) : canAnswer ? (
        answering ? (
          <View style={{ gap: space.sm }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Visible to every respondent once posted"
              placeholderTextColor={color.inkFaint}
              multiline
              style={styles.qaInput}
            />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <ActionButton label="Post answer" variant="primary" onPress={submit} disabled={!draft.trim()} />
              <ActionButton label="Cancel" variant="text" onPress={() => { setAnswering(false); setDraft(''); }} />
            </View>
          </View>
        ) : (
          <ActionButton label="Answer" variant="outline" onPress={() => setAnswering(true)} />
        )
      ) : (
        <Text style={styles.mutedRow}>Awaiting an answer from the buyer.</Text>
      )}
    </View>
  );
}

function QASection({
  questions,
  canAsk,
  canAnswer,
  onAskQuestion,
  onAnswerQuestion,
}: {
  questions: ClarificationQuestion[];
  canAsk: boolean;
  canAnswer: boolean;
  onAskQuestion?: (question: string) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
}) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAskQuestion?.(trimmed);
    setDraft('');
  };

  return (
    <View style={styles.block}>
      <SectionLabel>Questions</SectionLabel>
      {questions.length === 0 ? (
        <Text style={styles.mutedSmall}>No questions yet. Answers are visible to every respondent.</Text>
      ) : (
        <View style={{ gap: space.md }}>
          {questions.map((q) => (
            <QuestionRow key={q.id} q={q} canAnswer={canAnswer} onAnswerQuestion={onAnswerQuestion} />
          ))}
        </View>
      )}

      {canAsk && (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask a clarification question — the buyer's answer goes to every respondent"
            placeholderTextColor={color.inkFaint}
            multiline
            style={styles.qaInput}
          />
          <ActionButton label="Ask question" variant="outline" onPress={submit} disabled={!draft.trim()} />
        </View>
      )}
    </View>
  );
}

function RespondentPanel(props: RespondentNotSubmitted | RespondentSubmitted) {
  return (
    <View style={{ gap: space.xxl }}>
      <RespondentSideContent {...props} />
      <QASection questions={props.questions} canAsk canAnswer={false} onAskQuestion={props.onAskQuestion} />
    </View>
  );
}

/* ─── OWNER_SEALED state ─────────────────────────────── */

function SealedExplanation() {
  return (
    <View style={styles.block}>
      <SectionLabel>Why nothing more is visible</SectionLabel>
      <Text style={styles.bodyText}>
        Quotations stay sealed until the countdown reaches zero. This stops respondents from seeing
        each other&apos;s pricing and undercutting one another, so the comparison is fair the moment
        it releases. Until then only the count above is shown — no names, figures, or previews.
      </Text>
    </View>
  );
}

function EditabilityList() {
  return (
    <View style={styles.block}>
      <SectionLabel>Before closing</SectionLabel>
      <View style={{ gap: space.sm }}>
        <Text style={styles.bodyText}>Can still edit: delivery window, delivery site, attachments.</Text>
        <Text style={styles.bodyText}>
          Locked: scope, specifications, quantity, indicative budget, closing date — respondents
          have already priced against these.
        </Text>
      </View>
    </View>
  );
}

/** Goes in the side column on the wide layout. */
function OwnerSealedSideContent({ requirement }: { requirement: Requirement }) {
  return (
    <>
      <CountdownBadge closingAt={requirement.closingAt} />
      <BareQuotationCount count={requirement.quotationCount} />
    </>
  );
}

/** Goes in the main column on the wide layout. */
function OwnerSealedMainContent() {
  return (
    <>
      <SealedExplanation />
      <EditabilityList />
    </>
  );
}

function OwnerSealedPanel(props: OwnerSealedProps) {
  return (
    <View style={{ gap: space.xxl }}>
      <OwnerSealedSideContent requirement={props.requirement} />
      <OwnerSealedMainContent />
      <QASection questions={props.questions} canAsk={false} canAnswer onAnswerQuestion={props.onAnswerQuestion} />
    </View>
  );
}

/* ─── OWNER_RELEASED state ───────────────────────────── */

type SortKey = 'price' | 'leadTime' | 'tier' | 'submittedAt';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'price', label: 'Price' },
  { key: 'leadTime', label: 'Lead time' },
  { key: 'tier', label: 'Tier' },
  { key: 'submittedAt', label: 'Submitted' },
];

const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  price: 'asc',
  leadTime: 'asc',
  tier: 'desc',
  submittedAt: 'desc',
};

function compareQuotations(
  a: Quotation,
  b: Quotation,
  key: SortKey,
  dir: SortDir,
  respondents: Record<BusinessId, Respondent>,
): number {
  let result: number;
  switch (key) {
    case 'price':
      result = a.totalPrice - b.totalPrice;
      break;
    case 'leadTime':
      result = a.leadTimeDays - b.leadTimeDays;
      break;
    case 'submittedAt':
      result = new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
      break;
    case 'tier': {
      const ta = respondents[a.respondentId]?.credibility.tier ?? 0;
      const tb = respondents[b.respondentId]?.credibility.tier ?? 0;
      result = ta - tb;
      break;
    }
  }
  return dir === 'asc' ? result : -result;
}

function SortBar({
  activeKey,
  activeDir,
  onPress,
}: {
  activeKey: SortKey;
  activeDir: SortDir;
  onPress: (key: SortKey) => void;
}) {
  return (
    <View style={styles.sortBar}>
      {SORT_OPTIONS.map((option) => {
        const active = option.key === activeKey;
        return (
          <Pressable
            key={option.key}
            onPress={() => onPress(option.key)}
            style={[styles.sortChip, active ? styles.sortChipActive : null]}
          >
            <Text style={[styles.sortChipLabel, active ? styles.sortChipLabelActive : null]}>
              {option.label}{active ? (activeDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function QuotationCard({
  quotation,
  respondent,
  awardLocked,
  predecessor,
  onToggleShortlist,
  onRequestAward,
}: {
  quotation: Quotation;
  respondent: Respondent;
  awardLocked: boolean;
  predecessor: Quotation | null;
  onToggleShortlist: () => void;
  onRequestAward: () => void;
}) {
  const isAwarded = quotation.status === 'AWARDED';
  const isAwardPending = quotation.status === 'AWARD_PENDING';
  const isNotSelected = quotation.status === 'NOT_SELECTED';
  const isShortlisted = quotation.status === 'SHORTLISTED';
  const isFlagged = quotation.integrity === 'FLAGGED';
  const name = respondent.registeredName;

  return (
    <View style={[styles.quotationCard, isAwarded ? styles.quotationCardAwarded : null, isFlagged ? styles.quotationCardFlagged : null]}>
      <View style={styles.quotationCardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.respondentName}>{name}</Text>
          <Text style={styles.mutedSmall}>{quotation.ref}</Text>
        </View>
        <View style={{ gap: space.xs, alignItems: 'flex-end' }}>
          {isAwarded && <Badge label="Awarded" tone="primary" />}
          {isAwardPending && <Badge label="Notice sent" tone="neutral" />}
          {isNotSelected && <Badge label="Not selected" tone="neutral" />}
          {isShortlisted && <Badge label="Shortlisted" tone="primary" />}
          {isFlagged && <Badge label="Flagged" tone="danger" />}
        </View>
      </View>

      <View style={styles.quotationFactRow}>
        <LabelValueRow label="Verified" value={respondent.credibility.verifiedAt ? formatDate(respondent.credibility.verifiedAt) : '—'} />
        <LabelValueRow label="Tier" value={tierLabel(respondent.credibility.tier)} />
      </View>
      <View style={styles.quotationFactRow}>
        <LabelValueRow label="Requirements posted" value={String(respondent.credibility.requirementsPosted)} />
        <LabelValueRow label="Quotations awarded" value={String(respondent.credibility.quotationsAwarded)} />
      </View>

      <View style={styles.quotationPriceRow}>
        <Text style={styles.priceText}>{formatPHP(quotation.totalPrice)}</Text>
        <Text style={styles.mutedSmall}>{quotation.leadTimeDays} days lead time</Text>
      </View>

      {quotation.lineItems.length > 0 && (
        <View style={styles.block}>
          <SectionLabel>Itemized breakdown</SectionLabel>
          <View style={{ gap: space.xs, marginTop: space.xs }}>
            {quotation.lineItems.map((li, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <Text style={[styles.mutedSmall, { flex: 1 }]} numberOfLines={2}>
                  {li.description} × {li.quantity}
                </Text>
                <Text style={styles.mutedSmall}>{formatPHP(li.quantity * li.unitPrice)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.quotationFactRow}>
        <LabelValueRow label="Payment terms" value={quotation.paymentTerms} />
        <LabelValueRow label="Validity" value={`${quotation.validityDays} days`} />
      </View>

      {quotation.notesToBuyer.length > 0 && (
        <View style={styles.block}>
          <SectionLabel>Notes</SectionLabel>
          <Text style={styles.bodyText}>{quotation.notesToBuyer}</Text>
        </View>
      )}

      {quotation.attachments.length > 0 && (
        <View style={styles.block}>
          <SectionLabel>Attachments</SectionLabel>
          <AttachmentList attachments={quotation.attachments} />
        </View>
      )}

      <View style={styles.quotationFactRow}>
        <LabelValueRow label="Submitted" value={formatDateTime(quotation.submittedAt)} />
        <LabelValueRow label="Integrity" value={integrityLabel(quotation.integrity)} />
      </View>

      {predecessor && (
        <Text style={styles.mutedSmall}>
          Replaces withdrawn {predecessor.ref}
          {predecessor.withdrawnAt ? ` (${formatDateTime(predecessor.withdrawnAt)})` : ''}
        </Text>
      )}

      {isAwardPending && (
        <Text style={styles.mutedSmall}>Notice of Award sent — awaiting this business's response.</Text>
      )}

      {!isAwarded && !isAwardPending && !isNotSelected && (
        <View style={styles.quotationActions}>
          <ActionButton
            label={isShortlisted ? 'Unshortlist' : 'Shortlist'}
            variant="outline"
            onPress={onToggleShortlist}
            disabled={awardLocked}
          />
          <ActionButton label="Award" variant="primary" onPress={onRequestAward} disabled={awardLocked} />
        </View>
      )}
    </View>
  );
}

function AwardConfirmationModal({
  visible,
  respondentName,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  respondentName: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.modalOverlay} onPress={onCancel}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <SectionLabel>Send Notice of Award</SectionLabel>
          <Text style={styles.bodyTextSemi}>
            {respondentName ? `Send a Notice of Award to ${respondentName}?` : 'Send a Notice of Award?'}
          </Text>
          <Text style={styles.bodyText}>
            They'll have a few days to accept or decline. Nothing is final yet — every other quotation
            stays exactly as it is until they respond.
          </Text>
          <Text style={styles.bodyText}>
            If they decline, or don't respond in time, you can propose someone else. Recorded on the ledger.
          </Text>
          <Text style={styles.mutedSmall}>
            Trustlink does not handle payment, delivery, or contracts — the two parties settle directly.
          </Text>
          <View style={styles.modalActions}>
            <View style={styles.modalActionButton}>
              <ActionButton label="Cancel" variant="text" onPress={onCancel} />
            </View>
            <View style={styles.modalActionButton}>
              <ActionButton label="Confirm" variant="primary" onPress={onConfirm} />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AwardPendingBanner({ respondentName, deadline }: { respondentName: string | null; deadline: ISODateTime | null }) {
  return (
    <View style={styles.awardPendingBanner}>
      <SectionLabel>Notice of Award sent</SectionLabel>
      <Text style={styles.bodyText}>
        {respondentName ? `Waiting on ${respondentName} to accept or decline.` : 'Waiting on a response.'}
        {deadline ? ` Responds by ${formatDateTime(deadline)}, or you can propose someone else.` : ''}
      </Text>
    </View>
  );
}

/** No forcing function makes a buyer decide after release — this is purely a
 *  nudge, computed live from releasedAt rather than a stored alert, since the
 *  platform's Alerts inbox is a fixed 11-event list (thesis Coverage of the
 *  Study) that a "still no decision" reminder doesn't belong in. Shown only
 *  while nothing has been decided yet (no award proposed, none confirmed,
 *  not closed without award) — see the `locked` check at each call site. */
const DECISION_REMINDER_DAYS = 3;

function DecisionReminderBanner({ releasedAt }: { releasedAt: ISODateTime | null }) {
  if (!releasedAt) return null;
  const days = Math.floor((Date.now() - new Date(releasedAt).getTime()) / (24 * 60 * 60 * 1000));
  if (days < DECISION_REMINDER_DAYS) return null;
  return (
    <View style={styles.awardPendingBanner}>
      <SectionLabel>Still no decision</SectionLabel>
      <Text style={styles.bodyText}>
        Released {days} day{days === 1 ? '' : 's'} ago. Every respondent is waiting — shortlist, send a Notice of Award, or close without award.
      </Text>
    </View>
  );
}

/** State + business logic for OWNER_RELEASED, shared by the phone stack and the
 *  wide layout's rebuilt cards so both render the same underlying decisions. */
function useOwnerReleased({
  requirement,
  quotations: initialQuotations,
  respondents,
  onShortlistToggle,
  onAward,
  onCloseWithoutAward,
}: OwnerReleasedProps) {
  const [quotations, setQuotations] = useState<Quotation[]>(initialQuotations);
  const [awardedId, setAwardedId] = useState<string | null>(
    requirement.status === 'AWARDED' ? requirement.awardedQuotationId : null,
  );
  // A Notice of Award sent but not yet accepted/declined — distinct from
  // awardedId, which only ever means "confirmed." Kept separate so the UI
  // can tell "waiting on their response" apart from "this is final."
  const [awardPendingId, setAwardPendingId] = useState<string | null>(
    requirement.status === 'AWARD_PENDING' ? requirement.awardedQuotationId : null,
  );
  const [closedNoAward, setClosedNoAward] = useState(requirement.status === 'CLOSED_NO_AWARD');
  const [sortKey, setSortKey] = useState<SortKey>('submittedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [awardTargetId, setAwardTargetId] = useState<string | null>(null);
  const locked = awardedId !== null || closedNoAward || awardPendingId !== null;

  const handleSortPress = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(SORT_DEFAULT_DIR[key]);
    }
  };

  const handleToggleShortlist = (id: string) => {
    if (locked) return;
    setQuotations((prev) =>
      prev.map((q) =>
        q.id === id ? { ...q, status: q.status === 'SHORTLISTED' ? 'RELEASED' : 'SHORTLISTED' } : q,
      ),
    );
    onShortlistToggle?.(id);
  };

  const handleConfirmAward = async (id: string) => {
    // Sends a Notice of Award — proposes, doesn't finalize. Only the target
    // row changes; every other quotation stays exactly as it was until the
    // proposed business actually accepts (see accept_award/decline_award on
    // the backend — award() itself never touches anyone else's status).
    const previousStatus = quotations.find((q) => q.id === id)?.status ?? 'RELEASED';
    setAwardPendingId(id);
    setQuotations((prev) => prev.map((q) => (q.id === id ? { ...q, status: 'AWARD_PENDING' } : q)));
    setAwardTargetId(null);
    const ok = await Promise.resolve(onAward?.(id)).catch(() => false);
    // The backend refused this (e.g. someone else already got a Notice of
    // Award, or the requirement moved on) — undo the optimistic lock rather
    // than leaving the screen stuck showing a pending award that never sent.
    if (ok === false) {
      setAwardPendingId((current) => (current === id ? null : current));
      setQuotations((prev) => prev.map((q) => (q.id === id ? { ...q, status: previousStatus } : q)));
    }
  };

  const handleCloseWithoutAward = async () => {
    if (locked) return;
    const previousStatuses = new Map(quotations.map((q) => [q.id, q.status]));
    setClosedNoAward(true);
    setQuotations((prev) =>
      prev.map((q) => (q.status === 'RELEASED' || q.status === 'SHORTLISTED' ? { ...q, status: 'NOT_SELECTED' } : q)),
    );
    const ok = await Promise.resolve(onCloseWithoutAward?.()).catch(() => false);
    if (ok === false) {
      setClosedNoAward(false);
      setQuotations((prev) => prev.map((q) => ({ ...q, status: previousStatuses.get(q.id) ?? q.status })));
    }
  };

  const visible = quotations.filter((q) => q.status !== 'WITHDRAWN');
  const withdrawn = quotations.filter((q) => q.status === 'WITHDRAWN');
  const sorted = [...visible].sort((a, b) => compareQuotations(a, b, sortKey, sortDir, respondents));
  const orphanWithdrawn = withdrawn.filter((w) => !visible.some((v) => v.id === w.replacedByQuotationId));

  const awardTarget = quotations.find((q) => q.id === awardTargetId) ?? null;
  const awardTargetName = awardTarget ? respondents[awardTarget.respondentId].registeredName : null;

  const awardPending = quotations.find((q) => q.id === awardPendingId) ?? null;
  const awardPendingName = awardPending ? respondents[awardPending.respondentId].registeredName : null;

  const shortlistedCount = quotations.filter((q) => q.status === 'SHORTLISTED').length;
  const flaggedCount = visible.filter((q) => q.integrity === 'FLAGGED').length;

  return {
    respondents,
    visible,
    withdrawn,
    sorted,
    orphanWithdrawn,
    sortKey,
    sortDir,
    awardedId,
    awardPendingId,
    awardPendingName,
    awardResponseDeadline: requirement.awardResponseDeadline,
    releasedAt: requirement.releasedAt,
    closedNoAward,
    locked,
    awardTargetId,
    awardTargetName,
    shortlistedCount,
    flaggedCount,
    handleSortPress,
    handleToggleShortlist,
    handleConfirmAward,
    handleCloseWithoutAward,
    setAwardTargetId,
  };
}

function OwnerReleasedPanel(props: OwnerReleasedProps) {
  const st = useOwnerReleased(props);

  return (
    <View style={{ gap: space.lg }}>
      {st.awardPendingId !== null && (
        <AwardPendingBanner respondentName={st.awardPendingName} deadline={st.awardResponseDeadline} />
      )}
      {!st.locked && <DecisionReminderBanner releasedAt={st.releasedAt} />}
      <SectionLabel>{`${st.visible.length} quotation${st.visible.length === 1 ? '' : 's'} released`}</SectionLabel>
      <SortBar activeKey={st.sortKey} activeDir={st.sortDir} onPress={st.handleSortPress} />
      <View style={{ gap: space.md }}>
        {st.sorted.map((q) => {
          const predecessor = st.withdrawn.find((w) => w.replacedByQuotationId === q.id) ?? null;
          return (
            <QuotationCard
              key={q.id}
              quotation={q}
              respondent={st.respondents[q.respondentId]}
              awardLocked={st.locked}
              predecessor={predecessor}
              onToggleShortlist={() => st.handleToggleShortlist(q.id)}
              onRequestAward={() => st.setAwardTargetId(q.id)}
            />
          );
        })}
      </View>
      {st.orphanWithdrawn.length > 0 && (
        <View style={{ gap: space.sm }}>
          <SectionLabel>Withdrawn</SectionLabel>
          {st.orphanWithdrawn.map((w) => (
            <Text key={w.id} style={styles.mutedRow}>
              {w.ref} — withdrawn {w.withdrawnAt ? formatDateTime(w.withdrawnAt) : ''}
            </Text>
          ))}
        </View>
      )}
      <AwardConfirmationModal
        visible={st.awardTargetId !== null}
        respondentName={st.awardTargetName}
        onCancel={() => st.setAwardTargetId(null)}
        onConfirm={() => {
          if (st.awardTargetId) st.handleConfirmAward(st.awardTargetId);
        }}
      />
    </View>
  );
}

/* ─── Wide layout ────────────────────────────────────────
 * Rebuilt from docs/design/Trustlink Requirement Detail.dc.html: same cards, same
 * sections, same order, same hierarchy as the design — the prototype's state-switcher
 * tabs are the only thing intentionally left out, since those aren't part of the product.
 * The phone stack above this point is untouched. */

const LOCKED_FIELDS = ['Scope and specifications', 'Quantities', 'Closing date and time'];

function WideHeader({ requirement }: { requirement: Requirement }) {
  const tone = requirementStatusTone(requirement.status);
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.widePillRow}>
        <View style={styles.categoryPill}>
          <Text style={styles.categoryPillLabel}>{requirement.category}</Text>
        </View>
        <Badge label={requirementStatusLabel(requirement.status)} tone={tone} dot />
      </View>
      <Text style={styles.wideTitle}>{requirement.title}</Text>
      <Text style={styles.wideSubtitle}>
        {requirement.publishedAt ? `Posted ${formatDate(requirement.publishedAt)}` : 'Not yet published'}
        {' · '}
        {requirement.deliverySite.address}
      </Text>
    </View>
  );
}

function WideFileChips({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) {
    return <Text style={styles.mutedSmall}>No attachments</Text>;
  }
  return (
    <View style={styles.wideChipsRow}>
      {attachments.map((a) => (
        <View key={a.id} style={styles.fileChip}>
          <Text style={styles.fileChipLabel} numberOfLines={1}>{a.filename}</Text>
        </View>
      ))}
    </View>
  );
}

function WideScopeCard({ requirement }: { requirement: Requirement }) {
  return (
    <View style={styles.wideCard}>
      <View style={{ gap: space.md }}>
        <SectionLabel>Scope of work</SectionLabel>
        {splitParagraphs(requirement.scope).map((para, i) => (
          <Text key={i} style={styles.bodyText}>{para}</Text>
        ))}
      </View>

      <View style={styles.wideSpecTable}>
        {requirement.specifications.map((row, index) => (
          <View key={`${row.label}-${index}`} style={[styles.wideSpecRow, index % 2 === 1 ? styles.wideSpecRowAlt : null]}>
            <Text style={styles.wideSpecKey}>{row.label}</Text>
            <Text style={styles.wideSpecValue}>{row.value}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.factsGrid, styles.wideDividedSection]}>
        <View style={styles.factsGridItem}>
          <SectionLabel>Site address</SectionLabel>
          <Text style={styles.factValue}>
            {requirement.deliverySite.name}
            {'\n'}
            <Text style={styles.factValueMuted}>{requirement.deliverySite.address}</Text>
          </Text>
        </View>
        <View style={styles.factsGridItem}>
          <SectionLabel>Site access</SectionLabel>
          <Text style={styles.factValue}>
            {requirement.deliverySite.accessHours}
            {'\n'}
            <Text style={styles.factValueMuted}>{requirement.deliverySite.accessNote}</Text>
          </Text>
        </View>
        <View style={styles.factsGridItem}>
          <SectionLabel>Settlement</SectionLabel>
          <Text style={styles.factValue}>
            Direct between parties
            {'\n'}
            <Text style={styles.factValueMuted}>Trustlink does not process payment</Text>
          </Text>
        </View>
      </View>

      <View style={styles.wideDividedSection}>
        <SectionLabel>Attachments</SectionLabel>
        <View style={{ marginTop: space.sm }}>
          <WideFileChips attachments={requirement.attachments} />
        </View>
      </View>

      {requirement.requiredDocuments.length > 0 && (
        <View style={styles.wideDividedSection}>
          <SectionLabel>Required documents from respondents</SectionLabel>
          <Text style={[styles.mutedSmall, { marginTop: space.xs }]}>
            Respondents are asked to attach these to their quotation — not a hard block on submitting.
          </Text>
          <View style={[styles.wideChipsRow, { marginTop: space.sm }]}>
            {requirement.requiredDocuments.map((d) => (
              <View key={d} style={styles.fileChip}>
                <Text style={styles.fileChipLabel} numberOfLines={1}>{d}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function WideRecordCard({ requirement, onViewLedger }: { requirement: Requirement; onViewLedger?: () => void }) {
  return (
    <View style={styles.wideCard}>
      <SectionLabel>Record</SectionLabel>
      <View style={styles.sideKeyValueList}>
        <LabelValueRow label="Reference" value={requirement.ref} mono />
        <LabelValueRow label="Published" value={requirement.publishedAt ? formatDateTime(requirement.publishedAt) : '—'} mono />
        <LabelValueRow label="Closing" value={formatDateTime(requirement.closingAt)} mono />
      </View>
      <Pressable onPress={onViewLedger} style={{ marginTop: space.md }}>
        <Text style={styles.wideLinkText}>View full audit trail</Text>
      </Pressable>
    </View>
  );
}

/** The info band: quick facts + buyer identity (respondent only), countdown, count,
 *  actions (respondent only), and the seal-line footer. Present in all three states. */
function WideInfoBand({
  requirement,
  buyer,
  showRespondentFacts,
  showActions,
  showSubmit,
  onSubmitQuotation,
  sealTinted,
  countLabel,
  countCaption,
  sealLine,
  onViewBuyerProfile,
}: {
  requirement: Requirement;
  buyer: Business | null;
  showRespondentFacts: boolean;
  showActions: boolean;
  showSubmit: boolean;
  onSubmitQuotation?: () => void;
  sealTinted: boolean;
  countLabel: string;
  countCaption: string;
  sealLine: string;
  onViewBuyerProfile?: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const { label: countdownLabel, closed, urgent } = useCountdown(requirement.closingAt);
  const clockColor = closed ? color.inkMuted : urgent ? color.danger : color.ink;

  return (
    <View style={[styles.wideCard, sealTinted ? styles.wideCardSealedTint : null]}>
      {showRespondentFacts && buyer && (
        <>
          <View style={[styles.factsGrid, styles.wideDividedSectionBottom]}>
            <View style={styles.factsGridItem}>
              <SectionLabel>Quantity</SectionLabel>
              <Text style={styles.factValue}>{requirement.quantity}</Text>
            </View>
            <View style={styles.factsGridItem}>
              <SectionLabel>Location</SectionLabel>
              <Text style={styles.factValue}>
                {buyer.city}, {buyer.province}
                {'\n'}
                <Text style={styles.factValueMuted}>{requirement.deliverySite.name}</Text>
              </Text>
            </View>
            <View style={styles.factsGridItem}>
              <SectionLabel>Indicative budget</SectionLabel>
              <Text style={styles.factValue}>
                {formatBudget(requirement.budgetMin, requirement.budgetMax)}
                {'\n'}
                <Text style={styles.factValueMuted}>Stated, not binding</Text>
              </Text>
            </View>
            <View style={styles.factsGridItem}>
              <SectionLabel>Needed by</SectionLabel>
              <Text style={styles.factValue}>
                {requirement.deliveryWindow}
                {'\n'}
                <Text style={styles.factValueMuted}>Installation window</Text>
              </Text>
            </View>
          </View>

          <View style={[styles.wideBuyerRow, styles.wideDividedSectionBottom]}>
            <View style={styles.avatarChip}>
              <Text style={styles.avatarChipLabel}>{initials(buyer.displayName ?? buyer.registeredName)}</Text>
            </View>
            <View style={styles.wideBuyerInfo}>
              <View style={styles.wideBuyerNameRow}>
                <Text style={styles.wideBuyerName}>{buyer.displayName ?? buyer.registeredName}</Text>
                {buyer.credibility.verifiedAt && (
                  <View style={styles.verifiedTag}>
                    <Text style={styles.verifiedTagLabel}>Verified {formatDate(buyer.credibility.verifiedAt)}</Text>
                  </View>
                )}
                <View style={styles.tierPill}>
                  <Text style={styles.tierPillLabel}>{tierLabel(buyer.credibility.tier)} of 3</Text>
                </View>
              </View>
              <Text style={styles.mutedSmall}>
                {buyer.credibility.requirementsPosted} requirements posted · {buyer.credibility.requirementsAwarded} awarded on Trustlink
              </Text>
            </View>
            <ActionButton label="View buyer profile" variant="outline" onPress={onViewBuyerProfile} />
          </View>
        </>
      )}

      <View style={styles.wideMetaRow}>
        <View style={styles.wideMetaBlock}>
          <SectionLabel>{closed ? 'Closed' : 'Closes in'}</SectionLabel>
          <View style={styles.wideCountdownRow}>
            <View style={[styles.statusDot, { backgroundColor: clockColor }]} />
            <Text style={[styles.wideCountdownValue, { color: clockColor }]}>{countdownLabel}</Text>
          </View>
          <Text style={styles.mutedSmall}>{formatDateTime(requirement.closingAt)}</Text>
        </View>

        <View style={styles.wideMetaDivider} />

        <View style={styles.wideMetaBlock}>
          <SectionLabel>{countLabel}</SectionLabel>
          <Text style={styles.wideCountValue}>{requirement.quotationCount}</Text>
          <Text style={styles.mutedSmall}>{countCaption}</Text>
        </View>

        <View style={styles.wideMetaSpacer} />

        {showActions && (
          <View style={styles.wideActionsRow}>
            <ActionButton
              label={saved ? 'Saved' : 'Save'}
              variant={saved ? 'tinted' : 'outline'}
              onPress={() => setSaved((v) => !v)}
            />
            {showSubmit && <ActionButton label="Submit quotation" variant="primary" onPress={onSubmitQuotation} />}
          </View>
        )}
      </View>

      <View style={styles.wideDividedSectionTop}>
        <Text style={styles.mutedSmall}>{sealLine}</Text>
      </View>
    </View>
  );
}

function WideSealedHero({ requirement, onViewLedger }: { requirement: Requirement; onViewLedger?: () => void }) {
  const [showHow, setShowHow] = useState(false);
  const bars = Array.from({ length: Math.min(requirement.quotationCount, 12) });

  return (
    <View style={styles.wideHeroCard}>
      <View style={styles.wideHeroIcon} />
      <Text style={styles.wideHeroTitle}>{requirement.quotationCount} quotations are sealed</Text>
      <Text style={styles.wideHeroBody}>
        All submissions remain hidden until {formatDateTime(requirement.closingAt)}. At closing, all quotations open simultaneously.
      </Text>

      <View style={styles.sealBarsRow}>
        {bars.map((_, i) => (
          <View key={i} style={styles.sealBar} />
        ))}
      </View>
      <Text style={styles.wideHeroCaption}>
        {requirement.quotationCount} sealed record{requirement.quotationCount === 1 ? '' : 's'} · contents unreadable
      </Text>

      <ActionButton
        label={showHow ? 'Hide how sealed quotations work' : 'How sealed quotations work'}
        variant="outline"
        onPress={() => setShowHow((v) => !v)}
      />

      {showHow && (
        <View style={styles.wideHeroDisclosure}>
          <Text style={styles.bodyText}>
            Quotations stay unreadable so nobody can undercut a price they cannot see — the last quotation you
            receive is priced on the same information as the first.
          </Text>
          <Text style={styles.bodyText}>
            Each submission is recorded in a tamper-evident log the moment it arrives. At closing, every record
            is re-checked and any quotation altered after submission opens with a flag rather than being hidden.
            Withdrawals stay in the record alongside their replacement.
          </Text>
          <Pressable onPress={onViewLedger}>
            <Text style={styles.wideLinkText}>View audit record</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Native `datetime-local` on web — same reasoning as PostRequirement.tsx's DateField:
 *  a real visible input, not a hidden proxy, so the browser's picker always anchors
 *  correctly. Native has no such widget without an extra dep, so it falls back to a
 *  plain (non-editable) hint. */
function DateTimeField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: boolean }) {
  const webAvailable = typeof document !== 'undefined' && typeof document.createElement === 'function';
  if (webAvailable) {
    return (
      <input
        type="datetime-local"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        style={{
          flex: 1,
          minWidth: 180,
          fontFamily: font.monoMedium,
          fontSize: fontSize.base,
          color: color.ink,
          background: color.canvas,
          border: `1px solid ${error ? color.dangerBorder : color.border}`,
          borderRadius: radius.lg,
          paddingLeft: space.md,
          paddingRight: space.md,
          paddingTop: space.sm,
          paddingBottom: space.sm,
          outline: 'none',
        }}
      />
    );
  }
  return (
    <View style={[styles.ownerControlInput, error ? styles.inputErrorBorder : null]}>
      <Text style={styles.mutedSmall}>Pick a new closing time — web only</Text>
    </View>
  );
}

function WideOwnerControlsCard({
  requirement,
  onExtendClosing,
  onCancelRequirement,
  onUpdateSiteNotes,
}: {
  requirement: Requirement;
  onExtendClosing?: (newClosesAt: string) => void;
  onCancelRequirement?: () => void;
  onUpdateSiteNotes?: (accessHours: string, accessNotes: string) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [accessHours, setAccessHours] = useState(requirement.deliverySite.accessHours);
  const [accessNotes, setAccessNotes] = useState(requirement.deliverySite.accessNote);
  const [notesSaved, setNotesSaved] = useState(false);

  const [editingClosing, setEditingClosing] = useState(false);
  const [newClosing, setNewClosing] = useState('');
  const [closingError, setClosingError] = useState<string | null>(null);

  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const hasQuotations = requirement.quotationCount > 0;

  const saveNotes = () => {
    onUpdateSiteNotes?.(accessHours.trim(), accessNotes.trim());
    setEditingNotes(false);
    setNotesSaved(true);
  };

  const openExtend = () => {
    setClosingError(null);
    const current = new Date(requirement.closingAt);
    setNewClosing(Number.isNaN(current.getTime()) ? '' : current.toISOString().slice(0, 16));
    setEditingClosing(true);
  };

  const saveExtend = () => {
    if (!newClosing) {
      setClosingError('Pick a date and time.');
      return;
    }
    const nextMs = new Date(`${newClosing}:00+08:00`).getTime();
    if (nextMs <= Date.now()) {
      setClosingError('New closing time must be in the future.');
      return;
    }
    if (nextMs <= new Date(requirement.closingAt).getTime()) {
      setClosingError('Extending means picking a later time than the current one.');
      return;
    }
    onExtendClosing?.(`${newClosing}:00+08:00`);
    setEditingClosing(false);
  };

  return (
    <View style={styles.wideCard}>
      <SectionLabel>Owner controls</SectionLabel>

      {/* ---------- Site access notes: never locked ---------- */}
      {editingNotes ? (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <Text style={styles.mutedSmall}>Access hours</Text>
          <TextInput
            value={accessHours}
            onChangeText={setAccessHours}
            placeholder="e.g. Mon–Sat, 7:00 AM – 6:00 PM"
            placeholderTextColor={color.inkFaint}
            style={styles.ownerControlInput}
          />
          <Text style={styles.mutedSmall}>Site notes</Text>
          <TextInput
            value={accessNotes}
            onChangeText={setAccessNotes}
            placeholder="e.g. Gate code, warehouse status, who to ask for on site"
            placeholderTextColor={color.inkFaint}
            multiline
            style={styles.qaInput}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <ActionButton label="Save" variant="primary" onPress={saveNotes} />
            <ActionButton label="Cancel" variant="text" onPress={() => setEditingNotes(false)} />
          </View>
        </View>
      ) : (
        <View style={{ gap: space.xs }}>
          <ActionButton
            label="Edit contact and site notes"
            variant="outline"
            onPress={() => {
              setNotesSaved(false);
              setEditingNotes(true);
            }}
          />
          {notesSaved && <Text style={styles.mutedSmall}>Saved.</Text>}
        </View>
      )}

      {/* ---------- Extend closing: only while nobody has quoted yet ---------- */}
      <View style={styles.wideDividedSectionTop}>
        <SectionLabel>Extend closing time</SectionLabel>
        {hasQuotations ? (
          <Text style={[styles.mutedSmall, { marginTop: space.sm }]}>
            Can't extend — {requirement.quotationCount} business{requirement.quotationCount === 1 ? ' has' : 'es have'} already
            quoted against the current closing time.
          </Text>
        ) : editingClosing ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <DateTimeField value={newClosing} onChange={setNewClosing} error={!!closingError} />
            {closingError && <Text style={styles.errorText}>{closingError}</Text>}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <ActionButton label="Save new closing time" variant="primary" onPress={saveExtend} />
              <ActionButton label="Cancel" variant="text" onPress={() => setEditingClosing(false)} />
            </View>
          </View>
        ) : (
          <View style={{ marginTop: space.sm }}>
            <ActionButton label="Extend closing time" variant="outline" onPress={openExtend} />
          </View>
        )}
      </View>

      <View style={styles.wideDividedSectionTop}>
        <SectionLabel>Locked until closing</SectionLabel>
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          {LOCKED_FIELDS.map((field) => (
            <Text key={field} style={styles.mutedSmall}>{field}</Text>
          ))}
        </View>
        <Text style={[styles.mutedSmall, { marginTop: space.sm }]}>
          {requirement.quotationCount} business{requirement.quotationCount === 1 ? '' : 'es'} have priced against
          these terms, so they cannot change.
        </Text>
      </View>

      {/* ---------- Cancel: available any time while open, voids active quotations ---------- */}
      <View style={styles.wideDividedSectionTop}>
        <Text style={[styles.sectionLabel, { color: color.danger }]}>Cancel requirement</Text>
        {confirmingCancel ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Text style={styles.mutedSmall}>
              {hasQuotations
                ? `This voids ${requirement.quotationCount} sealed quotation${requirement.quotationCount === 1 ? '' : 's'} unopened. This cannot be undone.`
                : 'This cannot be undone.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <ActionButton label="Confirm cancel" variant="danger" onPress={() => { onCancelRequirement?.(); setConfirmingCancel(false); }} />
              <ActionButton label="Never mind" variant="text" onPress={() => setConfirmingCancel(false)} />
            </View>
          </View>
        ) : (
          <View style={{ marginTop: space.sm }}>
            <ActionButton label="Cancel requirement" variant="danger" onPress={() => setConfirmingCancel(true)} />
          </View>
        )}
      </View>
    </View>
  );
}

function WideMyRecordCard({
  quotation,
  ledgerEntry,
  awardResponseDeadline,
  onWithdraw,
  onAcceptAward,
  onDeclineAward,
}: {
  quotation: Quotation;
  ledgerEntry: LedgerEntry;
  awardResponseDeadline: ISODateTime | null;
  onWithdraw?: () => void;
  onAcceptAward?: () => void;
  onDeclineAward?: () => void;
}) {
  const canWithdraw = quotation.status === 'SUBMITTED';
  const isAwardPending = quotation.status === 'AWARD_PENDING';
  return (
    <View style={styles.wideMyRecordCard}>
      <View style={styles.submittedTag}>
        <Text style={styles.submittedTagLabel}>{isAwardPending ? 'Notice of Award — respond' : 'Submitted · sealed'}</Text>
      </View>
      <Text style={styles.mutedSmall}>
        Your quotation is recorded and cannot be read by the buyer or any other respondent until closing.
      </Text>
      <View style={[styles.sideKeyValueList, styles.wideDividedSectionTop]}>
        <LabelValueRow label="Reference" value={quotation.ref} mono />
        <LabelValueRow label="Submitted" value={formatDateTime(quotation.submittedAt)} mono />
      </View>
      <Text style={styles.wideLedgerNote}>
        Recorded and tamper-evident · #{ledgerEntry.sequence}
      </Text>
      {isAwardPending ? (
        <>
          <AwardResponseNote deadline={awardResponseDeadline} />
          <ActionButton label="Accept award" variant="primary" onPress={onAcceptAward} />
          <ActionButton label="Decline" variant="danger" onPress={onDeclineAward} />
        </>
      ) : canWithdraw ? (
        <>
          <ActionButton label="Withdraw quotation" variant="danger" onPress={onWithdraw} />
          <Text style={styles.mutedSmall}>
            Withdrawal is recorded in the ledger. The original entry is kept and shown to the buyer at release.
            You may resubmit until closing.
          </Text>
        </>
      ) : (
        <Text style={styles.mutedSmall}>Status: {quotationStatusLabel(quotation.status)}</Text>
      )}
    </View>
  );
}

function WideReleasedHeaderCard({
  st,
  requirement,
}: {
  st: ReturnType<typeof useOwnerReleased>;
  requirement: Requirement;
}) {
  return (
    <View style={styles.wideCard}>
      <View style={styles.wideReleasedHeaderRow}>
        <View style={{ minWidth: 0 }}>
          <Text style={styles.wideSectionTitle}>
            {st.visible.length} quotation{st.visible.length === 1 ? '' : 's'} released
          </Text>
          <Text style={styles.mutedSmall}>
            Opened {formatDateTime(requirement.closingAt)}
            {st.withdrawn.length > 0
              ? ` · ${st.withdrawn.length} withdrawal${st.withdrawn.length === 1 ? '' : 's'} in the record`
              : ''}
            {st.flaggedCount > 0 && (
              <Text style={{ color: color.danger }}>
                {' · '}{st.flaggedCount} integrity flag{st.flaggedCount === 1 ? '' : 's'}
              </Text>
            )}
          </Text>
        </View>
        <View style={styles.wideMetaSpacer} />
        <View style={styles.wideSortRow}>
          <SectionLabel>Sort</SectionLabel>
          {SORT_OPTIONS.map((option) => {
            const active = option.key === st.sortKey;
            return (
              <Pressable
                key={option.key}
                onPress={() => st.handleSortPress(option.key)}
                style={[styles.wideSortChip, active ? styles.wideSortChipActive : null]}
              >
                <Text style={[styles.wideSortChipLabel, active ? styles.wideSortChipLabelActive : null]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function WideQuotationCard({
  quotation,
  respondent,
  awardLocked,
  predecessor,
  onToggleShortlist,
  onRequestAward,
  onViewProfile,
  onMessage,
}: {
  quotation: Quotation;
  respondent: Respondent;
  awardLocked: boolean;
  predecessor: Quotation | null;
  onToggleShortlist: () => void;
  onRequestAward: () => void;
  onViewProfile: () => void;
  onMessage: () => void;
}) {
  const isAwarded = quotation.status === 'AWARDED';
  const isAwardPending = quotation.status === 'AWARD_PENDING';
  const isNotSelected = quotation.status === 'NOT_SELECTED';
  const isShortlisted = quotation.status === 'SHORTLISTED';
  const isFlagged = quotation.integrity === 'FLAGGED';
  const name = respondent.registeredName;

  const accentColor = isFlagged ? color.danger : isAwarded ? color.ink : isShortlisted ? color.primary : color.border;
  const avatarBg = isAwarded ? color.ink : color.primary;

  let stateLabel: string | null = null;
  let stateTone: BadgeTone = 'neutral';
  if (isAwarded) { stateLabel = 'Awarded'; stateTone = 'ink'; }
  else if (isAwardPending) { stateLabel = 'Notice sent'; stateTone = 'neutral'; }
  else if (isNotSelected) { stateLabel = 'Not selected'; stateTone = 'neutral'; }
  else if (isShortlisted) { stateLabel = 'Shortlisted'; stateTone = 'primary'; }

  return (
    <View style={[styles.wideQuoteCard, { borderLeftColor: accentColor }, isFlagged ? styles.wideQuoteCardFlagged : null]}>
      <View style={styles.wideQuoteHeader}>
        <View style={[styles.avatarChip, { backgroundColor: avatarBg }]}>
          <Text style={styles.avatarChipLabel}>{initials(name)}</Text>
        </View>
        <View style={styles.wideBuyerInfo}>
          <View style={styles.wideBuyerNameRow}>
            <Text style={styles.wideBuyerName}>{name}</Text>
            {respondent.credibility.verifiedAt && (
              <View style={styles.verifiedTag}>
                <Text style={styles.verifiedTagLabel}>Verified {formatDate(respondent.credibility.verifiedAt)}</Text>
              </View>
            )}
            <View style={styles.tierPill}>
              <Text style={styles.tierPillLabel}>{tierLabel(respondent.credibility.tier)}</Text>
            </View>
          </View>
          <Text style={styles.mutedSmall}>
            {respondent.credibility.requirementsPosted} requirements posted · {respondent.credibility.quotationsAwarded} awarded on Trustlink
          </Text>
        </View>
        <View style={styles.wideQuoteHeaderTags}>
          {stateLabel && <Badge label={stateLabel} tone={stateTone} />}
          <View style={[styles.integrityTag, isFlagged ? styles.integrityTagFlagged : null]}>
            <Text style={[styles.integrityTagLabel, isFlagged ? { color: color.danger } : null]}>
              {isFlagged ? 'Integrity check failed' : predecessor ? 'Withdrawn and replaced' : 'Integrity verified'}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.factsGrid, styles.wideDividedSection]}>
        <View style={styles.factsGridItem}>
          <SectionLabel>Price</SectionLabel>
          <Text style={styles.widePriceValue}>{formatPHP(quotation.totalPrice)}</Text>
        </View>
        <View style={styles.factsGridItem}>
          <SectionLabel>Lead time</SectionLabel>
          <Text style={styles.factValue}>{quotation.leadTimeDays} days</Text>
        </View>
        <View style={styles.factsGridItem}>
          <SectionLabel>Payment terms</SectionLabel>
          <Text style={styles.factValue}>{quotation.paymentTerms}</Text>
        </View>
        <View style={styles.factsGridItem}>
          <SectionLabel>Valid until</SectionLabel>
          <Text style={styles.factValue}>{formatValidUntil(quotation.submittedAt, quotation.validityDays)}</Text>
        </View>
      </View>

      {quotation.lineItems.length > 0 && (
        <View style={styles.wideSpecTable}>
          {quotation.lineItems.map((li, index) => (
            <View key={index} style={[styles.wideSpecRow, index % 2 === 1 ? styles.wideSpecRowAlt : null]}>
              <Text style={styles.wideSpecKey}>{li.description} × {li.quantity}</Text>
              <Text style={styles.wideSpecValue}>{formatPHP(li.quantity * li.unitPrice)}</Text>
            </View>
          ))}
        </View>
      )}

      {quotation.notesToBuyer.length > 0 && (
        <Text style={styles.bodyText}>{quotation.notesToBuyer}</Text>
      )}

      <WideFileChips attachments={quotation.attachments} />

      {predecessor && (
        <View style={styles.ledgerHistoryCard}>
          <SectionLabel>Ledger history</SectionLabel>
          <View style={styles.ledgerHistoryRow}>
            <View style={styles.withdrawnTag}>
              <Text style={styles.withdrawnTagLabel}>Withdrawn</Text>
            </View>
            <Text style={[styles.labelValueValue, styles.mono]}>{predecessor.ref}</Text>
            <Text style={styles.mutedSmall}>
              Withdrawn {predecessor.withdrawnAt ? formatDateTime(predecessor.withdrawnAt) : ''} · replaced by this submission
            </Text>
          </View>
        </View>
      )}

      <View style={styles.wideQuoteFooter}>
        <Text style={styles.mutedSmall}>Submitted {formatDateTime(quotation.submittedAt)}</Text>
        <View style={styles.wideMetaSpacer} />
        <View style={styles.wideQuoteFooterActions}>
          <ActionButton label="View profile" variant="outline" onPress={onViewProfile} />
          <ActionButton label="Message" variant="outline" onPress={onMessage} />
          {!isAwardPending && (
            <ActionButton
              label={isShortlisted ? 'Shortlisted' : 'Shortlist'}
              variant={isShortlisted ? 'tinted' : 'outline'}
              onPress={onToggleShortlist}
              disabled={awardLocked}
            />
          )}
          {!isAwardPending && (
            <ActionButton
              label={isAwarded ? 'Awarded' : isNotSelected ? 'Not selected' : 'Award'}
              variant={isAwarded ? 'ink' : 'primary'}
              onPress={onRequestAward}
              disabled={awardLocked}
            />
          )}
        </View>
      </View>
    </View>
  );
}

function WideCloseoutCard({
  awarded,
  pending,
  closedNoAward,
  onCloseWithoutAward,
}: {
  awarded: boolean;
  pending: boolean;
  closedNoAward: boolean;
  onCloseWithoutAward?: () => void;
}) {
  const title = awarded
    ? 'This requirement is awarded'
    : pending
      ? 'A Notice of Award is pending'
      : closedNoAward
        ? 'Closed without an award'
        : 'No suitable quotation?';
  const body = awarded
    ? 'All other respondents were notified that the requirement was awarded to another business.'
    : pending
      ? 'You can close without award once the pending notice is accepted, declined, or its response window passes.'
      : closedNoAward
        ? 'Every respondent was notified. This outcome is recorded on your public profile and cannot be reversed.'
        : 'Closing without award notifies every respondent and records the outcome on your public profile. The requirement cannot be reopened.';

  return (
    <View style={styles.wideCloseoutCard}>
      <View style={styles.wideCloseoutBody}>
        <Text style={styles.bodyTextSemi}>{title}</Text>
        <Text style={[styles.mutedSmall, { marginTop: space.xs }]}>{body}</Text>
      </View>
      {!awarded && !pending && !closedNoAward && <ActionButton label="Close without award" variant="danger" onPress={onCloseWithoutAward} />}
    </View>
  );
}

function WideDecisionCard({ st }: { st: ReturnType<typeof useOwnerReleased> }) {
  const awarded = st.awardedId !== null;
  const pending = st.awardPendingId !== null;
  const title = awarded
    ? 'Awarded'
    : pending
      ? 'Notice of Award sent'
      : st.closedNoAward
        ? 'Closed — No Award'
        : st.shortlistedCount > 0
          ? 'Shortlist in progress'
          : 'No decision recorded';
  const body = awarded
    ? 'The award is written to the ledger. Contact details have been exchanged — Trustlink does not handle payment, delivery, or contracts, and observes nothing beyond this point.'
    : pending
      ? `Waiting on ${st.awardPendingName ?? 'the proposed business'} to accept or decline. Nothing else changes until they respond.`
      : st.closedNoAward
        ? 'This requirement was closed without awarding any of the released quotations. Every respondent was notified.'
        : 'Shortlisting is optional. You may award directly from the released quotations, or shortlist first when comparing many.';

  return (
    <View style={styles.wideCard}>
      <SectionLabel>Decision</SectionLabel>
      <Text style={styles.wideCardTitle}>{title}</Text>
      <Text style={styles.mutedSmall}>{body}</Text>
      <View style={[styles.sideKeyValueList, styles.wideDividedSectionTop]}>
        <LabelValueRow label="Released" value={String(st.visible.length)} />
        <LabelValueRow label="Shortlisted" value={String(st.shortlistedCount)} />
      </View>
    </View>
  );
}

function WideIntegrityFlagCard({ onViewLedger }: { onViewLedger?: () => void }) {
  return (
    <View style={styles.wideFlagCard}>
      <View style={styles.wideFlagHeader}>
        <View style={styles.flagDot} />
        <SectionLabel>Integrity flag</SectionLabel>
      </View>
      <Text style={[styles.mutedSmall, { marginTop: space.sm }]}>
        One quotation no longer matches the record made at submission. It stays in the list, marked, so you can
        judge it yourself.
      </Text>
      <Pressable onPress={onViewLedger}>
        <Text style={[styles.wideLinkText, { color: color.danger, marginTop: space.md }]}>View audit record</Text>
      </Pressable>
    </View>
  );
}

/** Owns the OWNER_RELEASED hook (rules of hooks means it needs its own component)
 *  and lays out the full wide screen: main column cards, side column cards, modal. */
function WideOwnerReleasedScreen(props: OwnerReleasedProps) {
  const { requirement } = props;
  const st = useOwnerReleased(props);
  const decided = st.locked;

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={styles.pageWide}>
        <WideHeader requirement={requirement} />
        <View style={styles.columns}>
          <View style={styles.mainColumn}>
            <WideInfoBand
              requirement={requirement}
              buyer={null}
              showRespondentFacts={false}
              showActions={false}
              showSubmit={false}
              sealTinted={false}
              countLabel="Quotations released"
              countCaption="opened simultaneously"
              sealLine="Every quotation opened together at the closing time. Nobody saw a price before that moment."
            />
            {st.awardPendingId !== null && (
              <AwardPendingBanner respondentName={st.awardPendingName} deadline={st.awardResponseDeadline} />
            )}
            {!st.locked && <DecisionReminderBanner releasedAt={st.releasedAt} />}
            <WideReleasedHeaderCard st={st} requirement={requirement} />
            <View style={{ gap: space.lg }}>
              {st.sorted.map((q) => {
                const predecessor = st.withdrawn.find((w) => w.replacedByQuotationId === q.id) ?? null;
                return (
                  <WideQuotationCard
                    key={q.id}
                    quotation={q}
                    respondent={st.respondents[q.respondentId]}
                    awardLocked={decided}
                    predecessor={predecessor}
                    onToggleShortlist={() => st.handleToggleShortlist(q.id)}
                    onRequestAward={() => st.setAwardTargetId(q.id)}
                    onViewProfile={() => props.onViewRespondentProfile?.(q.respondentId)}
                    onMessage={() => props.onMessageRespondent?.(q.respondentId)}
                  />
                );
              })}
            </View>
            <WideCloseoutCard
              awarded={st.awardedId !== null}
              pending={st.awardPendingId !== null}
              closedNoAward={st.closedNoAward}
              onCloseWithoutAward={st.handleCloseWithoutAward}
            />
            <WideScopeCard requirement={requirement} />
          </View>
          <View style={[styles.sideColumn, stickyOnWeb]}>
            <WideDecisionCard st={st} />
            {st.flaggedCount > 0 && <WideIntegrityFlagCard onViewLedger={props.onViewLedger} />}
            <WideRecordCard requirement={requirement} onViewLedger={props.onViewLedger} />
          </View>
        </View>
        <AwardConfirmationModal
          visible={st.awardTargetId !== null}
          respondentName={st.awardTargetName}
          onCancel={() => st.setAwardTargetId(null)}
          onConfirm={() => {
            if (st.awardTargetId) st.handleConfirmAward(st.awardTargetId);
          }}
        />
      </View>
    </ScreenScroll>
  );
}

/* ─── Root component ────────────────────────────────── */

export default function RequirementDetail(props: RequirementDetailProps) {
  const { requirement } = props;
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;

  if (!isWide) {
    return (
      <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
        <View style={styles.page}>
          <Header requirement={requirement} />
          <RequirementOverview requirement={requirement} />

          {props.state === 'RESPONDENT' && <RespondentPanel {...props} />}
          {props.state === 'OWNER_SEALED' && <OwnerSealedPanel {...props} />}
          {props.state === 'OWNER_RELEASED' && <OwnerReleasedPanel {...props} />}
        </View>
      </ScreenScroll>
    );
  }

  if (props.state === 'OWNER_RELEASED') {
    return <WideOwnerReleasedScreen {...props} />;
  }

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={styles.pageWide}>
        <WideHeader requirement={requirement} />
        <View style={styles.columns}>
          <View style={styles.mainColumn}>
            <WideInfoBand
              requirement={requirement}
              buyer={props.state === 'RESPONDENT' ? props.buyer : null}
              showRespondentFacts={props.state === 'RESPONDENT'}
              showActions={props.state === 'RESPONDENT'}
              showSubmit={props.state === 'RESPONDENT' && !props.hasSubmitted}
              onSubmitQuotation={props.state === 'RESPONDENT' && !props.hasSubmitted ? props.onSubmitQuotation : undefined}
              onViewBuyerProfile={props.state === 'RESPONDENT' ? props.onViewBuyerProfile : undefined}
              sealTinted={props.state === 'OWNER_SEALED'}
              countLabel={props.state === 'OWNER_SEALED' ? 'Sealed quotations' : 'Quotations'}
              countCaption="contents sealed"
              sealLine={
                props.state === 'OWNER_SEALED'
                  ? 'You cannot see who has quoted or what they offered. Neither can they. Everything opens together at closing.'
                  : 'Your price stays hidden until closing — from the buyer and from every other business quoting.'
              }
            />
            {props.state === 'OWNER_SEALED' && <WideSealedHero requirement={requirement} onViewLedger={props.onViewLedger} />}
            <WideScopeCard requirement={requirement} />
            {props.state === 'RESPONDENT' && (
              <QASection questions={props.questions} canAsk canAnswer={false} onAskQuestion={props.onAskQuestion} />
            )}
            {props.state === 'OWNER_SEALED' && (
              <QASection questions={props.questions} canAsk={false} canAnswer onAnswerQuestion={props.onAnswerQuestion} />
            )}
          </View>
          <View style={[styles.sideColumn, stickyOnWeb]}>
            {props.state === 'RESPONDENT' && props.hasSubmitted && (
              <WideMyRecordCard
                quotation={props.ownQuotation}
                ledgerEntry={props.ledgerEntry}
                awardResponseDeadline={props.requirement.awardResponseDeadline}
                onWithdraw={props.onWithdraw}
                onAcceptAward={props.onAcceptAward}
                onDeclineAward={props.onDeclineAward}
              />
            )}
            {props.state === 'OWNER_SEALED' && (
              <WideOwnerControlsCard
                requirement={requirement}
                onExtendClosing={props.onExtendClosing}
                onCancelRequirement={props.onCancelRequirement}
                onUpdateSiteNotes={props.onUpdateSiteNotes}
              />
            )}
            <WideRecordCard requirement={requirement} onViewLedger={props.onViewLedger} />
          </View>
        </View>
      </View>
    </ScreenScroll>
  );
}

/* ─── Wide layout: sticky side column ───────────────────
 * RN's own style types only know 'absolute' | 'relative' | 'static' for `position` —
 * 'sticky' is a react-native-web extension the type defs don't model. Native ScrollView
 * has no equivalent, so this only applies on web; native just gets a normal flowing column. */
const stickyOnWeb: ViewStyle =
  Platform.OS === 'web' ? ({ position: 'sticky', top: space.xxl } as unknown as ViewStyle) : {};

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  scrollContent: {
    alignItems: 'center',
    paddingVertical: space.xxl,
  },
  page: {
    width: '100%',
    maxWidth: layout.maxWidth,
    paddingHorizontal: layout.screenPadding,
    gap: space.section,
  },
  pageWide: {
    width: '100%',
    maxWidth: layout.maxWidthWide,
    paddingHorizontal: layout.screenPadding,
    gap: space.section,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xxl,
  },
  mainColumn: {
    flex: 3,
    gap: space.lg,
  },
  sideColumn: {
    flex: 1,
    minWidth: layout.sideColumnMinWidth,
    gap: space.lg,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: font.display,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  ref: {
    fontFamily: font.mono,
    fontSize: fontSize.sm,
    color: color.inkFaint,
  },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkMuted,
    marginBottom: space.sm,
  },
  block: {},
  rowBlock: {
    flexDirection: 'row',
    gap: space.xl,
  },
  blockHalf: {
    flex: 1,
  },
  bodyText: {
    fontFamily: font.body,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: color.ink,
  },
  bodyTextSemi: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: color.ink,
  },
  mutedSmall: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    color: color.inkMuted,
  },
  mutedRow: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    color: color.inkFaint,
  },
  qaRow: {
    gap: space.xs,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.borderFaint,
  },
  qaAnswerBlock: {
    marginTop: space.xs,
    paddingLeft: space.md,
    borderLeftWidth: 2,
    borderLeftColor: color.primaryBorder,
    gap: 2,
  },
  qaInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontFamily: font.body,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: color.ink,
    textAlignVertical: 'top',
  },
  ownerControlInput: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontFamily: font.body,
    fontSize: fontSize.base,
    color: color.ink,
    justifyContent: 'center',
  },
  inputErrorBorder: {
    borderColor: color.dangerBorder,
  },
  errorText: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.danger,
  },
  specRow: {
    gap: space.xs,
  },
  specLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },
  specValue: {
    fontFamily: font.body,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: color.ink,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: color.surfaceSunken,
    borderRadius: radius.sm,
  },
  countdown: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.xl,
    color: color.primary,
  },
  countdownClosed: {
    color: color.inkMuted,
  },
  countNumber: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    color: color.ink,
  },
  sealedCard: {
    ...elevation.cardRaised,
    borderRadius: radius.lg,
    padding: space.lg,
    backgroundColor: color.surface,
    gap: space.md,
  },
  labelValueRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  labelValueLabel: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },
  labelValueValue: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.ink,
    textAlign: 'right',
  },
  mono: {
    fontFamily: font.monoMedium,
  },
  actionButton: {
    minHeight: layout.minTouchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  actionButtonLabel: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.base,
  },
  badge: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  badgeLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
  },
  sortBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  sortChip: {
    minHeight: layout.minTouchTarget,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  sortChipActive: {
    backgroundColor: color.primaryFaint,
    borderColor: color.primary,
  },
  sortChipLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },
  sortChipLabelActive: {
    color: color.primary,
  },
  quotationCard: {
    ...elevation.card,
    borderRadius: radius.lg,
    padding: space.lg,
    backgroundColor: color.surface,
    gap: space.md,
  },
  quotationCardAwarded: {
    borderColor: color.primary,
    backgroundColor: color.primaryFaint,
  },
  quotationCardFlagged: {
    borderColor: color.dangerBorder,
  },
  awardPendingBanner: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space.lg,
    backgroundColor: color.surfaceSunken,
    gap: space.xs,
  },
  quotationCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: space.md,
  },
  respondentName: {
    fontFamily: font.bodySemi,
    fontSize: fontSize.md,
    color: color.ink,
  },
  quotationFactRow: {
    flexDirection: 'row',
    gap: space.lg,
  },
  quotationPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  priceText: {
    fontFamily: font.display,
    fontSize: fontSize.lg,
    color: color.ink,
  },
  quotationActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: color.inkMuted,
    alignItems: 'center',
    justifyContent: 'center',
    padding: layout.screenPadding,
  },
  modalCard: {
    ...elevation.cardRaised,
    width: '100%',
    maxWidth: layout.maxWidth - layout.screenPadding * 2,
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.sm,
  },
  modalActionButton: {
    flex: 1,
  },

  /* ─── Wide layout ─────────────────────────────────── */

  widePillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  categoryPill: {
    borderWidth: 1,
    borderColor: color.primaryBorder,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  categoryPillLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.primary,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  wideTitle: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  wideSubtitle: {
    fontFamily: font.body,
    fontSize: fontSize.base,
    color: color.inkMuted,
  },

  wideCard: {
    ...elevation.cardRaised,
    borderRadius: radius.xl,
    backgroundColor: color.surface,
    paddingVertical: space.xl,
    paddingHorizontal: space.xxl,
    gap: space.lg,
  },
  wideCardSealedTint: {
    backgroundColor: color.primaryFaint,
    borderColor: color.primaryBorder,
  },
  wideCardTitle: {
    fontFamily: font.display,
    fontSize: fontSize.md,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },

  wideDividedSection: {
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.borderFaint,
  },
  wideDividedSectionTop: {
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.borderFaint,
  },
  wideDividedSectionBottom: {
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.borderFaint,
  },

  factsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xl,
  },
  factsGridItem: {
    flexGrow: 1,
    flexBasis: layout.factMinWidth,
    minWidth: layout.factMinWidth,
  },
  factValue: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: color.ink,
    marginTop: space.xs,
  },
  factValueMuted: {
    fontFamily: font.body,
    color: color.inkMuted,
  },

  avatarChip: {
    width: space.section,
    height: space.section,
    borderRadius: radius.lg,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarChipLabel: {
    fontFamily: font.display,
    fontSize: fontSize.sm,
    color: color.canvas,
  },
  wideBuyerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
  },
  wideBuyerInfo: {
    flex: 1,
    minWidth: layout.factMinWidth,
    gap: space.xs,
  },
  wideBuyerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  wideBuyerName: {
    fontFamily: font.display,
    fontSize: fontSize.md,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  verifiedTag: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedTagLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.primary,
  },
  tierPill: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  tierPillLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkMuted,
  },

  wideMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    flexWrap: 'wrap',
  },
  wideMetaBlock: {
    minWidth: layout.factMinWidth,
  },
  wideMetaDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: color.border,
  },
  wideMetaSpacer: {
    flex: 1,
    minWidth: space.sm,
  },
  wideCountdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
  wideCountdownValue: {
    fontFamily: font.display,
    fontSize: fontSize.xl,
    letterSpacing: letterSpacing.tight,
  },
  wideCountValue: {
    fontFamily: font.display,
    fontSize: fontSize.xl,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
    marginTop: space.xs,
  },
  wideActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },

  wideHeroCard: {
    ...elevation.cardRaised,
    borderRadius: radius.xl,
    backgroundColor: color.surface,
    paddingVertical: space.xxxl,
    paddingHorizontal: space.xxl,
    alignItems: 'center',
    gap: space.lg,
  },
  wideHeroIcon: {
    width: space.xxxl * 2,
    height: space.xxxl * 2,
    borderRadius: radius.pill,
    backgroundColor: color.primaryFaint,
  },
  wideHeroTitle: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
    textAlign: 'center',
    maxWidth: '80%',
  },
  wideHeroBody: {
    fontFamily: font.body,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: color.inkMuted,
    textAlign: 'center',
    maxWidth: '90%',
  },
  sealBarsRow: {
    flexDirection: 'row',
    gap: space.xs,
    width: '100%',
    maxWidth: layout.maxWidth,
  },
  sealBar: {
    flex: 1,
    height: space.xxxl,
    borderRadius: radius.sm,
    backgroundColor: color.primaryFaint,
    borderWidth: 1,
    borderColor: color.primaryBorder,
  },
  wideHeroCaption: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkFaint,
    textAlign: 'center',
  },
  wideHeroDisclosure: {
    alignSelf: 'stretch',
    paddingTop: space.xxl,
    borderTopWidth: 1,
    borderTopColor: color.borderFaint,
    gap: space.md,
  },
  wideLinkText: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.primary,
  },

  wideChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  fileChip: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    maxWidth: '100%',
  },
  fileChipLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },

  wideSpecTable: {
    borderWidth: 1,
    borderColor: color.borderFaint,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  wideSpecRow: {
    flexDirection: 'row',
    gap: space.lg,
    padding: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.borderFaint,
    backgroundColor: color.surface,
  },
  wideSpecRowAlt: {
    backgroundColor: color.surfaceSunken,
  },
  wideSpecKey: {
    flex: 1,
    fontFamily: font.mono,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },
  wideSpecValue: {
    flex: 2,
    fontFamily: font.body,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
    color: color.ink,
  },

  sideKeyValueList: {
    gap: space.sm,
  },

  wideMyRecordCard: {
    borderWidth: 1,
    borderColor: color.primaryBorder,
    borderRadius: radius.xl,
    backgroundColor: color.surface,
    paddingVertical: space.xl,
    paddingHorizontal: space.xxl,
    gap: space.lg,
  },
  submittedTag: {
    alignSelf: 'flex-start',
    backgroundColor: color.primary,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  submittedTagLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.canvas,
  },
  wideLedgerNote: {
    fontFamily: font.body,
    fontSize: fontSize.sm,
    color: color.inkFaint,
  },

  wideReleasedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
  },
  wideSectionTitle: {
    fontFamily: font.display,
    fontSize: fontSize.lg,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  wideSortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  wideSortChip: {
    minHeight: layout.minTouchTarget,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    justifyContent: 'center',
    backgroundColor: color.surface,
  },
  wideSortChipActive: {
    backgroundColor: color.primaryFaint,
    borderColor: color.primaryBorder,
  },
  wideSortChipLabel: {
    fontFamily: font.bodyMedium,
    fontSize: fontSize.sm,
    color: color.inkMuted,
  },
  wideSortChipLabelActive: {
    color: color.primary,
  },

  wideQuoteCard: {
    ...elevation.card,
    borderLeftWidth: 3,
    borderRadius: radius.xl,
    backgroundColor: color.surface,
    paddingVertical: space.xl,
    paddingHorizontal: space.xxl,
    gap: space.lg,
  },
  wideQuoteCardFlagged: {
    borderColor: color.dangerBorder,
  },
  wideQuoteHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    flexWrap: 'wrap',
  },
  wideQuoteHeaderTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  widePriceValue: {
    fontFamily: font.display,
    fontSize: fontSize.lg,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
    marginTop: space.xs,
  },
  integrityTag: {
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  integrityTagFlagged: {
    borderColor: color.dangerBorder,
  },
  integrityTagLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkFaint,
  },

  ledgerHistoryCard: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.surfaceSunken,
    padding: space.lg,
  },
  ledgerHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
    marginTop: space.sm,
  },
  withdrawnTag: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  withdrawnTagLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkMuted,
  },

  wideQuoteFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: color.borderFaint,
  },
  wideQuoteFooterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },

  wideCloseoutCard: {
    ...elevation.cardRaised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    flexWrap: 'wrap',
    borderRadius: radius.xl,
    backgroundColor: color.surface,
    paddingVertical: space.lg,
    paddingHorizontal: space.xxl,
  },
  wideCloseoutBody: {
    flex: 1,
    minWidth: layout.factMinWidth,
  },

  wideFlagCard: {
    borderWidth: 1,
    borderColor: color.dangerBorder,
    borderRadius: radius.xl,
    backgroundColor: color.surface,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
  },
  wideFlagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  flagDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: color.danger,
  },
});
