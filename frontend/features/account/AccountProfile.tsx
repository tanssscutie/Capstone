// features/account/AccountProfile.tsx
// "My Profile" — the account dropdown's promise ("Business name, contact,
// capabilities") made real. A read-only summary of everything onboarding
// collected, plus the same credibility facts HomeFeed's ProfileCard shows,
// on its own persistent, revisitable page. Same page shell as
// VerificationStatus.tsx (breadcrumb, hero, bordered cards).
// Identity and contact are locked after onboarding: "Request a change" asks an
// administrator (reviewed in 1–3 business days); capabilities, service areas
// and items stay editable in onboarding.

import { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, StyleSheet, useWindowDimensions } from 'react-native';
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
import type { Business, BusinessType, TrustTier } from '../../lib/types';
import { LOCKED_FIELDS, lockedFieldLabel, type ChangeRequestOut, type LockedField } from '../../lib/api/business';
import { useCategoryTree } from '../../lib/data/categories';

export interface AccountProfileProps {
  viewer: Business;
  onBack?: () => void;
  onEditProfile?: () => void;
  /** Your change requests, newest first. */
  changeRequests?: ChangeRequestOut[];
  /** Resolves to an error message, or null when sent. */
  onRequestChange?: (changes: Partial<Record<LockedField, string>>, reason: string) => Promise<string | null>;
  /** Your profile as other businesses see it — where a seller manages their portfolio. */
  onViewPublicProfile?: () => void;
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

function SectionLabel({ children, locked = false }: { children: string; locked?: boolean }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {locked && (
        <View style={styles.lockBadge}>
          <Text style={styles.lockBadgeLabel}>🔒 Locked</Text>
        </View>
      )}
    </View>
  );
}

const BUSINESS_TYPES: BusinessType[] = ['SOLE_PROP', 'PARTNERSHIP', 'CORPORATION', 'COOPERATIVE'];
const STATUS_LABEL: Record<ChangeRequestOut['status'], string> = {
  pending: 'Under review',
  approved: 'Approved',
  rejected: 'Not approved',
};

function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function currentValue(viewer: Business, key: LockedField): string {
  switch (key) {
    case 'registered_name': return viewer.registeredName;
    case 'display_name': return viewer.displayName ?? '';
    case 'business_type': return viewer.businessType;
    case 'industry_category': return viewer.category;
    case 'city': return viewer.city;
    case 'province': return viewer.province;
    case 'contact_person': return viewer.contactPerson;
    case 'contact_mobile': return viewer.contactMobile;
  }
}

function RequestChangeModal({ viewer, onSubmit, onClose }: {
  viewer: Business;
  onSubmit: (changes: Partial<Record<LockedField, string>>, reason: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { categories } = useCategoryTree();
  const [values, setValues] = useState<Partial<Record<LockedField, string>>>({});
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = Object.keys(values) as LockedField[];
  const canSend = !sending && picked.length > 0 && reason.trim().length >= 10
    && picked.every((k) => k === 'display_name' || (values[k] ?? '').trim().length >= 2);

  const toggle = (key: LockedField) => setValues((prev) => {
    const next = { ...prev };
    if (key in next) delete next[key];
    else next[key] = currentValue(viewer, key);
    return next;
  });
  const setValue = (key: LockedField, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const err = await onSubmit(values, reason.trim()).catch(() => 'Could not send your request.');
    setSending(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScreenScroll style={{ width: '100%', maxWidth: 520, maxHeight: '90%' }} contentContainerStyle={styles.modalCard}>
          <Text style={styles.modalTitle}>Request a change</Text>
          <Text style={styles.mutedSmall}>
            Your business identity and contact are locked so buyers and suppliers can trust them. An administrator reviews
            each change in 1–3 business days. You can have one request under review at a time.
          </Text>
          <Text style={styles.factLabel}>What needs to change?</Text>
          <View style={styles.tagWrap}>
            {LOCKED_FIELDS.map((f) => (
              <Pressable key={f.key} onPress={() => toggle(f.key)} style={[styles.choice, f.key in values ? styles.choiceActive : null]}>
                <Text style={[styles.choiceLabel, f.key in values ? { color: color.primary } : null]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
          {picked.map((key) => (
            <View key={key} style={{ gap: space.xs }}>
              <Text style={styles.factLabel}>{lockedFieldLabel(key)} <Text style={styles.mutedSmall}>· now: {currentValue(viewer, key) || '—'}</Text></Text>
              {key === 'business_type' ? (
                <View style={styles.tagWrap}>
                  {BUSINESS_TYPES.map((t) => (
                    <Pressable key={t} onPress={() => setValue(key, t)} style={[styles.choice, values[key] === t ? styles.choiceActive : null]}>
                      <Text style={styles.choiceLabel}>{businessTypeLabel(t)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : key === 'industry_category' ? (
                <View style={styles.tagWrap}>
                  {categories.map((cat) => (
                    <Pressable key={cat} onPress={() => setValue(key, cat)} style={[styles.choice, values[key] === cat ? styles.choiceActive : null]}>
                      <Text style={styles.choiceLabel}>{cat}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <TextInput
                  value={values[key] ?? ''}
                  onChangeText={(v) => setValue(key, v)}
                  maxLength={key === 'contact_mobile' ? 20 : key === 'contact_person' ? 120 : 200}
                  keyboardType={key === 'contact_mobile' ? 'phone-pad' : 'default'}
                  placeholder={key === 'display_name' ? 'Leave blank to use your registered name' : 'New value'}
                  placeholderTextColor={color.inkFaint}
                  style={styles.input}
                />
              )}
            </View>
          ))}
          <View style={{ gap: space.xs }}>
            <Text style={styles.factLabel}>Why? (the administrator reads this)</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              maxLength={500}
              multiline
              placeholder="e.g. We registered a new trade name with DTI — the new certificate is uploaded."
              placeholderTextColor={color.inkFaint}
              style={[styles.input, { minHeight: 80, paddingVertical: space.sm, textAlignVertical: 'top' }]}
            />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.footerRow}>
            <View style={{ flex: 1 }} />
            <ActionButton label="Cancel" onPress={onClose} />
            <Pressable onPress={send} disabled={!canSend} style={[styles.actionButton, { backgroundColor: color.primary, borderColor: color.primary }, !canSend ? { opacity: 0.4 } : null]}>
              <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>{sending ? 'Sending…' : 'Send request'}</Text>
            </Pressable>
          </View>
        </ScreenScroll>
      </View>
    </Modal>
  );
}

function ChangeRequestRow({ request }: { request: ChangeRequestOut }) {
  const tone = request.status === 'pending' ? color.warning : request.status === 'approved' ? color.success : color.danger;
  return (
    <View style={styles.requestRow}>
      <View style={styles.sectionRow}>
        <Text style={[styles.requestStatus, { color: tone }]}>{STATUS_LABEL[request.status]}</Text>
        <Text style={styles.mutedSmall}>{formatDay(request.created_at)}</Text>
      </View>
      {Object.entries(request.changes).map(([key, ch]) => (
        <Text key={key} style={styles.mutedSmall}>
          {lockedFieldLabel(key)}: {ch.from || '—'} → <Text style={{ color: color.ink }}>{ch.to || '(registered name)'}</Text>
        </Text>
      ))}
      {request.status === 'pending' && <Text style={styles.mutedSmall}>An administrator reviews it in 1–3 business days.</Text>}
      {request.admin_notes && <Text style={styles.mutedSmall}>Administrator: {request.admin_notes}</Text>}
    </View>
  );
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

export default function AccountProfile({ viewer, onBack, onEditProfile, onViewPublicProfile, changeRequests = [], onRequestChange }: AccountProfileProps) {
  const [requesting, setRequesting] = useState(false);
  const pending = changeRequests.find((r) => r.status === 'pending') ?? null;
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
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
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
          <SectionLabel locked={!!onRequestChange}>Business details</SectionLabel>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <FactRow label="Registered name" value={viewer.registeredName} />
            {viewer.displayName && <FactRow label="Display name" value={viewer.displayName} />}
            <FactRow label="Business type" value={businessTypeLabel(viewer.businessType)} />
            <FactRow label="Industry category" value={viewer.category} />
            <FactRow label="Location" value={[viewer.city, viewer.province].filter(Boolean).join(', ')} />
          </View>
        </View>

        <View style={styles.card}>
          <SectionLabel locked={!!onRequestChange}>Contact</SectionLabel>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <FactRow label="Contact person" value={viewer.contactPerson} />
            <FactRow label="Contact mobile" value={viewer.contactMobile} />
          </View>
        </View>

        {onRequestChange && (
          <View style={[styles.card, styles.lockCard]}>
            <Text style={styles.lockTitle}>Need to change a locked detail?</Text>
            <Text style={styles.mutedSmall}>
              Name, business type, category, location and contact are locked after onboarding so a verified business
              can't quietly become someone else. Ask an administrator — reviewed in 1–3 business days.
            </Text>
            {pending ? (
              <ChangeRequestRow request={pending} />
            ) : (
              <View style={styles.footerRow}>
                <ActionButton label="Request a change" variant="primary" onPress={() => setRequesting(true)} />
              </View>
            )}
            {changeRequests.filter((r) => r.status !== 'pending').slice(0, 3).map((r) => (
              <ChangeRequestRow key={r.id} request={r} />
            ))}
          </View>
        )}

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
          <ActionButton
            label={viewer.role === 'seller' ? 'Update capabilities & service areas' : 'Update capabilities & description'}
            variant="primary"
            onPress={onEditProfile}
          />
          {onViewPublicProfile && (
            <ActionButton
              label={viewer.role === 'seller' ? 'View public profile & past work' : 'View public profile'}
              variant="outline"
              onPress={onViewPublicProfile}
            />
          )}
          <ActionButton label="Back to home" variant="outline" onPress={onBack} />
        </View>
      </View>
      {requesting && onRequestChange && (
        <RequestChangeModal viewer={viewer} onSubmit={onRequestChange} onClose={() => setRequesting(false)} />
      )}
    </ScreenScroll>
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

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  lockBadge: { borderRadius: radius.pill, borderWidth: 1, borderColor: color.warningBorder, backgroundColor: color.warningFaint, paddingHorizontal: space.sm, paddingVertical: 2 },
  lockBadgeLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.warning },
  lockCard: { gap: space.sm, borderWidth: 1, borderColor: color.warningBorder },
  lockTitle: { fontFamily: font.bodySemi, fontSize: fontSize.base, color: color.ink },
  requestRow: { gap: 2, borderTopWidth: 1, borderTopColor: color.borderFaint, paddingTop: space.sm },
  requestStatus: { fontFamily: font.mono, fontSize: fontSize.micro, letterSpacing: letterSpacing.label, textTransform: 'uppercase' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,15,14,0.45)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  modalCard: { backgroundColor: color.surface, borderRadius: radius.xl, padding: space.xl, gap: space.md },
  modalTitle: { fontFamily: font.bodySemi, fontSize: fontSize.lg, color: color.ink },
  choice: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  choiceActive: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  choiceLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  input: { minHeight: layout.minTouchTarget, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, backgroundColor: color.canvas },
  error: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },
});
