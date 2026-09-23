// features/quotation/QuotationSubmission.tsx
// One component, two states, driven entirely by props — same pattern as
// RequirementDetail.tsx. FORM is the pricing form with the requirement's scope pinned
// beside it; SEALED_RECEIPT is the full-screen teaching moment after sealing, not a toast.
// Rebuilt from docs/design/Trustlink Quotation Submission.dc.html: same sections, same
// order, same sealing language.
//
// Hashing and ledger recording are server-side. This component only ever displays
// `quotation.hashTruncated` / `ledgerEntry.sequence` as given by props — it never derives
// or recomputes a hash on the device.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Platform,
  Linking,
  useWindowDimensions,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import ScreenScroll from '../../components/ui/ScreenScroll';
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
import { AvatarChip, initials } from '../../components/ui/AvatarChip';
import { isWebFilePickerSupported, pickWebFile } from '../../lib/pickWebFile';
import type {
  Business,
  BusinessId,
  Requirement,
  Quotation,
  LedgerEntry,
  Attachment,
  ISODateTime,
  TrustTier,
  QuotationSubmissionState,
} from '../../lib/types';

/* ─── Props ─────────────────────────────────────────── */

/** What the respondent enters. Everything else on Quotation (ref, hash, ledger entry,
 *  submittedAt, integrity…) is assigned server-side once this is submitted. */
export interface QuotationDraftInput {
  totalPrice: number;
  /** Empty when the respondent chose "Total price only" instead of line items. */
  lineItems: { description: string; quantity: number; unitPrice: number }[];
  leadTimeDays: number;
  paymentTerms: string;
  validityDays: number;
  notesToBuyer: string;
  attachments: Attachment[];
}

interface FormProps {
  state: Extract<QuotationSubmissionState, 'FORM'>;
  requirement: Requirement;
  buyer: Business;
  onSubmit?: (input: QuotationDraftInput) => void;
  onSaveDraft?: () => void;
  onBack?: () => void;
  onOpenBuyer?: (businessId: BusinessId) => void;
}

interface SealedReceiptProps {
  state: Extract<QuotationSubmissionState, 'SEALED_RECEIPT'>;
  requirement: Requirement;
  buyer: Business;
  quotation: Quotation;
  ledgerEntry: LedgerEntry;
  onWithdraw?: () => void;
  onBack?: () => void;
  onTrack?: () => void;
}

export type QuotationSubmissionProps = FormProps | SealedReceiptProps;

const RECEIPT_MAX_WIDTH = 880;

/* ─── Formatting helpers ────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: ISODateTime): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(d: Date): string {
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${mm} ${ampm}`;
}

function formatDateTime(iso: ISODateTime): string {
  return `${formatDate(iso)}, ${formatTime(new Date(iso))}`;
}

/** The receipt's "Submitted" field wants the exact second, unlike every other timestamp
 *  on this screen — it is the one place the seconds matter. */
function formatDateTimeExact(iso: ISODateTime): string {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${formatDate(iso)}, ${h}:${mm}:${ss} ${ampm}`;
}

function withCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPHP(amount: number): string {
  return `₱${withCommas(amount)}`;
}

function formatBudget(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatPHP(min)} – ${formatPHP(max)}`;
  if (min !== null) return `From ${formatPHP(min)}`;
  if (max !== null) return `Up to ${formatPHP(max)}`;
  return 'Not specified';
}

function num(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Strips anything but digits and a single decimal point, so numeric fields can't
 *  hold letters or symbols no matter what a device's keyboard allows through. */
function sanitizeNumeric(v: string): string {
  const cleaned = v.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

function pluralUnit(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

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

function StepLabel({ n, label, primary = false }: { n: string; label: string; primary?: boolean }) {
  return (
    <Text style={[styles.stepLabel, primary ? styles.stepLabelPrimary : null]}>
      {n} — {label}
    </Text>
  );
}

function Pill({
  label,
  active,
  onPress,
  variant = 'chip',
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** 'segment' reads as one grouped mode choice (e.g. Line items / Total price only)
   *  rather than a freestanding filter chip. */
  variant?: 'chip' | 'segment';
}) {
  const segment = variant === 'segment';
  return (
    <Pressable
      onPress={onPress}
      style={[segment ? styles.segment : styles.pill, active ? (segment ? styles.segmentActive : styles.pillActive) : null]}
    >
      <Text style={[segment ? styles.segmentLabel : styles.pillLabel, active ? (segment ? styles.segmentLabelActive : styles.pillLabelActive) : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function XGlyph({ tone }: { tone: string }) {
  return (
    <View style={styles.xGlyph}>
      <View style={[styles.xGlyphBar, { backgroundColor: tone, transform: [{ rotate: '45deg' }] }]} />
      <View style={[styles.xGlyphBar, { backgroundColor: tone, transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

function AddDashedButton({ label, onPress, prominent = false }: { label: string; onPress: () => void; prominent?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.addDashed, prominent ? styles.addDashedProminent : null]}>
      <Text style={[styles.addDashedLabel, prominent ? styles.addDashedLabelProminent : null]}>+ {label}</Text>
    </Pressable>
  );
}

type ActionVariant = 'primary' | 'outline' | 'danger' | 'text';

function ActionButton({
  label,
  onPress,
  variant = 'outline',
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: ActionVariant;
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
            : variant === 'text' ? 'transparent'
            : color.surface,
          borderColor:
            variant === 'danger' ? color.dangerBorder
            : variant === 'outline' ? color.border
            : variant === 'text' ? 'transparent'
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
              : variant === 'danger' ? color.danger
              : variant === 'text' ? color.inkMuted
              : color.ink,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CheckGlyph() {
  return <View style={styles.checkGlyph} />;
}

function ChevronGlyph({ open }: { open: boolean }) {
  return <View style={[styles.chevronGlyph, open ? styles.chevronGlyphOpen : null]} />;
}

function AckCheckbox({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onToggle} style={styles.ackRow}>
      <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>{checked && <CheckGlyph />}</View>
      <Text style={styles.ackText}>{children}</Text>
    </Pressable>
  );
}

function VerifiedTierTag({ tier }: { tier: TrustTier | null }) {
  return (
    <View style={styles.verifiedTag}>
      <Text style={styles.verifiedTagLabel}>Verified · {tier === null ? 'Unrated' : `Tier ${tier}`}</Text>
    </View>
  );
}

function FactBlock({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <SectionLabel>{label}</SectionLabel>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

/* ─── Sidebar: what you are pricing ─────────────────── */

function BuyerIdentityRow({ buyer, onOpenBuyer }: { buyer: Business; onOpenBuyer?: (businessId: BusinessId) => void }) {
  const buyerName = buyer.displayName ?? buyer.registeredName;
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={() => onOpenBuyer?.(buyer.id)}
      {...(Platform.OS === 'web' ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } : null)}
      style={[styles.sidebarBuyerRow, buyerRowHoverTransitionOnWeb, hovered ? styles.sidebarBuyerRowHovered : null]}
    >
      <AvatarChip label={initials(buyerName)} size={32} />
      <Text style={[styles.sidebarBuyerName, hovered ? styles.sidebarBuyerNameHovered : null]}>{buyerName}</Text>
      <VerifiedTierTag tier={buyer.credibility.tier} />
    </Pressable>
  );
}

function AttachmentLink({ attachment }: { attachment: Attachment }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={() => Linking.openURL(attachment.uri)}
      {...(Platform.OS === 'web' ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } : null)}
      style={buyerRowHoverTransitionOnWeb}
      hitSlop={4}
    >
      <Text style={[styles.sidebarFileLink, hovered ? styles.sidebarFileLinkHovered : null]} numberOfLines={1}>
        {attachment.filename}
      </Text>
    </Pressable>
  );
}

function ScopeSidebarCard({
  requirement,
  buyer,
  onOpenBuyer,
}: {
  requirement: Requirement;
  buyer: Business;
  onOpenBuyer?: (businessId: BusinessId) => void;
}) {
  const [showSpec, setShowSpec] = useState(false);
  const [showScope, setShowScope] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  return (
    <View style={styles.sidebarCard}>
      <SectionLabel>What you are pricing</SectionLabel>
      <Text style={styles.sidebarTitle}>{requirement.title}</Text>

      <BuyerIdentityRow buyer={buyer} onOpenBuyer={onOpenBuyer} />

      <View style={styles.sidebarFacts}>
        <FactBlock label="Indicative budget" value={formatBudget(requirement.budgetMin, requirement.budgetMax)} />
        <FactBlock label="Needed by" value={requirement.deliveryWindow} />
        <FactBlock label="Location" value={requirement.deliverySite.address} />
      </View>

      <View style={styles.sidebarDivided}>
        <SectionLabel>Scope</SectionLabel>
        <Text style={styles.sidebarScopeText} numberOfLines={showScope ? undefined : 2}>{requirement.scope}</Text>
        <Pressable onPress={() => setShowScope((v) => !v)} hitSlop={4}>
          <Text style={styles.sidebarMoreLink}>{showScope ? 'Less' : 'More'}</Text>
        </Pressable>
      </View>

      <View style={styles.sidebarDivided}>
        <Pressable onPress={() => setShowSpec((v) => !v)} style={styles.specDisclosureRow} hitSlop={4}>
          <SectionLabel>Specification</SectionLabel>
          <ChevronGlyph open={showSpec} />
        </Pressable>
        {showSpec && (
          <View style={styles.specTable}>
            {requirement.specifications.map((row, i) => (
              <View key={row.label} style={[styles.specRow, i % 2 === 1 ? styles.specRowAlt : null]}>
                <Text style={styles.specKey}>{row.label}</Text>
                <Text style={styles.specValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {requirement.attachments.length > 0 && (
        <View style={styles.sidebarDivided}>
          <Pressable onPress={() => setShowAttachments((v) => !v)} style={styles.specDisclosureRow} hitSlop={4}>
            <SectionLabel>Buyer attachments</SectionLabel>
            <ChevronGlyph open={showAttachments} />
          </Pressable>
          {showAttachments && (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              {requirement.attachments.map((a) => (
                <AttachmentLink key={a.id} attachment={a} />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/* ─── FORM: local draft state ───────────────────────── */

type PriceMode = 'LINES' | 'TOTAL';
interface LineItemDraft {
  id: string;
  desc: string;
  qty: string;
  unit: string;
}

const VALIDITY_OPTIONS = [15, 30, 60, 90];
const PAYMENT_TERM_OPTIONS = ['50 / 50', '30 / 60 / 10', '20 / 70 / 10', '100% on completion'];

/** Web: an actual picked Blob, stashed here keyed by the Attachment id it generated, so
 *  app/submit-quotation.tsx can find the real bytes to upload after the quotation is
 *  sealed (it needs a real quotation id first, so publishing and uploading are two
 *  separate steps — same reasoning as PostRequirement.tsx's pickedRequirementFiles).
 *  Native builds fall back to placeholder metadata further down. */
export const pickedQuotationFiles = new Map<string, File>();

function useQuotationForm(requirement: Requirement, onSubmit?: (input: QuotationDraftInput) => void) {
  const [priceMode, setPriceMode] = useState<PriceMode>('LINES');
  const [items, setItems] = useState<LineItemDraft[]>([]);
  const [totalOnly, setTotalOnly] = useState('');
  const [lead, setLead] = useState('6');
  const [validity, setValidity] = useState(30);
  const [term, setTerm] = useState(PAYMENT_TERM_OPTIONS[1]);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);

  const total =
    priceMode === 'LINES' ? items.reduce((a, i) => a + num(i.qty) * num(i.unit), 0) : num(totalOnly);

  const hasBudget = requirement.budgetMin !== null || requirement.budgetMax !== null;
  const overBudget = requirement.budgetMax !== null && total > requirement.budgetMax;
  const budgetNote =
    total === 0
      ? 'Enter your price to continue.'
      : !hasBudget
      ? ''
      : overBudget
      ? `Above the buyer's indicative range of ${formatBudget(requirement.budgetMin, requirement.budgetMax)}.`
      : `Within the buyer's indicative range of ${formatBudget(requirement.budgetMin, requirement.budgetMax)}.`;

  const patchItem = (id: string, key: 'desc' | 'qty' | 'unit', val: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [key]: val } : i)));
  const addItem = () => setItems((prev) => [...prev, { id: `l${Date.now()}`, desc: '', qty: '1', unit: '0' }]);
  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  const addFile = async (documentLabel: string | null = null) => {
    if (isWebFilePickerSupported()) {
      const picked = await pickWebFile('.pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/*');
      if (!picked) return; // dialog closed without picking — do nothing, same as before
      const id = `att-${Date.now()}`;
      pickedQuotationFiles.set(id, picked);
      setFiles((prev) => [
        // A required-document slot holds at most one file — picking a
        // replacement drops whatever was there before for that label.
        ...prev.filter((f) => !(documentLabel && f.documentLabel === documentLabel)),
        { id, filename: picked.name, sizeBytes: picked.size, mimeType: picked.type, uri: '', documentLabel },
      ]);
      return;
    }

    // Native fallback — placeholder metadata only, no real bytes. Same escape hatch as
    // PostRequirement.tsx's addFile; a native file picker is a separate follow-up.
    setFiles((prev) => [
      ...prev.filter((f) => !(documentLabel && f.documentLabel === documentLabel)),
      { id: `f${Date.now()}`, filename: 'New attachment.pdf', sizeBytes: 640_000, mimeType: 'application/pdf', uri: '', documentLabel },
    ]);
  };
  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    pickedQuotationFiles.delete(id);
  };

  const validUntilDate = new Date(Date.now() + validity * 86_400_000).toISOString();
  const ready = ack1 && ack2 && total > 0;

  const handleSeal = () => {
    if (!ready) return;
    onSubmit?.({
      totalPrice: total,
      lineItems:
        priceMode === 'LINES'
          ? items
              .filter((i) => i.desc.trim() && num(i.qty) > 0)
              .map((i) => ({ description: i.desc.trim(), quantity: num(i.qty), unitPrice: num(i.unit) }))
          : [],
      leadTimeDays: Math.round(num(lead) * 7),
      paymentTerms: term,
      validityDays: validity,
      notesToBuyer: note,
      attachments: files,
    });
  };

  return {
    priceMode, setPriceMode,
    items, patchItem, addItem, removeItem,
    totalOnly, setTotalOnly,
    lead, setLead,
    validity, setValidity,
    term, setTerm,
    note, setNote,
    files, addFile, removeFile,
    ack1, setAck1, ack2, setAck2,
    total, budgetNote,
    validUntilDate,
    ready,
    handleSeal,
  };
}

type FormState = ReturnType<typeof useQuotationForm>;

/* ─── FORM: sections ────────────────────────────────── */

function Breadcrumb({ requirement, onBack }: { requirement: Requirement; onBack?: () => void }) {
  return (
    <View style={styles.breadcrumbRow}>
      <Pressable onPress={onBack} hitSlop={6}>
        <Text style={styles.breadcrumbLink}>Business Opportunities</Text>
      </Pressable>
      <Text style={styles.breadcrumbSep}>/</Text>
      <Text style={styles.breadcrumbLink}>{requirement.ref}</Text>
      <Text style={styles.breadcrumbSep}>/</Text>
      <Text style={styles.breadcrumbCurrent}>Submit quotation</Text>
    </View>
  );
}

function TitleBlock({ requirement, buyer }: { requirement: Requirement; buyer: Business }) {
  const buyerName = buyer.displayName ?? buyer.registeredName;
  return (
    <View style={{ marginTop: space.md, gap: space.xs }}>
      <Text style={styles.pageTitle}>Your quotation for {requirement.title}</Text>
      <Text style={styles.pageSubtitle}>{buyerName} · {buyer.city}, {buyer.province}</Text>
    </View>
  );
}

function ClosingBanner({ requirement }: { requirement: Requirement }) {
  const { label, closed, urgent } = useCountdown(requirement.closingAt);
  return (
    <View style={styles.closingBanner}>
      <View style={[styles.closingDot, { backgroundColor: urgent ? color.danger : color.ink }]} />
      <Text style={[styles.closingCountdown, urgent ? styles.closingCountdownUrgent : null]}>
        {closed ? 'Closed' : `Closes in ${label}`}
      </Text>
      <Text style={styles.closingNoteText}>
        · Closes {formatDateTime(requirement.closingAt)} · Stays private until then — buyer and other businesses
        can't see it; withdraw and resend any time before closing.
      </Text>
    </View>
  );
}

function PriceSection({ requirement, st }: { requirement: Requirement; st: FormState }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <StepLabel n="01" label="Your price" />
        <View style={{ flex: 1 }} />
        <View style={styles.segmentGroup}>
          <Pill label="Line items" active={st.priceMode === 'LINES'} onPress={() => st.setPriceMode('LINES')} variant="segment" />
          <Pill label="Total price only" active={st.priceMode === 'TOTAL'} onPress={() => st.setPriceMode('TOTAL')} variant="segment" />
        </View>
      </View>

      {st.priceMode === 'LINES' ? (
        <View style={styles.lineItemsBox}>
          {st.items.length === 0 ? (
            <View style={styles.lineItemEmptyRow}>
              <Text style={styles.lineItemEmptyText}>No line items yet</Text>
              <AddDashedButton label="Add line item" onPress={st.addItem} prominent />
            </View>
          ) : (
            <>
              <View style={styles.lineItemsHeaderRow}>
                <Text style={[styles.lineItemsHeaderLabel, { flex: 2.4 }]}>Description</Text>
                <Text style={[styles.lineItemsHeaderLabel, { flex: 0.7 }]}>Qty</Text>
                <Text style={[styles.lineItemsHeaderLabel, { flex: 1 }]}>Unit price</Text>
                <Text style={[styles.lineItemsHeaderLabel, { flex: 1, textAlign: 'right' }]}>Amount</Text>
                <View style={{ width: 28 }} />
              </View>
              {st.items.map((item) => (
                <View key={item.id} style={styles.lineItemRow}>
                  <TextInput
                    value={item.desc}
                    onChangeText={(v) => st.patchItem(item.id, 'desc', v)}
                    placeholder="Item description"
                    placeholderTextColor={color.inkFaint}
                    style={[styles.lineItemInput, { flex: 2.4 }]}
                  />
                  <TextInput
                    value={item.qty}
                    onChangeText={(v) => st.patchItem(item.id, 'qty', sanitizeNumeric(v))}
                    placeholder="1"
                    placeholderTextColor={color.inkFaint}
                    keyboardType="decimal-pad"
                    style={[styles.lineItemInput, styles.mono, { flex: 0.7 }]}
                  />
                  <TextInput
                    value={item.unit}
                    onChangeText={(v) => st.patchItem(item.id, 'unit', sanitizeNumeric(v))}
                    placeholder="0"
                    placeholderTextColor={color.inkFaint}
                    keyboardType="decimal-pad"
                    style={[styles.lineItemInput, styles.mono, { flex: 1 }]}
                  />
                  <Text style={[styles.lineItemAmount, { flex: 1 }]}>{formatPHP(num(item.qty) * num(item.unit))}</Text>
                  <Pressable onPress={() => st.removeItem(item.id)} style={styles.lineItemRemove} hitSlop={8}>
                    <XGlyph tone={color.inkFaint} />
                  </Pressable>
                </View>
              ))}
              <View style={{ marginTop: space.sm, marginHorizontal: space.sm, marginBottom: space.sm }}>
                <AddDashedButton label="Add line item" onPress={st.addItem} prominent />
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={styles.totalOnlyBox}>
          <SectionLabel>Total price, all-in</SectionLabel>
          <View style={styles.totalOnlyField}>
            <Text style={styles.totalOnlyCurrency}>₱</Text>
            <TextInput
              value={st.totalOnly}
              onChangeText={(v) => st.setTotalOnly(sanitizeNumeric(v))}
              placeholder="0"
              placeholderTextColor={color.inkFaint}
              keyboardType="decimal-pad"
              style={styles.totalOnlyInput}
            />
          </View>
        </View>
      )}

      <View style={styles.grandTotalRow}>
        <SectionLabel>Quotation total</SectionLabel>
        <Text style={styles.grandTotalValue}>{formatPHP(st.total)}</Text>
      </View>
      {!!st.budgetNote && <Text style={styles.budgetNote}>{st.budgetNote}</Text>}
    </View>
  );
}

function TermsSection({ requirement, st }: { requirement: Requirement; st: FormState }) {
  return (
    <View style={styles.card}>
      <StepLabel n="02" label="Terms" />

      <View style={styles.termsGrid}>
        <View style={styles.termsGridItem}>
          <Text style={styles.fieldLabel}>How long will the work take?</Text>
          <Text style={styles.fieldCaption}>Counted from the day you're awarded, not from today.</Text>
          <View style={styles.leadField}>
            <TextInput
              value={st.lead}
              onChangeText={(v) => st.setLead(sanitizeNumeric(v))}
              placeholder="6"
              placeholderTextColor={color.inkFaint}
              keyboardType="decimal-pad"
              style={styles.leadInput}
            />
            <Text style={styles.leadUnit}>weeks</Text>
          </View>
          <Text style={styles.fieldNote}>Buyer needs delivery {requirement.deliveryWindow}.</Text>
        </View>

        <View style={styles.termsGridItem}>
          <Text style={styles.fieldLabel}>How long is this price good for?</Text>
          <Text style={styles.fieldCaption}>After that, the buyer would need to ask you for a new price.</Text>
          <View style={styles.pillGroupWrap}>
            {VALIDITY_OPTIONS.map((v) => (
              <Pill key={v} label={`${v} days`} active={st.validity === v} onPress={() => st.setValidity(v)} />
            ))}
          </View>
          <Text style={styles.fieldNote}>This price holds until {formatDate(st.validUntilDate)}.</Text>
        </View>
      </View>

      <View style={styles.dividedTop}>
        <Text style={styles.fieldLabel}>Payment terms</Text>
        <Text style={styles.fieldCaption}>Settled directly with the buyer — Trustlink does not process payment.</Text>
        <View style={styles.pillGroupWrap}>
          {PAYMENT_TERM_OPTIONS.map((t) => (
            <Pill key={t} label={t} active={st.term === t} onPress={() => st.setTerm(t)} />
          ))}
        </View>
      </View>
    </View>
  );
}

function RequiredDocumentsSection({ requirement, st }: { requirement: Requirement; st: FormState }) {
  if (requirement.requiredDocuments.length === 0) return null;
  const attachedCount = requirement.requiredDocuments.filter((label) =>
    st.files.some((f) => f.documentLabel === label),
  ).length;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <SectionLabel>Required documents</SectionLabel>
        <View style={{ flex: 1 }} />
        <Text style={styles.mutedSmall}>{attachedCount} of {requirement.requiredDocuments.length} attached</Text>
      </View>
      <Text style={styles.fieldCaption}>
        The buyer asked for these to be attached to your quotation. Not a hard block on submitting — but a
        missing one may put you at a disadvantage once quotations are compared.
      </Text>
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        {requirement.requiredDocuments.map((label) => {
          const file = st.files.find((f) => f.documentLabel === label);
          return (
            <View key={label} style={styles.requiredDocRow}>
              <Text style={styles.requiredDocLabel} numberOfLines={1}>{label}</Text>
              {file ? (
                <View style={styles.fileChip}>
                  <Text style={styles.fileChipName} numberOfLines={1}>{file.filename}</Text>
                  <Pressable onPress={() => st.removeFile(file.id)} hitSlop={8}>
                    <XGlyph tone={color.inkFaint} />
                  </Pressable>
                </View>
              ) : (
                <AddDashedButton label="Attach" onPress={() => st.addFile(label)} />
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function NotesAttachmentsSection({ st, isWide }: { st: FormState; isWide: boolean }) {
  const notes = (
    <>
      <Text style={styles.fieldLabel}>Notes to the buyer</Text>
      <Text style={styles.fieldCaption}>
        Inclusions, exclusions, assumptions, or anything that explains your price. Read only after closing.
      </Text>
      <TextInput
        value={st.note}
        onChangeText={st.setNote}
        multiline
        numberOfLines={3}
        placeholder="e.g. Shop fabrication at our Cabuyao plant, erection sequenced in two phases so the east racking bay stays live."
        placeholderTextColor={color.inkFaint}
        style={styles.noteInput}
      />
      <Text style={styles.noteCount}>{st.note.length} characters</Text>
    </>
  );

  const attachments = (
    <>
      <Text style={styles.fieldLabel}>Attachments</Text>
      <Text style={styles.fieldCaption}>
        Method statements, bills of quantities, certificates, past work. Sealed with the rest of your quotation.
      </Text>
      <View style={styles.filesRow}>
        {st.files.map((f) => (
          <View key={f.id} style={styles.fileChip}>
            <Text style={styles.fileChipName} numberOfLines={1}>{f.filename}</Text>
            <Pressable onPress={() => st.removeFile(f.id)} hitSlop={8}>
              <XGlyph tone={color.inkFaint} />
            </Pressable>
          </View>
        ))}
        <AddDashedButton label="Add file" onPress={() => st.addFile()} />
      </View>
    </>
  );

  return (
    <View style={styles.card}>
      <StepLabel n="03" label="Notes and attachments" />

      {isWide ? (
        <View style={styles.notesAttachmentsRow}>
          <View style={styles.notesAttachmentsCol}>{notes}</View>
          <View style={styles.notesAttachmentsDivider} />
          <View style={styles.notesAttachmentsCol}>{attachments}</View>
        </View>
      ) : (
        <>
          <View>{notes}</View>
          <View style={styles.dividedTop}>{attachments}</View>
        </>
      )}
    </View>
  );
}

function SealSection({
  requirement,
  st,
  onSaveDraft,
}: {
  requirement: Requirement;
  st: FormState;
  onSaveDraft?: () => void;
}) {
  return (
    <View style={[styles.card, styles.sealCard, { borderColor: st.ready ? color.primaryBorder : color.border }]}>
      <StepLabel n="04" label="Seal and submit" primary />
      <Text style={styles.sealHeading}>This is a commitment, not a saved draft.</Text>

      <View style={{ gap: space.sm, marginTop: space.sm }}>
        <AckCheckbox checked={st.ack1} onToggle={() => st.setAck1((v) => !v)}>
          Sealed from the buyer, other bidders, and Trustlink staff until{' '}
          <Text style={styles.ackBold}>{formatDateTime(requirement.closingAt)}</Text>, when all quotations open.
        </AckCheckbox>
        <AckCheckbox checked={st.ack2} onToggle={() => st.setAck2((v) => !v)}>
          Withdraw anytime before closing — it's recorded. After closing, no withdrawing, changing, or new prices.
        </AckCheckbox>
      </View>

      <View style={styles.sealFooterRow}>
        <ActionButton label="Save draft" variant="outline" onPress={onSaveDraft} />
        <View style={{ flex: 1, minWidth: 8 }} />
        <Text style={styles.sealHint}>
          {st.ready ? 'Your quotation seals immediately.' : 'Confirm both statements above to submit.'}
        </Text>
        <ActionButton label="Seal and submit" variant="primary" disabled={!st.ready} onPress={st.handleSeal} />
      </View>
    </View>
  );
}

/* ─── FORM: layout ──────────────────────────────────── */

const stickyOnWeb: ViewStyle =
  Platform.OS === 'web' ? ({ position: 'sticky', top: space.xxl } as unknown as ViewStyle) : {};

/** Native has no hover state to transition, so this is a no-op there — same escape hatch
 *  as stickyOnWeb above. */
const buyerRowHoverTransitionOnWeb: ViewStyle =
  Platform.OS === 'web'
    ? ({ transitionProperty: 'background-color', transitionDuration: '150ms', transitionTimingFunction: 'ease-out' } as unknown as ViewStyle)
    : {};

function FormScreen(props: FormProps) {
  const { requirement, buyer } = props;
  const st = useQuotationForm(requirement, props.onSubmit);
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;

  const sections = (
    <>
      <ClosingBanner requirement={requirement} />
      <PriceSection requirement={requirement} st={st} />
      <TermsSection requirement={requirement} st={st} />
      <RequiredDocumentsSection requirement={requirement} st={st} />
      <NotesAttachmentsSection st={st} isWide={isWide} />
      <SealSection requirement={requirement} st={st} onSaveDraft={props.onSaveDraft} />
    </>
  );

  if (!isWide) {
    return (
      <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
        <View style={styles.page}>
          <Breadcrumb requirement={requirement} onBack={props.onBack} />
          <TitleBlock requirement={requirement} buyer={buyer} />
          <ScopeSidebarCard requirement={requirement} buyer={buyer} onOpenBuyer={props.onOpenBuyer} />
          <View style={{ gap: space.lg }}>{sections}</View>
        </View>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={styles.pageWide}>
        <Breadcrumb requirement={requirement} onBack={props.onBack} />
        <TitleBlock requirement={requirement} buyer={buyer} />
        <View style={styles.columnsWide}>
          <View style={styles.mainColumn}>{sections}</View>
          <View style={[styles.sideColumn, stickyOnWeb]}>
            <ScopeSidebarCard requirement={requirement} buyer={buyer} onOpenBuyer={props.onOpenBuyer} />
          </View>
        </View>
      </View>
    </ScreenScroll>
  );
}

/* ─── SEALED_RECEIPT ────────────────────────────────── */

function LockGlyph() {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody} />
    </View>
  );
}

function ReceiptHero({ requirement, buyer }: { requirement: Requirement; buyer: Business }) {
  const buyerName = buyer.displayName ?? buyer.registeredName;
  return (
    <View style={styles.receiptHero}>
      <View style={styles.receiptIconCircle}>
        <LockGlyph />
      </View>
      <View style={styles.sealedPill}>
        <Text style={styles.sealedPillLabel}>Submitted · sealed</Text>
      </View>
      <Text style={styles.receiptTitle}>Your quotation is locked away until closing</Text>
      <Text style={styles.receiptSubtitle}>
        {buyerName} cannot see your price. Neither can any other business quoting for this job. Everything opens
        together on <Text style={styles.receiptSubtitleBold}>{formatDateTime(requirement.closingAt)}</Text>.
      </Text>
    </View>
  );
}

function ReceiptCard({
  requirement,
  quotation,
  ledgerEntry,
}: {
  requirement: Requirement;
  quotation: Quotation;
  ledgerEntry: LedgerEntry;
}) {
  const { label: opensIn } = useCountdown(requirement.closingAt);
  const attachmentCount = quotation.attachments.length;
  const summary = `${Math.round(quotation.leadTimeDays / 7)} week${Math.round(quotation.leadTimeDays / 7) === 1 ? '' : 's'} lead time · ${quotation.paymentTerms} payment terms · valid ${quotation.validityDays} days · ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`;

  return (
    <View style={styles.card}>
      <SectionLabel>Your receipt</SectionLabel>

      <View style={styles.receiptGrid}>
        <View style={styles.receiptGridItem}>
          <SectionLabel>Quotation reference</SectionLabel>
          <Text style={styles.receiptMonoValue}>{quotation.ref}</Text>
          <Text style={styles.fieldNote}>Quote this in any conversation with the buyer.</Text>
        </View>
        <View style={styles.receiptGridItem}>
          <SectionLabel>Submitted</SectionLabel>
          <Text style={styles.receiptMonoValue}>{formatDateTimeExact(quotation.submittedAt)}</Text>
          <Text style={styles.fieldNote}>The exact second your quotation was recorded.</Text>
        </View>
        <View style={styles.receiptGridItem}>
          <SectionLabel>Sealed until</SectionLabel>
          <Text style={styles.receiptMonoValue}>{formatDateTime(requirement.closingAt)}</Text>
          <Text style={styles.fieldNote}>Opens in {opensIn}.</Text>
        </View>
      </View>

      <View style={[styles.receiptGrid, styles.dividedTop]}>
        <View style={styles.receiptGridItem}>
          <SectionLabel>Record number</SectionLabel>
          <Text style={styles.receiptMonoValueSmall}>#{withCommas(ledgerEntry.sequence)}</Text>
        </View>
        <View style={[styles.receiptGridItem, { flexGrow: 2 }]}>
          <SectionLabel>Fingerprint</SectionLabel>
          <Text style={styles.receiptMonoValueSmall}>{quotation.hashTruncated}</Text>
        </View>
      </View>

      <View style={[styles.grandTotalRow, styles.dividedTop]}>
        <SectionLabel>What you submitted</SectionLabel>
        <Text style={styles.grandTotalValue}>{formatPHP(quotation.totalPrice)}</Text>
      </View>
      <Text style={styles.mutedSmall}>{summary}</Text>
    </View>
  );
}

const SAFETY_POINTS = [
  {
    title: 'Nobody can open it early',
    body: 'Your quotation is locked the moment you submit it. The buyer cannot peek at your price and quietly tell a competitor to come in lower — because the buyer cannot see it either. Every quotation on this requirement opens at the same second.',
  },
  {
    title: 'Nobody can change it — including us',
    body: 'When you submitted, Trustlink took a fingerprint of your quotation and wrote it into a permanent record that cannot be edited or erased. At closing your quotation is checked against that fingerprint. If a single figure had been altered, it would open with a warning attached, visible to the buyer.',
  },
  {
    title: 'You can still change your mind, until closing',
    body: 'Withdraw and submit a new price any time before closing. The withdrawal is written into the record too — the buyer will see that you revised, though never what the first price was. After closing, nothing can be changed by anyone.',
  },
];

function WhySafeCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.sealHeading}>Why your price is safe</Text>
      <View style={{ gap: space.xl, marginTop: space.sm }}>
        {SAFETY_POINTS.map((p, i) => (
          <View key={p.title} style={styles.safeRow}>
            <View style={styles.safeNumberCircle}>
              <Text style={styles.safeNumberText}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.safeTitle}>{p.title}</Text>
              <Text style={styles.safeBody}>{p.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

interface TimelineStep {
  title: string;
  when: string;
  body: string;
  done: boolean;
}

function buildTimeline(requirement: Requirement, quotation: Quotation): TimelineStep[] {
  return [
    {
      title: 'Quotation sealed',
      when: formatDateTime(quotation.submittedAt),
      done: true,
      body: 'Recorded and locked. You will find it under My Quotations, marked Sealed.',
    },
    {
      title: 'Quotations open',
      when: formatDateTime(requirement.closingAt),
      done: false,
      body: 'Every quotation on this requirement opens at once. Yours goes to the buyer with its fingerprint checked. We will alert you.',
    },
    {
      title: 'Buyer reviews',
      when: 'After closing',
      done: false,
      body: 'The buyer compares price, lead time, terms, and trust tier. You may be shortlisted — you will be alerted either way.',
    },
    {
      title: 'Award',
      when: "Buyer's decision",
      done: false,
      body: 'If you win, contact details are exchanged and you deal with the buyer directly. Trustlink does not handle payment or contracts.',
    },
  ];
}

function TimelineCard({ requirement, quotation }: { requirement: Requirement; quotation: Quotation }) {
  const steps = buildTimeline(requirement, quotation);
  return (
    <View style={styles.card}>
      <SectionLabel>What happens next</SectionLabel>
      <View style={{ marginTop: space.sm }}>
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <View key={s.title} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <View style={[styles.timelineDot, s.done ? styles.timelineDotDone : null]} />
                {!last && <View style={styles.timelineLine} />}
              </View>
              <View style={[styles.timelineContent, !last ? { paddingBottom: space.xl } : null]}>
                <View style={styles.timelineHeaderRow}>
                  <Text style={[styles.timelineTitle, s.done ? styles.timelineTitleDone : null]}>{s.title}</Text>
                  <Text style={styles.timelineWhen}>{s.when}</Text>
                </View>
                <Text style={styles.timelineBody}>{s.body}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ReceiptActions({
  onTrack,
  onBack,
  onWithdraw,
  canWithdraw,
}: {
  onTrack?: () => void;
  onBack?: () => void;
  onWithdraw?: () => void;
  canWithdraw: boolean;
}) {
  return (
    <View>
      <View style={styles.receiptActionsRow}>
        <ActionButton label="Track in My Quotations" variant="primary" onPress={onTrack} />
        <ActionButton label="Back to opportunities" variant="outline" onPress={onBack} />
        <View style={{ flex: 1, minWidth: 8 }} />
        {canWithdraw && <ActionButton label="Withdraw quotation" variant="danger" onPress={onWithdraw} />}
      </View>
      <Text style={styles.withdrawCaption}>
        Withdrawing removes your quotation from this requirement. The record of it stays, and you may submit a new
        price until closing.
      </Text>
    </View>
  );
}

function ReceiptScreen(props: SealedReceiptProps) {
  const { requirement, buyer, quotation, ledgerEntry } = props;
  const canWithdraw = quotation.status === 'SUBMITTED';
  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={styles.receiptPage}>
        <ReceiptHero requirement={requirement} buyer={buyer} />
        <ReceiptCard requirement={requirement} quotation={quotation} ledgerEntry={ledgerEntry} />
        <WhySafeCard />
        <TimelineCard requirement={requirement} quotation={quotation} />
        <ReceiptActions onTrack={props.onTrack} onBack={props.onBack} onWithdraw={props.onWithdraw} canWithdraw={canWithdraw} />
      </View>
    </ScreenScroll>
  );
}

/* ─── Root component ────────────────────────────────── */

export default function QuotationSubmission(props: QuotationSubmissionProps) {
  if (props.state === 'SEALED_RECEIPT') {
    return <ReceiptScreen {...props} />;
  }
  return <FormScreen {...props} />;
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg },

  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding, gap: space.md },
  pageWide: { width: '100%', maxWidth: layout.maxWidthDashboard, paddingHorizontal: layout.screenPadding, gap: space.md },
  receiptPage: { width: '100%', maxWidth: RECEIPT_MAX_WIDTH, paddingHorizontal: layout.screenPadding, gap: space.lg },

  columnsWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xl },
  mainColumn: { flex: 3, gap: space.md },
  sideColumn: { flex: 1, minWidth: layout.sideColumnMinWidth, gap: space.md },

  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  pageTitle: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  pageSubtitle: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  card: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg, gap: space.sm },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },

  sectionLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.micro,
    lineHeight: lineHeight.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkFaint,
  },
  stepLabel: {
    fontFamily: font.monoMedium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.ink,
  },
  stepLabelPrimary: { color: color.primary },

  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  mono: { fontFamily: font.monoMedium },

  /* pills */
  pill: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.sm },
  pillActive: { backgroundColor: color.primaryFaint, borderColor: color.primary },
  pillLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  pillLabelActive: { color: color.primary },
  pillGroupWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },

  /* segmented mode choice (e.g. Line items / Total price only) — one grouped control,
   *  visually distinct from the freestanding filter chips above */
  segmentGroup: { flexDirection: 'row', backgroundColor: color.surfaceSunken, borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, padding: 2 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill },
  segmentActive: { backgroundColor: color.primary },
  segmentLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  segmentLabelActive: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.onPrimary },

  /* closing banner */
  closingBanner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  closingDot: { width: 7, height: 7, borderRadius: radius.pill },
  closingCountdown: { fontFamily: font.display, fontSize: fontSize.md, letterSpacing: letterSpacing.tight, color: color.ink },
  closingCountdownUrgent: { color: color.danger },
  closingNoteText: { flex: 1, minWidth: 220, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* line items */
  lineItemsBox: { borderWidth: 1, borderColor: color.borderFaint, borderRadius: radius.lg, overflow: 'hidden' },
  lineItemsHeaderRow: { flexDirection: 'row', gap: space.md, padding: space.sm, backgroundColor: color.surfaceSunken, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  lineItemsHeaderLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  lineItemRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.xs, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  lineItemInput: { minWidth: 0, borderWidth: 1, borderColor: 'transparent', borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  lineItemAmount: { fontFamily: font.monoMedium, fontSize: fontSize.sm, textAlign: 'right', color: color.ink },
  lineItemRemove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  lineItemEmptyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap', padding: space.sm },
  lineItemEmptyText: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },

  addDashed: { alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  addDashedLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  addDashedProminent: { borderStyle: 'solid', borderColor: color.primary, backgroundColor: color.primaryFaint },
  addDashedLabelProminent: { fontFamily: font.bodySemi, color: color.primary },

  totalOnlyBox: { maxWidth: 340 },
  totalOnlyField: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm, marginTop: space.sm },
  totalOnlyCurrency: { fontFamily: font.mono, fontSize: fontSize.lg, color: color.inkFaint },
  totalOnlyInput: { flex: 1, minWidth: 0, fontFamily: font.monoMedium, fontSize: fontSize.lg, color: color.ink },

  grandTotalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md, marginTop: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: color.primaryFaint },
  grandTotalValue: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  budgetNote: { textAlign: 'right', fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  /* terms */
  termsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  termsGridItem: { flexGrow: 1, flexBasis: 230, minWidth: 230 },
  fieldLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  fieldCaption: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  fieldNote: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  leadField: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.xs },
  leadInput: { flex: 1, minWidth: 0, fontFamily: font.monoMedium, fontSize: fontSize.base, color: color.ink },
  leadUnit: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  dividedTop: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },

  /* notes and attachments */
  notesAttachmentsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  notesAttachmentsCol: { flex: 1, minWidth: 0 },
  notesAttachmentsDivider: { width: 1, alignSelf: 'stretch', backgroundColor: color.borderFaint },
  noteInput: { marginTop: space.xs, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.sm, fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.ink, textAlignVertical: 'top' },
  noteCount: { marginTop: space.xs, textAlign: 'right', fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  filesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.xs, maxWidth: 220 },
  fileChipName: { flexShrink: 1, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  requiredDocRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  requiredDocLabel: { flex: 1, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },

  /* x glyph */
  xGlyph: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  xGlyphBar: { position: 'absolute', width: 10, height: 1.4, borderRadius: 1 },

  /* seal section */
  sealCard: { borderLeftWidth: 3, borderLeftColor: color.primary },
  sealHeading: { fontFamily: font.display, fontSize: fontSize.lg, lineHeight: lineHeight.lg, letterSpacing: letterSpacing.tight, color: color.ink },
  ackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  checkbox: { width: 18, height: 18, marginTop: 2, borderWidth: 1.4, borderColor: color.border, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: color.primary, borderColor: color.primary },
  checkGlyph: { width: 9, height: 5, marginTop: -2, borderLeftWidth: 2, borderBottomWidth: 2, borderColor: color.onPrimary, transform: [{ rotate: '-45deg' }] },
  chevronGlyph: { width: 6, height: 6, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: color.inkFaint, transform: [{ rotate: '-45deg' }] },
  chevronGlyphOpen: { marginTop: -2, transform: [{ rotate: '45deg' }] },
  ackText: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  ackBold: { fontFamily: font.bodySemi, color: color.ink },
  sealFooterRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  sealHint: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, maxWidth: 220 },

  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },

  /* sidebar */
  sidebarCard: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.md, gap: space.sm },
  sidebarTitle: { fontFamily: font.display, fontSize: fontSize.md, lineHeight: lineHeight.md, letterSpacing: letterSpacing.tight, color: color.ink },
  sidebarBuyerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
    marginHorizontal: -space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.lg,
  },
  sidebarBuyerRowHovered: { backgroundColor: color.surfaceSunken },
  sidebarBuyerName: { fontFamily: font.display, fontSize: fontSize.sm, color: color.ink },
  sidebarBuyerNameHovered: { color: color.primary },
  verifiedTag: { flexDirection: 'row', alignItems: 'center' },
  verifiedTagLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
  sidebarFacts: { gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  factValue: { marginTop: space.xs, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  sidebarDivided: { paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint },
  sidebarScopeText: { marginTop: space.sm, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  sidebarMoreLink: { marginTop: space.xs, fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },
  specDisclosureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  specTable: { marginTop: space.sm, borderWidth: 1, borderColor: color.borderFaint, borderRadius: radius.lg, overflow: 'hidden' },
  specRow: { padding: space.sm, borderBottomWidth: 1, borderBottomColor: color.borderFaint },
  specRowAlt: { backgroundColor: color.surfaceSunken },
  specKey: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  specValue: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  sidebarFileLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  sidebarFileLinkHovered: { color: color.primary },

  /* receipt hero */
  receiptHero: { alignItems: 'center', gap: space.md, textAlign: 'center' } as ViewStyle,
  receiptIconCircle: { width: 66, height: 66, borderRadius: radius.pill, backgroundColor: color.primaryFaint, alignItems: 'center', justifyContent: 'center' },
  lockShackle: { width: 20, height: 14, borderWidth: 2.4, borderColor: color.primary, borderBottomWidth: 0, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  lockBody: { width: 30, height: 20, marginTop: -2, borderRadius: 5, backgroundColor: color.primary },
  sealedPill: { backgroundColor: color.ink, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  sealedPillLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.canvas },
  receiptTitle: { textAlign: 'center', fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink, maxWidth: 480 },
  receiptSubtitle: { textAlign: 'center', fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.inkMuted, maxWidth: 560 },
  receiptSubtitleBold: { fontFamily: font.bodySemi, color: color.ink },

  /* receipt card grid */
  receiptGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  receiptGridItem: { flexGrow: 1, flexBasis: 200, minWidth: 200 },
  receiptMonoValue: { marginTop: space.xs, fontFamily: font.monoMedium, fontSize: fontSize.md, color: color.ink },
  receiptMonoValueSmall: { marginTop: space.xs, fontFamily: font.monoMedium, fontSize: fontSize.base, color: color.ink },

  /* why your price is safe */
  safeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  safeNumberCircle: { width: 30, height: 30, borderRadius: radius.pill, backgroundColor: color.primaryFaint, alignItems: 'center', justifyContent: 'center' },
  safeNumberText: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.primary },
  safeTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  safeBody: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* timeline */
  timelineRow: { flexDirection: 'row', gap: space.lg },
  timelineRail: { width: 12, alignItems: 'center' },
  timelineDot: { width: 11, height: 11, borderRadius: radius.pill, borderWidth: 2, borderColor: color.border, backgroundColor: color.canvas, marginTop: space.xs },
  timelineDotDone: { backgroundColor: color.primary, borderColor: color.primary },
  timelineLine: { flex: 1, width: 1.5, backgroundColor: color.border, marginTop: space.xs },
  timelineContent: { flex: 1, minWidth: 0 },
  timelineHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  timelineTitle: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.inkMuted },
  timelineTitleDone: { fontFamily: font.bodySemi, color: color.ink },
  timelineWhen: { fontFamily: font.mono, fontSize: fontSize.sm, color: color.inkFaint },
  timelineBody: { marginTop: space.xs, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  /* receipt actions */
  receiptActionsRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  withdrawCaption: { marginTop: space.sm, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkFaint },
});
