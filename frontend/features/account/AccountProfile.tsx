// features/account/AccountProfile.tsx
// "My Profile" — the account dropdown's promise ("Business name, contact,
// capabilities") made real. A read-only summary of everything onboarding
// collected, plus the same credibility facts HomeFeed's ProfileCard shows,
// on its own persistent, revisitable page. Same page shell as
// VerificationStatus.tsx (breadcrumb, hero, bordered cards).

import { View, Text, ScrollView, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
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
import type { Business, BusinessType, TrustTier } from '../../lib/types';

export interface AccountProfileProps {
  viewer: Business;
  onBack?: () => void;
  onEditProfile?: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthYear(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function businessTypeLabel(type: BusinessType): string {
  switch (type) {
    case 'SOLE_PROP': return 'Sole proprietorship';
    case 'PARTNERSHIP': return 'Partnership';
    case 'CORPORATION': return 'Corporation';
    case 'COOPERATIVE': return 'Cooperative';
  }
}

function tierLabel(tier: TrustTier | null): string {
  return tier === null ? 'Unrated' : `Tier ${tier} of 3`;
}

type Tone = 'primary' | 'neutral';

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const bg = tone === 'primary' ? color.primaryFaint : color.surfaceSunken;
  const border = tone === 'primary' ? color.primary : color.border;
  const text = tone === 'primary' ? color.primary : color.inkMuted;
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.badgeLabel, { color: text }]}>{label}</Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value || '—'}</Text>
    </View>
  );
}

function TagList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <Text style={styles.mutedSmall}>{emptyLabel}</Text>;
  }
  return (
    <View style={styles.tagWrap}>
      {items.map((t) => (
        <View key={t} style={styles.tag}>
          <Text style={styles.tagLabel}>{t}</Text>
        </View>
      ))}
    </View>
  );
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

export default function AccountProfile({ viewer, onBack, onEditProfile }: AccountProfileProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const name = viewer.displayName ?? viewer.registeredName;
  const verified = viewer.credibility.status === 'VERIFIED';
  const c = viewer.credibility;

  const statRows: { label: string; value: string }[] = [
    { label: 'Requirements posted', value: String(c.requirementsPosted) },
    { label: 'Requirements awarded', value: String(c.requirementsAwarded) },
    { label: 'Quotations submitted', value: String(c.quotationsSubmitted) },
    { label: 'Member since', value: String(viewer.memberSinceYear) },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>My Profile</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <AvatarChip label={initials(name)} size={56} />
            <View style={{ minWidth: 0, flex: 1, gap: space.xs }}>
              <Text style={styles.heroName}>{name}</Text>
              <View style={styles.heroBadgeRow}>
                <StatusBadge label={verified ? 'Verified' : 'Not yet verified'} tone={verified ? 'primary' : 'neutral'} />
                <StatusBadge label={tierLabel(c.tier)} tone="neutral" />
              </View>
            </View>
          </View>
          {verified && (
            <Text style={styles.mutedSmall}>
              Verified {formatMonthYear(c.verifiedAt)}
              {c.recheckDueAt ? ` · re-check due ${formatMonthYear(c.recheckDueAt)}` : ''}
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <SectionLabel>Business details</SectionLabel>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <FactRow label="Registered name" value={viewer.registeredName} />
            <FactRow label="Business type" value={businessTypeLabel(viewer.businessType)} />
            <FactRow label="Industry category" value={viewer.category} />
            <FactRow label="Location" value={[viewer.city, viewer.province].filter(Boolean).join(', ')} />
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>Contact</SectionLabel>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <FactRow label="Contact person" value={viewer.contactPerson} />
            <FactRow label="Contact mobile" value={viewer.contactMobile} />
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>Capabilities</SectionLabel>
          <View style={{ marginTop: space.sm }}>
            <TagList items={viewer.capabilities} emptyLabel="No capabilities listed yet." />
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>Service areas</SectionLabel>
          <View style={{ marginTop: space.sm }}>
            <TagList items={viewer.serviceAreas} emptyLabel="No service areas listed yet." />
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>Activity</SectionLabel>
          <View style={styles.statsGrid}>
            {statRows.map((r) => (
              <View key={r.label} style={styles.statCell}>
                <Text style={styles.statValue}>{r.value}</Text>
                <Text style={styles.mutedSmall}>{r.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.footerRow}>
          <ActionButton label="Update in onboarding" variant="primary" onPress={onEditProfile} />
          <ActionButton label="Back to home" variant="outline" onPress={onBack} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },

  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding, gap: space.lg },
  pageWide: { width: '100%', maxWidth: 720, paddingHorizontal: layout.screenPadding, gap: space.lg },

  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  breadcrumbLink: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbSep: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkFaint },
  breadcrumbCurrent: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted },

  hero: { gap: space.sm },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  heroName: {
    fontFamily: font.display,
    fontSize: fontSize.display,
    lineHeight: lineHeight.display,
    letterSpacing: letterSpacing.tight,
    color: color.ink,
  },
  heroBadgeRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },

  card: { ...elevation.cardRaised, borderRadius: radius.xl, backgroundColor: color.surface, padding: space.lg },
  sectionLabel: {
    fontFamily: font.mono,
    fontSize: fontSize.micro,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase',
    color: color.inkFaint,
  },

  factRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md, flexWrap: 'wrap' },
  factLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  factValue: { flexShrink: 1, textAlign: 'right', fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },

  mutedSmall: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.inkMuted },

  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tag: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  tagLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl, marginTop: space.sm },
  statCell: { minWidth: 140, gap: space.xs },
  statValue: { fontFamily: font.display, fontSize: fontSize.lg, color: color.ink },

  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  badgeLabel: { fontFamily: font.monoMedium, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', marginTop: space.sm },
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm },
});
