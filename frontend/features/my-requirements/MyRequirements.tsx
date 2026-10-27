// features/my-requirements/MyRequirements.tsx
// The owner's own requirements, grouped by state — the dedicated tracking page that
// HomeFeed.tsx's "Your requirements" section points to via its "Manage all" link.
// Same page shell as MyQuotations.tsx (breadcrumb, display title, grouped sections),
// on the sunken page with white cards like HomeFeed.tsx and Alerts.tsx: summary tiles
// up top, a status filter, then one clickable card per requirement.

import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
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
import type { ISODateTime, Requirement, RequirementStatus } from '../../lib/types';
import { specDisplayValue } from '../../lib/data/categories';
import ScreenScroll from '../../components/ui/ScreenScroll';

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
    case 'AWARD_PENDING': return 'Award pending';
    case 'AWARDED': return 'Awarded';
    case 'CLOSED_NO_AWARD': return 'Closed — No Award';
    case 'INSUFFICIENT_QUOTATIONS': return 'Archived — not enough quotations';
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

/** "Closes in 5h" / "Closes in 3d" — only meaningful while OPEN. */
function closesIn(hoursLeft: number): string {
  if (hoursLeft <= 0) return 'Closing now';
  if (hoursLeft < 24) return `Closes in ${Math.max(1, Math.ceil(hoursLeft))}h`;
  return `Closes in ${Math.ceil(hoursLeft / 24)}d`;
}

/** Released, but the buyer hasn't awarded or closed it in 3+ days. Computed
 *  live from releasedAt (matches RequirementDetail.tsx's DecisionReminderBanner),
 *  not a stored alert — the Alerts inbox is a fixed 11-event list that
 *  "still no decision" doesn't belong in. */
function daysWithoutDecision(r: Requirement, now: number): number | null {
  if (r.status !== 'CLOSED' || !r.releasedAt) return null;
  const days = Math.floor((now - new Date(r.releasedAt).getTime()) / 86_400_000);
  return days >= 3 ? days : null;
}

/** Open first — the only state still counting down toward closing — then
 *  award_pending — the only state counting down toward a response deadline,
 *  similarly urgent — then the rest of the lifecycle in narrative order.
 *  Missing a status here doesn't just mis-sort it: filter() below drops
 *  anything that matches no group, so it silently vanishes from the list. */
const GROUP_ORDER: RequirementStatus[] = ['OPEN', 'AWARD_PENDING', 'AWARDED', 'CLOSED_NO_AWARD', 'CLOSED', 'INSUFFICIENT_QUOTATIONS', 'CANCELLED', 'DRAFT'];

/* ─── Web-only motion helpers (same as HomeFeed.tsx) ── */

function webTransition(properties: string): ViewStyle {
  return Platform.OS === 'web'
    ? ({ transitionProperty: properties, transitionDuration: '160ms', transitionTimingFunction: 'ease-out' } as unknown as ViewStyle)
    : {};
}

function useHover() {
  const [hovered, setHovered] = useState(false);
  const handlers =
    Platform.OS === 'web' ? { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) } : {};
  return [hovered, handlers] as const;
}

const cardShadow: ViewStyle =
  Platform.OS === 'web' ? ({ boxShadow: '0 1px 2px rgba(20, 24, 31, 0.04)' } as unknown as ViewStyle) : {};
const cardShadowHovered: ViewStyle =
  Platform.OS === 'web' ? ({ boxShadow: '0 10px 24px rgba(20, 24, 31, 0.08)' } as unknown as ViewStyle) : {};

/* ─── Small building blocks ─────────────────────────── */

function MicroLabel({ children }: { children: string }) {
  return <Text style={styles.microLabel}>{children}</Text>;
}

function ActionButton({ label, onPress, variant = 'outline' }: { label: string; onPress?: () => void; variant?: 'primary' | 'outline' }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        webTransition('background-color, border-color, transform'),
        {
          backgroundColor:
            variant === 'primary' ? (pressed || hovered ? color.primaryPressed : color.primary) : hovered ? color.surfaceSunken : color.surface,
          borderColor: variant === 'primary' ? color.primary : hovered ? color.borderStrong : color.border,
        },
        pressed && styles.pressedScale,
      ]}
    >
      <Text style={[styles.actionButtonLabel, { color: variant === 'primary' ? color.onPrimary : color.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** Status as a tinted pill in the status colour. */
function StatusPill({ label, tone }: { label: string; tone: string }) {
  const tinted = tone === color.danger ? color.dangerFaint : tone === color.primary ? color.primaryFaint : color.surfaceSunken;
  return (
    <View style={[styles.statusPill, { backgroundColor: tinted }]}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={[styles.statusPillLabel, { color: tone }]}>{label}</Text>
    </View>
  );
}

function MetaChip({ children }: { children: string }) {
  return (
    <View style={styles.metaChip}>
      <Text style={styles.metaChipLabel} numberOfLines={1}>{children}</Text>
    </View>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <View style={[styles.statTile, cardShadow]}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <MicroLabel>{label}</MicroLabel>
    </View>
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
  const [hovered, hoverHandlers] = useHover();
  const hoursLeft = hoursUntil(requirement.closingAt, now);
  const statusColor = requirementStatusColor(requirement.status, hoursLeft);
  const isOpen = requirement.status === 'OPEN';
  const statusLabel = isOpen ? closesIn(hoursLeft) : requirementStatusLabel(requirement.status);
  const posted = requirement.publishedAt ? `Posted ${timeAgoWords(requirement.publishedAt, now)}` : 'Not yet published';
  const noDecisionDays = daysWithoutDecision(requirement, now);
  const open = () => onOpenRequirement?.(requirement.id);

  return (
    <Pressable
      {...hoverHandlers}
      onPress={open}
      style={[
        styles.row,
        cardShadow,
        webTransition('transform, border-color, box-shadow'),
        noDecisionDays !== null && styles.rowNeedsDecision,
        hovered && [styles.rowHovered, cardShadowHovered],
      ]}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowStatusRow}>
          <StatusPill label={statusLabel} tone={statusColor} />
          <Text style={styles.rowRef}>{requirement.ref}</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.rowPosted}>{posted}</Text>
        </View>
        <Text style={styles.rowTitle} numberOfLines={2}>{requirement.title}</Text>
        {requirement.specifications.length > 0 && (
          <Text style={styles.rowSpecs} numberOfLines={1}>
            {[requirement.quantity, ...requirement.specifications.map((s) => `${s.label}: ${specDisplayValue(s)}`)].filter(Boolean).join(' · ')}
          </Text>
        )}
        <View style={styles.metaRow}>
          <MetaChip>{requirement.itemName ? `${requirement.category} · ${requirement.itemName}` : requirement.category}</MetaChip>
          {!!requirement.deliverySite.address && <MetaChip>{requirement.deliverySite.address}</MetaChip>}
          <MetaChip>{formatBudget(requirement.budgetMin, requirement.budgetMax)}</MetaChip>
        </View>
        {noDecisionDays !== null && (
          <View style={styles.decisionBanner}>
            <View style={[styles.dot, { backgroundColor: color.danger }]} />
            <Text style={styles.decisionBannerText}>
              Released {pluralUnit(noDecisionDays, 'day')} ago — still no decision. Award a quotation or close without award.
            </Text>
          </View>
        )}
      </View>
      <View style={styles.rowRight}>
        <View style={styles.countBox}>
          <Text style={styles.rowCount}>{requirement.quotationCount}</Text>
          <MicroLabel>{requirement.quotationCount === 1 ? 'quotation' : 'quotations'}</MicroLabel>
        </View>
        <ActionButton label="Open" onPress={open} />
      </View>
    </Pressable>
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
        <View style={styles.groupCount}>
          <Text style={styles.groupCountLabel}>{items.length}</Text>
        </View>
      </View>
      <View style={{ gap: space.md }}>
        {items.map((r) => (
          <RequirementRow key={r.id} requirement={r} now={now} onOpenRequirement={onOpenRequirement} />
        ))}
      </View>
    </View>
  );
}

/* ─── Filter tabs ───────────────────────────────────── */

function FilterTab({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  const [hovered, hoverHandlers] = useHover();
  return (
    <Pressable
      {...hoverHandlers}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tab, webTransition('background-color, border-color'), hovered && !active && styles.tabHovered, active && styles.tabActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      <View style={[styles.tabCount, active && styles.tabCountActive]}>
        <Text style={[styles.tabCountLabel, active && styles.tabCountLabelActive]}>{count}</Text>
      </View>
    </Pressable>
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
  const [filter, setFilter] = useState<RequirementStatus | 'ALL'>('ALL');

  const openCount = requirements.filter((r) => r.status === 'OPEN').length;
  const awaitingCount = requirements.filter((r) => r.status === 'CLOSED' || r.status === 'AWARD_PENDING').length;
  const awardedCount = requirements.filter((r) => r.status === 'AWARDED').length;
  const quotationTotal = requirements.reduce((sum, r) => sum + r.quotationCount, 0);
  // A filter whose group emptied out (e.g. the last open one closed) falls back to All.
  const activeFilter = filter !== 'ALL' && groups.some((g) => g.status === filter) ? filter : 'ALL';
  const shownGroups = activeFilter === 'ALL' ? groups : groups.filter((g) => g.status === activeFilter);

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
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
            <View style={styles.emptyMark}>
              <Text style={styles.emptyMarkLabel}>+</Text>
            </View>
            <Text style={styles.emptyTitle}>No requirements yet</Text>
            <Text style={[styles.mutedSmall, { textAlign: 'center', maxWidth: 360 }]}>
              Post what you need — verified suppliers in your category are alerted, and their quotations stay sealed until closing.
            </Text>
            <View style={{ marginTop: space.sm }}>
              <ActionButton label="Post your first requirement" variant="primary" onPress={onPostRequirement} />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.statRow}>
              <StatTile label="Open" value={openCount} tone={openCount > 0 ? color.primary : undefined} />
              <StatTile label="Awaiting decision" value={awaitingCount} tone={awaitingCount > 0 ? color.danger : undefined} />
              <StatTile label="Awarded" value={awardedCount} />
              <StatTile label="Quotations received" value={quotationTotal} />
            </View>

            {groups.length > 1 && (
              <View style={styles.tabRow} accessibilityRole="tablist">
                <FilterTab label="All" count={requirements.length} active={activeFilter === 'ALL'} onPress={() => setFilter('ALL')} />
                {groups.map((g) => (
                  <FilterTab
                    key={g.status}
                    label={requirementStatusLabel(g.status)}
                    count={g.items.length}
                    active={activeFilter === g.status}
                    onPress={() => setFilter(g.status)}
                  />
                ))}
              </View>
            )}

            <View style={{ gap: space.xl, marginTop: space.lg }}>
              {shownGroups.map((g) => (
                <GroupSection key={g.status} status={g.status} items={g.items} now={now} onOpenRequirement={onOpenRequirement} />
              ))}
            </View>
          </>
        )}
      </View>
    </ScreenScroll>
  );
}

/* ─── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surfaceSunken },
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

  /* summary tiles — wrap to two per row on phones */
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.xl },
  statTile: { ...elevation.card, flexGrow: 1, flexBasis: 150, backgroundColor: color.surface, borderRadius: radius.xl, paddingVertical: space.lg, paddingHorizontal: space.lg, gap: space.xs },
  statValue: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },

  /* filter tabs — same as Alerts.tsx */
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  tab: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm },
  tabHovered: { borderColor: color.borderStrong },
  tabActive: { backgroundColor: color.ink, borderColor: color.ink },
  tabLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  tabLabelActive: { color: color.canvas },
  tabCount: { minWidth: 20, alignItems: 'center', borderRadius: radius.pill, backgroundColor: color.surfaceSunken, paddingHorizontal: 6, paddingVertical: 1 },
  tabCountActive: { backgroundColor: 'rgba(255, 255, 255, 0.16)' },
  tabCountLabel: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkMuted },
  tabCountLabelActive: { color: color.canvas },

  emptyCard: { ...elevation.card, marginTop: space.xl, backgroundColor: color.surface, borderRadius: radius.xl, padding: space.xxl, alignItems: 'center', gap: space.sm },
  emptyMark: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: color.primaryFaint, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  emptyMarkLabel: { fontFamily: font.display, fontSize: fontSize.xl, lineHeight: fontSize.xl + 2, color: color.primary },
  emptyTitle: { fontFamily: font.display, fontSize: fontSize.md, color: color.ink },

  group: { gap: space.md },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  groupHeading: { fontFamily: font.display, fontSize: fontSize.lg, color: color.ink },
  groupCount: { minWidth: 22, alignItems: 'center', borderRadius: radius.pill, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderFaint, paddingHorizontal: 6, paddingVertical: 1 },
  groupCountLabel: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkMuted },

  /* row */
  row: { ...elevation.card, borderRadius: radius.xl, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap', backgroundColor: color.surface },
  rowHovered: { borderColor: color.borderStrong, transform: [{ translateY: -1 }] },
  rowNeedsDecision: { borderColor: color.dangerBorder },
  rowMain: { flex: 1, minWidth: 220, gap: space.sm },
  rowStatusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  rowRef: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  rowPosted: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  rowTitle: { fontFamily: font.display, fontSize: fontSize.md, lineHeight: lineHeight.md, color: color.ink },
  rowSpecs: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  countBox: { alignItems: 'center', minWidth: 88, backgroundColor: color.surfaceSunken, borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.md },
  rowCount: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  dot: { width: 7, height: 7, borderRadius: radius.pill },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
  statusPillLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  metaChip: { maxWidth: '100%', borderWidth: 1, borderColor: color.borderFaint, backgroundColor: color.canvas, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3 },
  metaChipLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  decisionBanner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, backgroundColor: color.dangerFaint, paddingHorizontal: space.md, paddingVertical: space.sm },
  decisionBannerText: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.danger },

  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },
  pressedScale: { transform: [{ scale: 0.97 }] },
});
