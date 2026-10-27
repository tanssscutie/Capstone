// features/business-profile/BusinessProfile.tsx
// A read-only view of ANOTHER business's public profile — reached via
// "View buyer profile" (RequirementDetail, respondent view) and "View
// profile" (RequirementDetail, owner viewing a released respondent). Same
// page shell as AccountProfile.tsx, but nothing here is the viewer's own —
// Contact details stay private to the account owner and administrators.

import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, TextInput, Image, StyleSheet, useWindowDimensions } from 'react-native';
import { PORTFOLIO_MAX_ITEMS, type ReportReason, type PortfolioItemOut } from '../../lib/api/business';
import { ReportBusinessModal } from '../../components/ui/ReportBusinessModal';
import { isWebFilePickerSupported, pickWebFile } from '../../lib/pickWebFile';
import { itemsFor, useCategoryTree } from '../../lib/data/categories';
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
import type { PublicBusinessProfile } from '../../lib/api/mappers';

export interface BusinessProfileProps {
  profile: PublicBusinessProfile;
  onBack?: () => void;
  /** Omitted on the viewer's own profile. Resolves to an error message, or null when sent. */
  onReport?: (reason: ReportReason, details: string) => Promise<string | null>;
  /** Seller's past-work photos. `portfolio` undefined = not a seller (no section). */
  portfolio?: PortfolioItemOut[];
  /** Blob URL for one photo (loads behind the login) — see usePortfolioImage. */
  loadPortfolioImage?: (itemId: number) => Promise<string>;
  onOpenPortfolioImage?: (itemId: number) => void;
  /** Own profile only. Each resolves to an error message, or null on success. */
  onAddPortfolioItem?: (file: File, caption: string, itemCode: string | null) => Promise<string | null>;
  onRemovePortfolioItem?: (itemId: number) => Promise<string | null>;
}

/* ─── Past work (portfolio) ─────────────────────────── */

function PortfolioTile({ item, load, onOpen, onRemove }: {
  item: PortfolioItemOut;
  load?: (itemId: number) => Promise<string>;
  onOpen?: (itemId: number) => void;
  onRemove?: (itemId: number) => Promise<string | null>;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!load) return;
    let url: string | null = null;
    let alive = true;
    load(item.id)
      .then((u) => { url = u; if (alive) setUri(u); else URL.revokeObjectURL(u); })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    // Keyed on the photo only: `load` is a fresh closure every parent render,
    // and re-running on it would re-download every photo each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <View style={styles.tile}>
      <Pressable onPress={onOpen ? () => onOpen(item.id) : undefined} disabled={!onOpen} accessibilityRole="imagebutton" accessibilityLabel={item.caption}>
        <View style={styles.tileImageBox}>
          {uri ? (
            <Image source={{ uri }} style={styles.tileImage} resizeMode="cover" />
          ) : (
            <Text style={styles.mutedSmall}>{failed ? 'Photo unavailable' : 'Loading…'}</Text>
          )}
        </View>
      </Pressable>
      <View style={{ gap: 2, padding: space.sm }}>
        <Text style={styles.tileCaption} numberOfLines={2}>{item.caption}</Text>
        {item.item_name && <Text style={styles.tileTag}>{item.item_name}</Text>}
      </View>
      {onRemove && (
        <Pressable
          onPress={async () => { setRemoving(true); const err = await onRemove(item.id); if (err) setRemoving(false); }}
          disabled={removing}
          hitSlop={6}
          accessibilityLabel="Remove photo"
          style={styles.tileRemove}
        >
          <Text style={styles.tileRemoveLabel}>{removing ? '…' : '✕'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function AddPortfolioForm({ category, onAdd, onCancel }: {
  category: string;
  onAdd: (file: File, caption: string, itemCode: string | null) => Promise<string | null>;
  onCancel: () => void;
}) {
  const { tree } = useCategoryTree();
  const items = itemsFor(tree, category);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [itemCode, setItemCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = !!file && caption.trim().length >= 3 && !saving;

  const pick = async () => {
    if (!isWebFilePickerSupported()) return;
    const picked = await pickWebFile('.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp');
    if (!picked) return;
    if (picked.size > 5 * 1024 * 1024) { setError('Photos can be up to 5 MB.'); return; }
    setError(null);
    setFile(picked);
  };

  const save = async () => {
    if (!canSave || !file) return;
    setSaving(true);
    setError(null);
    const err = await onAdd(file, caption, itemCode).catch(() => 'Could not add that photo.');
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <View style={styles.addForm}>
      <Pressable onPress={pick} style={styles.actionButton}>
        <Text style={styles.actionButtonLabel}>{file ? `📷 ${file.name}` : 'Choose a photo (JPG, PNG or WebP, up to 5 MB)'}</Text>
      </Pressable>
      <TextInput
        value={caption}
        onChangeText={setCaption}
        maxLength={140}
        placeholder="Caption, e.g. 3×6 ft event tarpaulin for a store opening"
        placeholderTextColor={color.inkFaint}
        style={styles.reportInput}
      />
      {items.length > 0 && (
        <View style={styles.tagRow}>
          {items.filter((i) => i.code !== 'other').map((i) => (
            <Pressable key={i.code} onPress={() => setItemCode(itemCode === i.code ? null : i.code)} style={[styles.reasonRow, styles.itemChip, itemCode === i.code ? styles.reasonRowActive : null]}>
              <Text style={styles.reasonLabel}>{i.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {error && <Text style={styles.reportError}>{error}</Text>}
      <View style={styles.footerRow}>
        <Pressable onPress={onCancel} style={styles.actionButton}>
          <Text style={styles.actionButtonLabel}>Cancel</Text>
        </Pressable>
        <Pressable onPress={save} disabled={!canSave} style={[styles.actionButton, styles.primaryButton, !canSave ? { opacity: 0.5 } : null]}>
          <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>{saving ? 'Adding…' : 'Add to portfolio'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PortfolioSection({ profile, items, load, onOpen, onAdd, onRemove }: {
  profile: PublicBusinessProfile;
  items: PortfolioItemOut[];
  load?: (itemId: number) => Promise<string>;
  onOpen?: (itemId: number) => void;
  onAdd?: (file: File, caption: string, itemCode: string | null) => Promise<string | null>;
  onRemove?: (itemId: number) => Promise<string | null>;
}) {
  const [adding, setAdding] = useState(false);
  const isOwner = !!onAdd;
  if (!isOwner && items.length === 0) return null;
  const full = items.length >= PORTFOLIO_MAX_ITEMS;

  return (
    <View style={styles.card}>
      <View style={styles.portfolioHeader}>
        <SectionLabel>Past work</SectionLabel>
        {isOwner && <Text style={styles.mutedSmall}>{items.length} of {PORTFOLIO_MAX_ITEMS}</Text>}
      </View>
      {isOwner && (
        <Text style={[styles.mutedSmall, { marginTop: space.xs }]}>
          Photos of orders you've delivered help buyers judge your work. Only signed-in TrustLink businesses can see them.
        </Text>
      )}
      {items.length === 0 ? (
        <Text style={[styles.mutedSmall, { marginTop: space.md }]}>No photos yet.</Text>
      ) : (
        <View style={styles.tileGrid}>
          {items.map((item) => (
            <PortfolioTile key={item.id} item={item} load={load} onOpen={onOpen} onRemove={onRemove} />
          ))}
        </View>
      )}
      {isOwner && onAdd && (adding ? (
        <AddPortfolioForm
          category={profile.category}
          onCancel={() => setAdding(false)}
          onAdd={async (file, caption, itemCode) => {
            const err = await onAdd(file, caption, itemCode);
            if (!err) setAdding(false);
            return err;
          }}
        />
      ) : !full ? (
        <View style={[styles.footerRow, { marginTop: space.md }]}>
          <Pressable onPress={() => setAdding(true)} style={styles.actionButton}>
            <Text style={styles.actionButtonLabel}>+ Add photo</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.mutedSmall, { marginTop: space.md }]}>Your portfolio is full — remove a photo to add another.</Text>
      ))}
    </View>
  );
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

export default function BusinessProfile({
  profile,
  onBack,
  onReport,
  portfolio,
  loadPortfolioImage,
  onOpenPortfolioImage,
  onAddPortfolioItem,
  onRemovePortfolioItem,
}: BusinessProfileProps) {
  const [reporting, setReporting] = useState(false);
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const verified = profile.credibility.status === 'VERIFIED';
  const c = profile.credibility;

  const statRows: { label: string; value: string }[] = [
    { label: 'Requirements posted · As buyer', value: String(c.requirementsPosted) },
    { label: 'Requirements awarded · As buyer', value: String(c.requirementsAwarded) },
    { label: 'Quotations submitted · As supplier', value: String(c.quotationsSubmitted) },
    { label: 'Quotations awarded · As supplier', value: String(c.quotationsAwarded) },
    { label: 'Completed transactions · Confirmed by both parties', value: String(profile.transactionsCompleted) },
  ];

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
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
                <StatusBadge label={verified ? 'Verified Business' : 'Not Yet Verified'} tone={verified ? 'primary' : 'neutral'} />
              </View>
            </View>
          </View>
          {!!profile.category && <Text style={styles.mutedSmall}>{profile.category}</Text>}
          <FactRow label="Member Since" value={formatMonthYear(profile.memberSince)} />
          <FactRow label="Verified Since" value={verified ? (c.verifiedAt ? formatMonthYear(c.verifiedAt) : 'Date not recorded') : 'Not Yet Verified'} />
          {!!profile.description && <Text style={styles.heroBio}>{profile.description}</Text>}
        </View>

        <View style={styles.card}>
          <SectionLabel>Business details</SectionLabel>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            {profile.role && <FactRow label="Account type" value={profile.role === 'buyer' ? 'Buyer' : 'Seller'} />}
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

        {portfolio && (
          <PortfolioSection
            profile={profile}
            items={portfolio}
            load={loadPortfolioImage}
            onOpen={onOpenPortfolioImage}
            onAdd={onAddPortfolioItem}
            onRemove={onRemovePortfolioItem}
          />
        )}

        <View style={styles.card}>
          <SectionLabel>Business activity overview</SectionLabel>
          <View style={styles.statsGrid}>
            {statRows.map((r) => (
              <View key={r.label} style={styles.statCell}>
                <Text style={styles.statValue}>{r.value}</Text>
                <Text style={styles.mutedSmall}>{r.label}</Text>
              </View>
            ))}
          </View>
          <Text style={[styles.mutedSmall, { marginTop: space.md }]}>
            {profile.includesSealedActivity
              ? 'Supplier counts include your private sealed activity.'
              : 'Supplier counts exclude sealed activity and submissions or withdrawals before the closing deadline.'}
            {' '}Submitted counts include recorded withdrawals and voided quotations. Awards record an accepted opportunity. Completed transactions are ones both the buyer and the supplier confirmed — TrustLink does not track delivery or payment.
          </Text>
        </View>

        <View style={styles.card}>
          <SectionLabel>Business transparency</SectionLabel>
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <FactRow label="Registration documents" value={profile.registrationDocumentTypes.join(', ') || 'No passing registration document recorded'} />
            <FactRow label="Verification status" value={profile.verificationStatus.replace(/_/g, ' ')} />
            <FactRow label="Registration verification" value={verified ? 'Administrator-confirmed' : 'Not Yet Verified'} />
            <FactRow label="Requirements cancelled · As buyer" value={String(profile.requirementsCancelled)} />
            <FactRow label="Quotations withdrawn · As supplier" value={String(profile.quotationsWithdrawn)} />
            <FactRow label="Transactions that did not push through" value={String(profile.transactionsNotPushedThrough)} />
            <FactRow label="Unconfirmed (no order updates)" value={String(profile.transactionsUnconfirmed)} />
            <FactRow label="Completion rate · Completed ÷ awarded" value={profile.completionRate === null ? 'No awards yet' : `${Math.round(profile.completionRate * 100)}%`} />
            <FactRow label="Authorized contact person" value={profile.contactDetailsVisible ? (profile.contactPerson || 'Not provided') : 'Visible once your account is verified'} />
            <FactRow label="Business contact number" value={profile.contactDetailsVisible ? (profile.contactMobile || 'Not provided') : 'Visible once your account is verified'} />
          </View>
          <Text style={[styles.mutedSmall, { marginTop: space.md }]}>
            TrustLink administrators review uploaded documents. Verification is not performed directly by DTI or SEC. Document contents and registration numbers remain private.
          </Text>
        </View>

        <View style={styles.footerRow}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.actionButton, { backgroundColor: pressed ? color.surfaceSunken : color.surface }]}
          >
            <Text style={styles.actionButtonLabel}>Back</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          {onReport && (
            <Pressable onPress={() => setReporting(true)} hitSlop={6} accessibilityRole="button">
              <Text style={styles.reportLink}>Report this business</Text>
            </Pressable>
          )}
        </View>
        {reporting && onReport && (
          <ReportBusinessModal businessName={profile.registeredName} onClose={() => setReporting(false)} onSubmit={onReport} />
        )}
      </View>
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
  heroBio: { fontFamily: font.body, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.ink, marginTop: space.xs },

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
  primaryButton: { backgroundColor: color.primary, borderColor: color.primary },
  dangerButton: { borderColor: color.dangerBorder },

  reportLink: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted, textDecorationLine: 'underline' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,15,14,0.45)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  modalCard: { width: '100%', maxWidth: 460, backgroundColor: color.surface, borderRadius: radius.xl, padding: space.xl },
  modalTitle: { fontFamily: font.bodySemi, fontSize: fontSize.lg, color: color.ink },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  reasonRowActive: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  radio: { width: 14, height: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.borderStrong },
  radioActive: { borderColor: color.primary, backgroundColor: color.primary },
  reasonLabel: { flex: 1, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
  reportInput: { minHeight: 96, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink, textAlignVertical: 'top' },
  reportError: { fontFamily: font.body, fontSize: fontSize.sm, color: color.danger },

  portfolioHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  tile: { width: 200, flexGrow: 1, maxWidth: 260, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.surface },
  tileImageBox: { width: '100%', aspectRatio: 4 / 3, backgroundColor: color.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  tileImage: { width: '100%', height: '100%' },
  tileCaption: { fontFamily: font.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, color: color.ink },
  tileTag: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
  tileRemove: { position: 'absolute', top: space.xs, right: space.xs, width: 26, height: 26, borderRadius: radius.pill, backgroundColor: 'rgba(15,15,14,0.6)', alignItems: 'center', justifyContent: 'center' },
  tileRemoveLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: '#fff' },
  addForm: { gap: space.sm, marginTop: space.md },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  itemChip: { paddingVertical: space.xs },
});
