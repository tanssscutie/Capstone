// features/saved/Saved.tsx
// Requirements the viewer bookmarked from the feed (RequirementCard's Save button,
// features/home-feed/HomeFeed.tsx) — a dedicated tracking page for them, the same
// role MyRequirements.tsx plays for "Your requirements" and MyQuotations.tsx plays
// for "My quotations". Same page shell (breadcrumb, display title, list), same
// row shape as MyRequirements' RequirementRow, plus the buyer identity a saved
// requirement needs (it isn't the viewer's own, unlike MyRequirements' rows).

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
import { AvatarChip, initials } from '../../components/ui/AvatarChip';
import type { Business, BusinessId, ISODateTime, Requirement, RequirementStatus } from '../../lib/types';

/* ─── Props ─────────────────────────────────────────── */

type FeedBuyer = Pick<Business, 'id' | 'registeredName' | 'displayName'>;

export interface SavedProps {
  requirements: Requirement[];
  buyers: Record<BusinessId, FeedBuyer>;
  onBack?: () => void;
  onOpenRequirement?: (requirementId: string) => void;
  onUnsave?: (requirementId: string) => void;
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

function requirementStatusColor(status: RequirementStatus, hoursLeft: number): string {
  if (status === 'OPEN' && hoursLeft < 24) return color.danger;
  if (status === 'OPEN' || status === 'AWARDED') return color.primary;
  return color.inkFaint;
}

function hoursUntil(closingAt: ISODateTime, now: number): number {
  return (new Date(closingAt).getTime() - now) / 3_600_000;
}

/* ─── Small building blocks ─────────────────────────── */

function MicroLabel({ children }: { children: string }) {
  return <Text style={styles.microLabel}>{children}</Text>;
}

function ActionButton({
  label,
  onPress,
  variant = 'outline',
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline';
}) {
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

function SavedRow({
  requirement,
  buyer,
  now,
  onOpenRequirement,
  onUnsave,
}: {
  requirement: Requirement;
  buyer: FeedBuyer | undefined;
  now: number;
  onOpenRequirement?: (requirementId: string) => void;
  onUnsave?: (requirementId: string) => void;
}) {
  const hoursLeft = hoursUntil(requirement.closingAt, now);
  const statusColor = requirementStatusColor(requirement.status, hoursLeft);
  const statusLabel =
    requirement.status === 'OPEN' && hoursLeft > 0 && hoursLeft < 24
      ? `Closing in ${Math.max(1, Math.ceil(hoursLeft))}h`
      : requirementStatusLabel(requirement.status);
  const buyerName = buyer ? buyer.displayName ?? buyer.registeredName : 'Unknown business';

  return (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 200, gap: space.xs }}>
        <View style={styles.rowStatusRow}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={[styles.rowStatusLabel, { color: statusColor }]}>{statusLabel}</Text>
          <Text style={styles.rowRef}>{requirement.ref}</Text>
        </View>
        <Text style={styles.rowTitle} numberOfLines={2}>{requirement.title}</Text>
        <View style={styles.rowBuyerRow}>
          <AvatarChip label={initials(buyerName)} size={22} />
          <Text style={styles.rowBuyerName}>{buyerName}</Text>
        </View>
        <Text style={styles.mutedSmall}>
          {requirement.category} · {requirement.deliverySite.address} · {formatBudget(requirement.budgetMin, requirement.budgetMax)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.rowCount}>{requirement.quotationCount}</Text>
          <MicroLabel>{pluralUnit(requirement.quotationCount, 'quotation')}</MicroLabel>
        </View>
        <ActionButton label="Open requirement" onPress={() => onOpenRequirement?.(requirement.id)} />
        <Pressable onPress={() => onUnsave?.(requirement.id)} hitSlop={8}>
          <Text style={styles.unsaveLink}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─── Root component ────────────────────────────────── */

export default function Saved(props: SavedProps) {
  const { requirements, buyers, onBack, onOpenRequirement, onUnsave } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
          <Text style={styles.breadcrumbCurrent}>Saved</Text>
        </View>

        <View style={{ marginTop: space.md, gap: space.xs }}>
          <Text style={styles.pageTitle}>Saved</Text>
          <Text style={styles.pageSubtitle}>
            {pluralUnit(requirements.length, 'requirement')} you bookmarked from the feed.
          </Text>
        </View>

        {requirements.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.mutedSmall}>Nothing saved yet — bookmark a requirement from the feed to find it here.</Text>
          </View>
        ) : (
          <View style={{ gap: space.md, marginTop: space.lg }}>
            {requirements.map((r) => (
              <SavedRow
                key={r.id}
                requirement={r}
                buyer={buyers[r.buyerId]}
                now={now}
                onOpenRequirement={onOpenRequirement}
                onUnsave={onUnsave}
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
  microLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },

  emptyCard: { marginTop: space.lg, borderWidth: 1, borderColor: color.borderFaint, borderRadius: radius.xl, padding: space.xl, alignItems: 'center' },

  row: { borderWidth: 1, borderColor: color.border, borderRadius: radius.xl, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.lg, flexWrap: 'wrap', backgroundColor: color.surface },
  rowStatusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowStatusLabel: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },
  rowRef: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  rowTitle: { fontFamily: font.display, fontSize: fontSize.base, color: color.ink },
  rowBuyerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowBuyerName: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  rowCount: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  dot: { width: 7, height: 7, borderRadius: radius.pill },

  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },
  unsaveLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.danger },
});
