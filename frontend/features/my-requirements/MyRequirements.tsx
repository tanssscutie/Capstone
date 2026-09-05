// features/my-requirements/MyRequirements.tsx
// The owner's own requirements, grouped by state — the dedicated tracking page that
// HomeFeed.tsx's "Your requirements" section has always pointed to via its "Manage all"
// link (previously a no-op). Same visual language as that section (myReqRow-style rows,
// status dot + mono label) and the same page shell as MyQuotations.tsx (breadcrumb,
// display title, grouped sections) — no new colours, no new patterns.

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
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
import type { ISODateTime, Requirement, RequirementStatus } from '../../lib/types';

/* ─── Props ─────────────────────────────────────────── */

export interface MyRequirementsProps {
  requirements: Requirement[];
  onBack?: () => void;
  onOpenRequirement?: (requirementId: string) => void;
  onPostRequirement?: () => void;
}

/* ─── Formatting helpers ────────────────────────────── */

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

function requirementStatusLabel(status: RequirementStatus): string {
  switch (status) {
    case 'DRAFT': return 'Draft';
    case 'OPEN': return 'Open';
    case 'CLOSED': return 'Closed';
    case 'AWARDED': return 'Awarded';
    case 'CLOSED_NO_AWARD': return 'Closed — No Award';
    case 'CANCELLED': return 'Cancelled';
  }
}

/** Palette rule (tokens.ts): navy for active/positive, grey for inactive — red is
 *  reserved for flagged/destructive, which no requirement state here is. */
function requirementStatusColor(status: RequirementStatus, hoursLeft: number): string {
  if (status === 'OPEN' && hoursLeft < 24) return color.danger;
  if (status === 'OPEN' || status === 'AWARDED') return color.primary;
  return color.inkFaint;
}

function hoursUntil(closingAt: ISODateTime, now: number): number {
  return (new Date(closingAt).getTime() - now) / 3_600_000;
}

/** Open first — the only state still counting down — then the rest of the lifecycle
 *  in narrative order. */
const GROUP_ORDER: RequirementStatus[] = ['OPEN', 'AWARDED', 'CLOSED_NO_AWARD', 'CLOSED', 'CANCELLED', 'DRAFT'];

/* ─── Small building blocks ─────────────────────────── */

function MicroLabel({ children }: { children: string }) {
  return <Text style={styles.microLabel}>{children}</Text>;
}

function ActionButton({ label, onPress, variant = 'outline' }: { label: string; onPress?: () => void; variant?: 'primary' | 'outline' }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: variant === 'primary' ? (pressed ? color.primaryPressed : color.primary) : color.surface,
          borderColor: variant === 'primary' ? color.primary : color.border,
        },
      ]}
    >
      <Text style={[styles.actionButtonLabel, { color: variant === 'primary' ? color.onPrimary : color.ink }]}>{label}</Text>
    </Pressable>
  );
}

/* ─── Row ───────────────────────────────────────────── */

function RequirementRow({
  requirement,
  now,
  onOpenRequirement,
}: {
  requirement: Requirement;
  now: number;
  onOpenRequirement?: (requirementId: string) => void;
}) {
  const hoursLeft = hoursUntil(requirement.closingAt, now);
  const statusColor = requirementStatusColor(requirement.status, hoursLeft);
  const statusLabel =
    requirement.status === 'OPEN' && hoursLeft > 0 && hoursLeft < 24
      ? `Closing in ${Math.max(1, Math.ceil(hoursLeft))}h`
      : requirementStatusLabel(requirement.status);
  const posted = requirement.publishedAt ? `Posted ${timeAgoWords(requirement.publishedAt, now)}` : 'Not yet published';
  const meta = `${posted} · ${requirement.category} · ${requirement.deliverySite.address} · ${formatBudget(requirement.budgetMin, requirement.budgetMax)}`;

  return (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 200, gap: space.xs }}>
        <View style={styles.rowStatusRow}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={[styles.rowStatusLabel, { color: statusColor }]}>{statusLabel}</Text>
          <Text style={styles.rowRef}>{requirement.ref}</Text>
        </View>
        <Text style={styles.rowTitle} numberOfLines={2}>{requirement.title}</Text>
        <Text style={styles.mutedSmall}>{meta}</Text>
      </View>
      <View style={styles.rowRight}>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.rowCount}>{requirement.quotationCount}</Text>
          <MicroLabel>{pluralUnit(requirement.quotationCount, 'quotation')}</MicroLabel>
        </View>
        <ActionButton label="Open requirement" onPress={() => onOpenRequirement?.(requirement.id)} />
      </View>
    </View>
  );
}

/* ─── Group ─────────────────────────────────────────── */

function GroupSection({
  status,
  items,
  now,
  onOpenRequirement,
}: {
  status: RequirementStatus;
  items: Requirement[];
  now: number;
  onOpenRequirement?: (requirementId: string) => void;
}) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeaderRow}>
        <Text style={styles.groupHeading}>{requirementStatusLabel(status)}</Text>
        <MicroLabel>{pluralUnit(items.length, 'requirement')}</MicroLabel>
      </View>
      <View style={{ gap: space.md }}>
        {items.map((r) => (
          <RequirementRow key={r.id} requirement={r} now={now} onOpenRequirement={onOpenRequirement} />
        ))}
      </View>
    </View>
  );
}

/* ─── Shared state hook ─────────────────────────────── */

function useMyRequirements(requirements: Requirement[]) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const groups = GROUP_ORDER.map((status) => ({
    status,
    items: requirements
      .filter((r) => r.status === status)
      .sort((a, b) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()),
  })).filter((g) => g.items.length > 0);

  return { now, groups };
}

/* ─── Root component ────────────────────────────────── */

export default function MyRequirements(props: MyRequirementsProps) {
  const { requirements, onBack, onOpenRequirement, onPostRequirement } = props;
  const { now, groups } = useMyRequirements(requirements);
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
          <Text style={styles.breadcrumbCurrent}>My requirements</Text>
        </View>

        <View style={styles.titleRow}>
          <View style={{ gap: space.xs, flexShrink: 1 }}>
            <Text style={styles.pageTitle}>My requirements</Text>
            <Text style={styles.pageSubtitle}>
              {pluralUnit(requirements.length, 'requirement')} you have posted on Trustlink.
            </Text>
          </View>
          <ActionButton label="Post a requirement" variant="primary" onPress={onPostRequirement} />
        </View>

        {groups.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.mutedSmall}>You haven't posted a requirement yet.</Text>
          </View>
        ) : (
          <View style={{ gap: space.xl, marginTop: space.lg }}>
            {groups.map((g) => (
              <GroupSection key={g.status} status={g.status} items={g.items} now={now} onOpenRequirement={onOpenRequirement} />
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

  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.lg, flexWrap: 'wrap', marginTop: space.md },
  pageTitle: { fontFamily: font.display, fontSize: fontSize.display, lineHeight: lineHeight.display, letterSpacing: letterSpacing.tight, color: color.ink },
  pageSubtitle: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },
  microLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },

  emptyCard: { marginTop: space.lg, borderWidth: 1, borderColor: color.borderFaint, borderRadius: radius.xl, padding: space.xl, alignItems: 'center' },

  group: { gap: space.md },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: color.border },
  groupHeading: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },

  /* row — same shape as HomeFeed's myReqRow */
  row: { borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap', backgroundColor: color.surface },
  rowStatusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowStatusLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },
  rowRef: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  rowTitle: { fontFamily: font.display, fontSize: fontSize.base, color: color.ink },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space.xl },
  rowCount: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  dot: { width: 7, height: 7, borderRadius: radius.pill },

  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },
});
