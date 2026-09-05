// features/my-quotations/MyQuotations.tsx
// The respondent's own quotations across every requirement they have priced. No design
// exists for this screen in docs/design/ — Trustlink Flow Spec.dc.html marks "My
// quotations" (A6) as "To design", so this is built directly from its description:
// grouped by state, sealed first (the only ones still actionable), then ordered by
// closing time within each group. Withdrawn entries are never removed — they stay,
// greyed, with a link to whatever quotation replaced them.
//
// Same visual language as HomeFeed.tsx's "Your requirements" list (bordered rows, not
// raised cards) and RequirementDetail.tsx's quotation vocabulary (status labels, tones).

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import {
  color,
  font,
  fontSize,
  lineHeight,
  letterSpacing,
  space,
  radius,
  layout,
  breakpoint,
} from '../../components/ui/tokens';
import { AvatarChip, initials } from '../../components/ui/AvatarChip';
import type {
  Business,
  BusinessId,
  ISODateTime,
  Quotation,
  QuotationStatus,
  Requirement,
} from '../../lib/types';

/* ─── Props ─────────────────────────────────────────── */

export interface MyQuotationsProps {
  quotations: Quotation[];
  requirements: Record<string, Requirement>;
  buyers: Record<BusinessId, Business>;
  onBack?: () => void;
  onOpenRequirement?: (requirementId: string) => void;
  /** Sealed quotations only — the flow spec's only state where withdrawal is possible. */
  onWithdraw?: (quotationId: string) => void;
  /** Returns to the submission form, prefilled, for a withdrawn quotation whose
   *  requirement is still open. */
  onResubmit?: (requirementId: string) => void;
}

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

function withCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPHP(amount: number): string {
  return `₱${withCommas(amount)}`;
}

function timeAgoWords(iso: ISODateTime, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

function pluralUnit(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

function formatCountdownWords(days: number, hours: number, minutes: number): string {
  if (days > 0) return `${pluralUnit(days, 'day')}, ${pluralUnit(hours, 'hour')}`;
  if (hours > 0) return `${pluralUnit(hours, 'hour')}, ${pluralUnit(minutes, 'minute')}`;
  return pluralUnit(minutes, 'minute');
}

/** Pure — driven by a `now` ticked once at the top of the screen, not one interval per
 *  row (this screen can list many quotations at once). */
function releaseCountdown(closingAt: ISODateTime, now: number): { label: string; released: boolean; urgent: boolean } {
  const remainingMs = new Date(closingAt).getTime() - now;
  if (remainingMs <= 0) return { label: 'Releasing', released: true, urgent: false };
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return { label: formatCountdownWords(days, hours, minutes), released: false, urgent: remainingMs < 24 * 3600_000 };
}

function quotationStatusLabel(status: QuotationStatus): string {
  switch (status) {
    case 'SUBMITTED': return 'Sealed';
    case 'RELEASED': return 'Released';
    case 'SHORTLISTED': return 'Shortlisted';
    case 'AWARDED': return 'Awarded';
    case 'NOT_SELECTED': return 'Not selected';
    case 'WITHDRAWN': return 'Withdrawn';
  }
}

/** Palette rule (tokens.ts): navy for active/positive, grey for inactive — red is
 *  reserved for flagged/destructive, which no quotation state here is. */
function quotationStatusTone(status: QuotationStatus): 'primary' | 'neutral' {
  switch (status) {
    case 'SUBMITTED':
    case 'SHORTLISTED':
    case 'AWARDED':
      return 'primary';
    default:
      return 'neutral';
  }
}

/** Sealed first — the only ones still actionable — then the rest of the lifecycle in
 *  narrative order, withdrawn last. */
const GROUP_ORDER: QuotationStatus[] = ['SUBMITTED', 'SHORTLISTED', 'RELEASED', 'AWARDED', 'NOT_SELECTED', 'WITHDRAWN'];

/* ─── Small building blocks ─────────────────────────── */

type ActionVariant = 'primary' | 'outline' | 'danger';

function ActionButton({
  label,
  onPress,
  variant = 'outline',
}: {
  label: string;
  onPress?: () => void;
  variant?: ActionVariant;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: variant === 'primary' ? (pressed ? color.primaryPressed : color.primary) : color.surface,
          borderColor: variant === 'danger' ? color.dangerBorder : variant === 'primary' ? color.primary : color.border,
        },
      ]}
    >
      <Text
        style={[
          styles.actionButtonLabel,
          { color: variant === 'primary' ? color.onPrimary : variant === 'danger' ? color.danger : color.ink },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function MicroLabel({ children }: { children: string }) {
  return <Text style={styles.microLabel}>{children}</Text>;
}

/* ─── Row ───────────────────────────────────────────── */

function QuotationRow({
  quotation,
  requirement,
  buyer,
  now,
  replacement,
  onOpenRequirement,
  onWithdraw,
  onResubmit,
}: {
  quotation: Quotation;
  requirement: Requirement;
  buyer: Business;
  now: number;
  replacement: Quotation | null;
  onOpenRequirement?: (requirementId: string) => void;
  onWithdraw?: (quotationId: string) => void;
  onResubmit?: (requirementId: string) => void;
}) {
  const buyerName = buyer.displayName ?? buyer.registeredName;
  const sealed = quotation.status === 'SUBMITTED';
  const withdrawn = quotation.status === 'WITHDRAWN';
  const canResubmit = withdrawn && requirement.status === 'OPEN';
  const tone = quotationStatusTone(quotation.status);
  const toneColor = tone === 'primary' ? color.primary : color.inkFaint;
  const release = releaseCountdown(requirement.closingAt, now);

  const releaseLabel = sealed ? 'Releases in' : withdrawn ? 'Withdrawn' : 'Released';
  const releaseValue = sealed
    ? release.label
    : withdrawn
    ? (quotation.withdrawnAt ? timeAgoWords(quotation.withdrawnAt, now) : '—')
    : timeAgoWords(requirement.closingAt, now);

  return (
    <View style={[styles.row, withdrawn ? styles.rowWithdrawn : null]}>
      <View style={styles.rowTopLine}>
        <View style={styles.statusChip}>
          <View style={[styles.statusDot, { backgroundColor: toneColor }]} />
          <Text style={[styles.statusLabel, { color: toneColor }]}>{quotationStatusLabel(quotation.status)}</Text>
        </View>
        <Text style={styles.rowRef}>{requirement.ref}</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.rowSubmitted}>Submitted {formatDateTime(quotation.submittedAt)}</Text>
      </View>

      <Text style={[styles.rowTitle, withdrawn ? styles.mutedInk : null]} numberOfLines={2}>{requirement.title}</Text>

      <View style={styles.rowBuyerRow}>
        <AvatarChip label={initials(buyerName)} size={24} dark={!withdrawn} />
        <Text style={[styles.rowBuyerName, withdrawn ? styles.mutedInk : null]}>{buyerName}</Text>
        <Text style={styles.rowBuyerMeta}>{buyer.city}, {buyer.province}</Text>
      </View>

      <View style={styles.rowFactsRow}>
        <View style={styles.rowFact}>
          <MicroLabel>Your figure</MicroLabel>
          <Text style={[styles.rowFigure, withdrawn ? styles.mutedInk : null]}>{formatPHP(quotation.totalPrice)}</Text>
        </View>
        <View style={styles.rowFact}>
          <MicroLabel>{releaseLabel}</MicroLabel>
          <Text style={[styles.rowFactValue, release.urgent && sealed ? styles.rowFactValueUrgent : null]}>
            {releaseValue}
          </Text>
        </View>
      </View>

      {withdrawn && replacement && (
        <Pressable onPress={() => onOpenRequirement?.(requirement.id)} hitSlop={4} style={{ alignSelf: 'flex-start' }}>
          <Text style={styles.replacementLink}>Replaced by {replacement.ref} →</Text>
        </Pressable>
      )}

      <View style={styles.rowFooter}>
        <ActionButton label="Open requirement" variant="outline" onPress={() => onOpenRequirement?.(requirement.id)} />
        {sealed && <ActionButton label="Withdraw" variant="danger" onPress={() => onWithdraw?.(quotation.id)} />}
        {canResubmit && <ActionButton label="Resubmit" variant="primary" onPress={() => onResubmit?.(requirement.id)} />}
      </View>
    </View>
  );
}

/* ─── Group ─────────────────────────────────────────── */

function GroupSection({
  status,
  items,
  requirements,
  buyers,
  now,
  quotationById,
  onOpenRequirement,
  onWithdraw,
  onResubmit,
}: {
  status: QuotationStatus;
  items: Quotation[];
  requirements: Record<string, Requirement>;
  buyers: Record<BusinessId, Business>;
  now: number;
  quotationById: Map<string, Quotation>;
  onOpenRequirement?: (requirementId: string) => void;
  onWithdraw?: (quotationId: string) => void;
  onResubmit?: (requirementId: string) => void;
}) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeaderRow}>
        <Text style={styles.groupHeading}>{quotationStatusLabel(status)}</Text>
        <MicroLabel>{pluralUnit(items.length, 'quotation')}</MicroLabel>
      </View>
      <View style={{ gap: space.md }}>
        {items.map((q) => {
          const requirement = requirements[q.requirementId];
          const buyer = buyers[requirement.buyerId];
          const replacement = q.replacedByQuotationId ? quotationById.get(q.replacedByQuotationId) ?? null : null;
          return (
            <QuotationRow
              key={q.id}
              quotation={q}
              requirement={requirement}
              buyer={buyer}
              now={now}
              replacement={replacement}
              onOpenRequirement={onOpenRequirement}
              onWithdraw={onWithdraw}
              onResubmit={onResubmit}
            />
          );
        })}
      </View>
    </View>
  );
}

/* ─── Shared state hook ─────────────────────────────── */

function useMyQuotations(quotations: Quotation[], requirements: Record<string, Requirement>) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const quotationById = new Map(quotations.map((q) => [q.id, q]));
  const closingAtMs = (q: Quotation) => new Date(requirements[q.requirementId].closingAt).getTime();

  const groups = GROUP_ORDER.map((status) => ({
    status,
    items: quotations.filter((q) => q.status === status).sort((a, b) => closingAtMs(a) - closingAtMs(b)),
  })).filter((g) => g.items.length > 0);

  return { now, groups, quotationById };
}

/* ─── Root component ────────────────────────────────── */

export default function MyQuotations(props: MyQuotationsProps) {
  const { quotations, requirements, buyers, onBack, onOpenRequirement, onWithdraw, onResubmit } = props;
  const { now, groups, quotationById } = useMyQuotations(quotations, requirements);
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>My quotations</Text>
        </View>

        <View style={{ marginTop: space.md, gap: space.xs }}>
          <Text style={styles.pageTitle}>My quotations</Text>
          <Text style={styles.pageSubtitle}>
            {pluralUnit(quotations.length, 'quotation')} across every requirement you have priced.
          </Text>
        </View>

        {groups.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.mutedSmall}>You haven't submitted a quotation yet.</Text>
          </View>
        ) : (
          <View style={{ gap: space.xl, marginTop: space.lg }}>
            {groups.map((g) => (
              <GroupSection
                key={g.status}
                status={g.status}
                items={g.items}
                requirements={requirements}
                buyers={buyers}
                now={now}
                quotationById={quotationById}
                onOpenRequirement={onOpenRequirement}
                onWithdraw={onWithdraw}
                onResubmit={onResubmit}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },

  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding },
  pageWide: { width: '100%', maxWidth: layout.maxWidthWide, paddingHorizontal: layout.screenPadding },

  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  pageTitle: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  pageSubtitle: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  mutedInk: { color: color.inkMuted },

  microLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },

  emptyCard: { marginTop: space.lg, borderWidth: 1, borderColor: color.borderFaint, borderRadius: radius.xl, padding: space.xl, alignItems: 'center' },

  group: { gap: space.md },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: color.border },
  groupHeading: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },

  /* row */
  row: { borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.lg, gap: space.sm, backgroundColor: color.surface },
  rowWithdrawn: { backgroundColor: color.surfaceSunken, borderColor: color.borderFaint },

  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  statusLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },
  rowRef: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  rowSubmitted: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },

  rowTitle: { fontFamily: font.display, fontSize: fontSize.base, color: color.ink },

  rowBuyerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  rowBuyerName: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  rowBuyerMeta: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },

  rowFactsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl, marginTop: space.xs },
  rowFact: { minWidth: layout.factMinWidth, gap: space.xs },
  rowFigure: { fontFamily: font.display, fontSize: fontSize.lg, letterSpacing: letterSpacing.tight, color: color.ink },
  rowFactValue: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.ink },
  rowFactValueUrgent: { color: color.danger },

  replacementLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.primary },

  rowFooter: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', marginTop: space.xs },
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },
});
