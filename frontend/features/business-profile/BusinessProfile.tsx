// features/business-profile/BusinessProfile.tsx
// A read-only view of ANOTHER business's public profile — reached via
// "View buyer profile" (RequirementDetail, respondent view) and "View
// profile" (RequirementDetail, owner viewing a released respondent). Same
// page shell as AccountProfile.tsx, but nothing here is the viewer's own —
// no edit actions, no contact info (that stays private; see
// PublicBusinessProfile in lib/api/mappers.ts for what's deliberately left out).

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
import type { PublicBusinessProfile } from '../../lib/api/mappers';

export interface BusinessProfileProps {
  profile: PublicBusinessProfile;
  onBack?: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthYear(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  SOLE_PROP: 'Sole proprietorship',
  PARTNERSHIP: 'Partnership',
  CORPORATION: 'Corporation',
  COOPERATIVE: 'Cooperative',
};

function businessTypeLabel(type: string): string {
  return BUSINESS_TYPE_LABELS[type] ?? type;
}

function tierLabel(tier: 1 | 2 | 3 | null): string {
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

export default function BusinessProfile({ profile, onBack }: BusinessProfileProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const verified = profile.credibility.status === 'VERIFIED';
  const c = profile.credibility;

  const statRows: { label: string; value: string }[] = [
    { label: 'Requirements posted', value: String(c.requirementsPosted) },
    { label: 'Requirements awarded', value: String(c.requirementsAwarded) },
    { label: 'Member since', value: String(profile.memberSinceYear) },
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={isWide ? styles.pageWide : styles.page}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>Business Profile</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <AvatarChip label={initials(profile.registeredName)} size={56} />
            <View style={{ minWidth: 0, flex: 1, gap: space.xs }}>
              <Text style={styles.heroName}>{profile.registeredName}</Text>
              <View style={styles.heroBadgeRow}>
                <StatusBadge label={verified ? 'Verified' : 'Not yet verified'} tone={verified ? 'primary' : 'neutral'} />
                <StatusBadge label={tierLabel(c.tier)} tone="neutral" />
              </View>
            </View>
          </View>
          {verified && c.verifiedAt && (
            <Text style={styles.mutedSmall}>Verified {formatMonthYear(c.verifiedAt)}</Text>
          )}
        </View>

        <View style={styles.card}>
          <SectionLabel>Business details</SectionLabel>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <FactRow label="Business type" value={businessTypeLabel(profile.businessType)} />
            <FactRow label="Industry category" value={profile.category} />
            <FactRow label="Location" value={[profile.city, profile.province].filter(Boolean).join(', ')} />
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>Capabilities</SectionLabel>
          <View style={{ marginTop: space.sm }}>
            <TagList items={profile.capabilities} emptyLabel="No capabilities listed." />
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>Service areas</SectionLabel>
          <View style={{ marginTop: space.sm }}>
            <TagList items={profile.serviceAreas} emptyLabel="No service areas listed." />
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel>Activity on Trustlink</SectionLabel>
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
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.actionButton, { backgroundColor: pressed ? color.surfaceSunken : color.surface }]}
          >
            <Text style={styles.actionButtonLabel}>Back</Text>
          </Pressable>
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
  actionButton: { minHeight: layout.minTouchTarget, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  actionButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
});
