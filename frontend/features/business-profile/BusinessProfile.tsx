// features/business-profile/BusinessProfile.tsx
// Facebook + LinkedIn style: cover photo, overlapping profile picture, badges,
// highlights, then section cards. On your own profile: change photo/cover,
// Edit profile, and a completeness meter.
// A read-only view of ANOTHER business's public profile — reached via
// "View buyer profile" (RequirementDetail, respondent view) and "View
// profile" (RequirementDetail, owner viewing a released respondent). Same
// page shell as AccountProfile.tsx, but nothing here is the viewer's own —
// Contact details stay private to the account owner and administrators.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text, Pressable, Modal, TextInput, Image, Linking, StyleSheet, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import { PORTFOLIO_MAX_ITEMS, type ReportReason, type PortfolioItemOut, type ProfileDetailsIn, type ProfileImageKind, type CompletedWorkOut } from '../../lib/api/business';
import { ReportBusinessModal } from '../../components/ui/ReportBusinessModal';
import { InfoHint } from '../../components/ui/InfoHint';
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
  /** Completed TrustLink orders the seller chose to show (no prices). */
  completedWork?: CompletedWorkOut[];
  /** Own profile: completed orders not shown yet. */
  completedSuggestions?: CompletedWorkOut[];
  /** Own profile: show/hide one on the profile. Resolves to an error message, or null. */
  onShowcase?: (requirementId: number, show: boolean) => Promise<string | null>;
  /** Blob URLs of the profile picture / cover photo, null = show the default. */
  avatarUri?: string | null;
  coverUri?: string | null;
  /** Own profile only (their presence = own profile). Resolve to an error message, or null. */
  onUploadImage?: (kind: ProfileImageKind, file: File) => Promise<string | null>;
  onSaveDetails?: (details: ProfileDetailsIn) => Promise<string | null>;
  onUpdateCapabilities?: () => void;
  onCompleteVerification?: () => void;
  /** A buyer viewing a seller: Post a Requirement with this seller invited. */
  onRequestQuote?: () => void;
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

function CompletedWorkCard({ work, actionLabel, onAction }: {
  work: CompletedWorkOut;
  actionLabel?: string;
  onAction?: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!onAction) return;
    setBusy(true);
    setError(null);
    const err = await onAction().catch(() => 'Something went wrong.');
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <View style={styles.workCard}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.workBadge}>✓ Verified transaction</Text>
        <Text style={styles.tileCaption} numberOfLines={2}>{work.title}</Text>
        <Text style={styles.mutedSmall} numberOfLines={1}>
          {[work.item_name ?? work.category, work.quantity, work.city].filter(Boolean).join(' · ')}
        </Text>
        <Text style={styles.mutedSmall} numberOfLines={1}>
          For {work.buyer_name}{work.completed_at ? ` · Completed ${formatMonthYear(work.completed_at)}` : ''}
        </Text>
        {error && <Text style={styles.reportError}>{error}</Text>}
      </View>
      {onAction && actionLabel && (
        <Pressable onPress={run} disabled={busy} hitSlop={6}>
          <Text style={styles.linkSmall}>{busy ? '…' : actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function PortfolioSection({ profile, items, load, onOpen, onAdd, onRemove, completedWork = [], completedSuggestions = [], onShowcase }: {
  profile: PublicBusinessProfile;
  items: PortfolioItemOut[];
  completedWork?: CompletedWorkOut[];
  completedSuggestions?: CompletedWorkOut[];
  onShowcase?: (requirementId: number, show: boolean) => Promise<string | null>;
  load?: (itemId: number) => Promise<string>;
  onOpen?: (itemId: number) => void;
  onAdd?: (file: File, caption: string, itemCode: string | null) => Promise<string | null>;
  onRemove?: (itemId: number) => Promise<string | null>;
}) {
  const [adding, setAdding] = useState(false);
  const isOwner = !!onAdd;
  if (!isOwner && items.length === 0 && completedWork.length === 0) return null;
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
      {completedWork.length > 0 && (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Text style={styles.workHeading}>Completed on TrustLink</Text>
          {completedWork.map((w) => (
            <CompletedWorkCard key={w.requirement_id} work={w} actionLabel={onShowcase ? 'Hide' : undefined}
              onAction={onShowcase && (() => onShowcase(w.requirement_id, false))} />
          ))}
        </View>
      )}
      {isOwner && completedSuggestions.length > 0 && (
        <View style={[styles.suggestBox, { marginTop: space.md }]}>
          <Text style={styles.workHeading}>Suggested from your completed orders</Text>
          <Text style={styles.mutedSmall}>Only you see these until you choose to show them. Prices are never shown.</Text>
          {completedSuggestions.map((w) => (
            <CompletedWorkCard key={w.requirement_id} work={w} actionLabel="Show on profile"
              onAction={onShowcase && (() => onShowcase(w.requirement_id, true))} />
          ))}
        </View>
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

const YEARS_LABEL: Record<string, string> = {
  LESS_THAN_1: '< 1 yr in business',
  '1_TO_3': '1–3 yrs in business',
  '4_TO_6': '4–6 yrs in business',
  '7_PLUS': '7+ yrs in business',
};

// Default cover when none is uploaded — web only; native shows the plain primary fill.
const COVER_GRADIENT = { backgroundImage: `linear-gradient(120deg, ${color.primary} 0%, ${color.ink} 100%)` } as unknown as ViewStyle;

function openLink(url: string) {
  Linking.openURL(url).catch(() => undefined);
}

function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function Highlight({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.highlight}>
      <Text style={styles.highlightValue}>{value}</Text>
      <Text style={styles.highlightLabel}>{label}</Text>
    </View>
  );
}

type CompletenessPart = { key: string; label: string; done: boolean; action?: () => void; actionLabel?: string };

function CompletenessMeter({ parts }: { parts: CompletenessPart[] }) {
  const done = parts.filter((p) => p.done).length;
  const pct = Math.round((done / parts.length) * 100);
  const next = parts.find((p) => !p.done);
  return (
    <View style={styles.card}>
      <View style={styles.portfolioHeader}>
        <SectionLabel>Profile strength</SectionLabel>
        <Text style={styles.meterPct}>{pct}% complete</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${pct}%` }]} />
      </View>
      {next ? (
        <View style={[styles.footerRow, { marginTop: space.sm }]}>
          <Text style={[styles.mutedSmall, { flex: 1 }]}>Next: {next.label}</Text>
          {next.action && (
            <Pressable onPress={next.action} style={[styles.actionButton, styles.primaryButton]}>
              <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>{next.actionLabel ?? 'Add'}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Text style={[styles.mutedSmall, { marginTop: space.sm }]}>Your profile is complete. Buyers and suppliers see everything they need.</Text>
      )}
    </View>
  );
}

function EditProfileModal({ profile, onSave, onClose }: {
  profile: PublicBusinessProfile;
  onSave: (details: ProfileDetailsIn) => Promise<string | null>;
  onClose: () => void;
}) {
  const [headline, setHeadline] = useState(profile.headline ?? '');
  const [about, setAbout] = useState(profile.description ?? '');
  const [website, setWebsite] = useState(profile.websiteUrl ?? '');
  const [facebook, setFacebook] = useState(profile.facebookUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const err = await onSave({ headline, about, website_url: website, facebook_url: facebook }).catch(() => 'Could not save.');
    setSaving(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { gap: space.md }]}>
          <Text style={styles.modalTitle}>Edit profile</Text>
          <View style={{ gap: space.xs }}>
            <Text style={styles.factLabel}>Headline</Text>
            <TextInput value={headline} onChangeText={setHeadline} maxLength={100} placeholder="e.g. Large-format printing for events and retail in Pasig" placeholderTextColor={color.inkFaint} style={styles.editInput} />
          </View>
          <View style={{ gap: space.xs }}>
            <Text style={styles.factLabel}>About</Text>
            <TextInput value={about} onChangeText={setAbout} maxLength={1000} multiline placeholder="What your business does, who you serve, what you're known for." placeholderTextColor={color.inkFaint} style={styles.reportInput} />
          </View>
          <View style={{ gap: space.xs }}>
            <Text style={styles.factLabel}>Website</Text>
            <TextInput value={website} onChangeText={setWebsite} maxLength={300} autoCapitalize="none" placeholder="https://yourbusiness.ph" placeholderTextColor={color.inkFaint} style={styles.editInput} />
          </View>
          <View style={{ gap: space.xs }}>
            <Text style={styles.factLabel}>Facebook page</Text>
            <TextInput value={facebook} onChangeText={setFacebook} maxLength={300} autoCapitalize="none" placeholder="https://facebook.com/yourbusiness" placeholderTextColor={color.inkFaint} style={styles.editInput} />
          </View>
          {error && <Text style={styles.reportError}>{error}</Text>}
          <View style={styles.footerRow}>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} style={styles.actionButton}>
              <Text style={styles.actionButtonLabel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} disabled={saving} style={[styles.actionButton, styles.primaryButton, saving ? { opacity: 0.5 } : null]}>
              <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Business transparency, as slides ─────────────────── */

function SlideStat({ value, label }: { value: number; label: string }) {
  const clean = value === 0;
  return (
    <View style={[styles.slideStat, clean ? styles.slideStatClean : null]}>
      <Text style={[styles.slideStatValue, clean ? { color: color.primary } : null]}>{value}</Text>
      <Text style={styles.slideStatLabel}>{label}</Text>
    </View>
  );
}

function TransparencySlides({ profile, verified }: { profile: PublicBusinessProfile; verified: boolean }) {
  const [index, setIndex] = useState(0);
  const docs = profile.registrationDocumentTypes.join(' · ');
  const slides: { title: string; body: ReactNode }[] = [
    {
      title: 'Verification',
      body: (
        <View style={styles.slideCenter}>
          <Text style={[styles.slideHero, verified ? { color: color.primary } : null]}>{verified ? '✓ Verified' : 'Not yet verified'}</Text>
          <Text style={styles.slideSub}>{docs ? `Registration: ${docs}` : 'No passing registration document yet'}</Text>
          <Text style={styles.mutedSmall}>{verified ? 'Confirmed by a TrustLink administrator' : profile.verificationStatus.replace(/_/g, ' ')}</Text>
        </View>
      ),
    },
    {
      title: 'Track record',
      body: (
        <View style={styles.slideStatGrid}>
          <SlideStat value={profile.requirementsCancelled} label="Requirements cancelled" />
          <SlideStat value={profile.quotationsWithdrawn} label="Quotations withdrawn" />
          <SlideStat value={profile.transactionsNotPushedThrough} label="Did not push through" />
          <SlideStat value={profile.transactionsUnconfirmed} label="Unconfirmed orders" />
        </View>
      ),
    },
    {
      title: 'Contact',
      body: profile.contactDetailsVisible ? (
        <View style={styles.slideCenter}>
          <Text style={styles.slideHero}>{profile.contactPerson || 'Not provided'}</Text>
          <Text style={styles.slideSub}>{profile.contactMobile || 'No contact number'}</Text>
          <Text style={styles.mutedSmall}>Authorized contact person</Text>
        </View>
      ) : (
        <View style={styles.slideCenter}>
          <Text style={styles.slideSub}>🔒 Visible once your account is verified</Text>
        </View>
      ),
    },
  ];
  const last = slides.length - 1;
  const go = (i: number) => setIndex(Math.max(0, Math.min(last, i)));

  return (
    <View style={styles.card}>
      <View style={styles.portfolioHeader}>
        <SectionLabel>{`Business transparency · ${slides[index].title}`}</SectionLabel>
        <Text style={styles.slideCount}>{index + 1} / {slides.length}</Text>
      </View>
      <View style={styles.slideBody}>{slides[index].body}</View>
      <View style={styles.slideNav}>
        <Pressable onPress={() => go(index - 1)} disabled={index === 0} hitSlop={8} style={[styles.slideArrow, index === 0 ? { opacity: 0.3 } : null]} accessibilityLabel="Previous">
          <Text style={styles.slideArrowLabel}>‹</Text>
        </Pressable>
        <View style={styles.slideDots}>
          {slides.map((s, i) => (
            <Pressable key={s.title} onPress={() => go(i)} hitSlop={6} accessibilityLabel={s.title}>
              <View style={[styles.slideDot, i === index ? styles.slideDotActive : null]} />
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => go(index + 1)} disabled={index === last} hitSlop={8} style={[styles.slideArrow, index === last ? { opacity: 0.3 } : null]} accessibilityLabel="Next">
          <Text style={styles.slideArrowLabel}>›</Text>
        </Pressable>
      </View>
      <InfoHint text="TrustLink administrators review uploaded documents; verification is not performed directly by DTI or SEC. Document contents and registration numbers stay private. Track record counts what this business cancelled, withdrew, or did not complete." />
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
  completedWork,
  completedSuggestions,
  onShowcase,
  avatarUri,
  coverUri,
  onUploadImage,
  onSaveDetails,
  onRequestQuote,
  onUpdateCapabilities,
  onCompleteVerification,
}: BusinessProfileProps) {
  const [reporting, setReporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState<ProfileImageKind | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const verified = profile.credibility.status === 'VERIFIED';
  const c = profile.credibility;
  const isOwn = !!onSaveDetails;
  const isSeller = profile.role === 'seller';
  const avatarSize = isWide ? 112 : 88;

  const statRows: { label: string; value: string }[] = [
    { label: 'Requirements posted · As buyer', value: String(c.requirementsPosted) },
    { label: 'Requirements awarded · As buyer', value: String(c.requirementsAwarded) },
    { label: 'Quotations submitted · As supplier', value: String(c.quotationsSubmitted) },
    { label: 'Quotations awarded · As supplier', value: String(c.quotationsAwarded) },
    { label: 'Completed transactions', value: String(profile.transactionsCompleted) },
    { label: 'Unconfirmed · No order updates', value: String(profile.transactionsUnconfirmed) },
  ];
  const awarded = c.requirementsAwarded + c.quotationsAwarded;
  const rate = profile.completionRate === null ? '—' : `${Math.round(profile.completionRate * 100)}%`;

  const pickImage = async (kind: ProfileImageKind) => {
    if (!onUploadImage || !isWebFilePickerSupported()) return;
    const picked = await pickWebFile('.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp');
    if (!picked) return;
    if (picked.size > 5 * 1024 * 1024) { setImageError('Photos can be up to 5 MB.'); return; }
    setUploading(kind);
    setImageError(null);
    const err = await onUploadImage(kind, picked).catch(() => 'Could not upload that photo.');
    setUploading(null);
    if (err) setImageError(err);
  };

  const parts: CompletenessPart[] = [
    { key: 'avatar', label: 'Add a profile picture', done: profile.hasAvatar, action: () => pickImage('avatar'), actionLabel: 'Add photo' },
    { key: 'cover', label: 'Add a cover photo', done: profile.hasCover, action: () => pickImage('cover'), actionLabel: 'Add cover' },
    { key: 'headline', label: 'Write a one-line headline', done: !!profile.headline, action: () => setEditing(true), actionLabel: 'Add headline' },
    { key: 'about', label: 'Tell businesses about you', done: !!profile.description, action: () => setEditing(true), actionLabel: 'Write About' },
    { key: 'capabilities', label: 'List your capabilities', done: profile.capabilities.length > 0, action: onUpdateCapabilities, actionLabel: 'Update' },
    ...(isSeller ? [{ key: 'portfolio', label: 'Add a photo of past work (below)', done: (portfolio?.length ?? 0) > 0 }] : []),
    { key: 'verified', label: 'Get verified', done: verified, action: onCompleteVerification, actionLabel: 'Verify' },
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

        {/* Cover + avatar + identity, one card — Facebook/LinkedIn style. */}
        <View style={[styles.card, styles.heroCard]}>
          <View style={[styles.cover, { height: isWide ? 200 : 130 }, coverUri ? null : COVER_GRADIENT]}>
            {coverUri && <Image source={{ uri: coverUri }} style={styles.coverImage} resizeMode="cover" />}
            {isOwn && onUploadImage && (
              <Pressable onPress={() => pickImage('cover')} style={styles.coverButton} disabled={uploading !== null}>
                <Text style={styles.coverButtonLabel}>{uploading === 'cover' ? 'Uploading…' : coverUri ? 'Change cover' : 'Add cover photo'}</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.heroBody}>
            <View style={[styles.avatarRing, { marginTop: -(avatarSize / 2) - 4 }]}>
              <AvatarChip label={initials(profile.registeredName)} size={avatarSize} imageUri={avatarUri} round />
            </View>
            {isOwn && onUploadImage && (
              <Pressable onPress={() => pickImage('avatar')} hitSlop={6} disabled={uploading !== null} style={{ alignSelf: 'flex-start' }}>
                <Text style={styles.linkSmall}>{uploading === 'avatar' ? 'Uploading…' : avatarUri ? 'Change photo' : 'Add profile picture'}</Text>
              </Pressable>
            )}
            {imageError && <Text style={styles.reportError}>{imageError}</Text>}

            <Text style={styles.heroName}>{profile.registeredName}</Text>
            {!!profile.headline && <Text style={styles.headline}>{profile.headline}</Text>}
            <Text style={styles.mutedSmall}>
              {[profile.category, [profile.city, profile.province].filter(Boolean).join(', '), profile.role === 'buyer' ? 'Buyer' : profile.role === 'seller' ? 'Seller' : null]
                .filter(Boolean).join(' · ')}
            </Text>
            <View style={styles.heroBadgeRow}>
              <StatusBadge label={verified ? '✓ Verified' : 'Not yet verified'} tone={verified ? 'primary' : 'neutral'} />
              {verified && c.tier && <StatusBadge label={`Tier ${c.tier}`} tone="neutral" />}
              {profile.yearsInBusiness && YEARS_LABEL[profile.yearsInBusiness] && (
                <StatusBadge label={YEARS_LABEL[profile.yearsInBusiness]} tone="neutral" />
              )}
            </View>
            {(profile.websiteUrl || profile.facebookUrl) && (
              <View style={styles.linkRow}>
                {profile.websiteUrl && (
                  <Pressable onPress={() => openLink(profile.websiteUrl!)} hitSlop={4}>
                    <Text style={styles.linkSmall} numberOfLines={1}>🌐 {linkLabel(profile.websiteUrl)}</Text>
                  </Pressable>
                )}
                {profile.facebookUrl && (
                  <Pressable onPress={() => openLink(profile.facebookUrl!)} hitSlop={4}>
                    <Text style={styles.linkSmall} numberOfLines={1}>Facebook</Text>
                  </Pressable>
                )}
              </View>
            )}

            <View style={styles.heroActions}>
              {onRequestQuote && (
                <Pressable onPress={onRequestQuote} style={[styles.actionButton, styles.primaryButton]}>
                  <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>Request a quote</Text>
                </Pressable>
              )}
              {isOwn && (
                <Pressable onPress={() => setEditing(true)} style={styles.actionButton}>
                  <Text style={styles.actionButtonLabel}>Edit profile</Text>
                </Pressable>
              )}
              {onReport && (
                <Pressable onPress={() => setReporting(true)} style={[styles.actionButton, styles.dangerButton]}>
                  <Text style={[styles.actionButtonLabel, { color: color.danger }]}>Report</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.highlightRow}>
              <Highlight value={String(profile.transactionsCompleted)} label="Completed" />
              <Highlight value={rate} label="Completion rate" />
              <Highlight value={String(awarded)} label="Awarded" />
              <Highlight value={formatMonthYear(profile.memberSince)} label="Member since" />
            </View>
          </View>
        </View>

        {isOwn && <CompletenessMeter parts={parts} />}

        <View style={styles.card}>
          <SectionLabel>About</SectionLabel>
          {profile.description ? (
            <Text style={styles.heroBio}>{profile.description}</Text>
          ) : (
            <Text style={[styles.mutedSmall, { marginTop: space.sm }]}>
              {isOwn ? 'Tell other businesses what you do — tap Edit profile.' : 'No description yet.'}
            </Text>
          )}
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <FactRow label="Business type" value={businessTypeLabel(profile.businessType)} />
            <FactRow label="Verified since" value={verified ? (c.verifiedAt ? formatMonthYear(c.verifiedAt) : 'Date not recorded') : 'Not yet verified'} />
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
            completedWork={completedWork}
            completedSuggestions={completedSuggestions}
            onShowcase={onShowcase}
          />
        )}

        <View style={styles.card}>
          <SectionLabel>Capabilities and service areas</SectionLabel>
          <View style={{ marginTop: space.sm, gap: space.md }}>
            <TagList items={profile.capabilities} emptyLabel="No capabilities listed." />
            <TagList items={profile.serviceAreas} emptyLabel="No service areas listed." />
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
          <Text style={[styles.mutedSmall, { marginTop: space.md }]}>
            {profile.includesSealedActivity
              ? 'Supplier counts include your private sealed activity.'
              : 'Supplier counts exclude sealed activity and submissions or withdrawals before the closing deadline.'}
          </Text>
          <InfoHint text="Completed = the supplier marked it completed and the buyer confirmed (or did not respond within 14 days). Completion rate = completed ÷ awarded. Unconfirmed orders had no updates and count as neither." />
        </View>

        <TransparencySlides profile={profile} verified={verified} />

        <View style={styles.footerRow}>
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.actionButton, { backgroundColor: pressed ? color.surfaceSunken : color.surface }]}
          >
            <Text style={styles.actionButtonLabel}>Back</Text>
          </Pressable>
        </View>
        {reporting && onReport && (
          <ReportBusinessModal businessName={profile.registeredName} onClose={() => setReporting(false)} onSubmit={onReport} />
        )}
        {editing && onSaveDetails && (
          <EditProfileModal profile={profile} onSave={onSaveDetails} onClose={() => setEditing(false)} />
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

  heroCard: { padding: 0, overflow: 'hidden' },
  cover: { width: '100%', backgroundColor: color.primary },
  coverImage: { width: '100%', height: '100%' },
  coverButton: { position: 'absolute', right: space.md, bottom: space.md, borderRadius: radius.pill, backgroundColor: color.surface, paddingHorizontal: space.md, paddingVertical: space.xs },
  coverButtonLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  heroBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm },
  avatarRing: { alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 4, borderColor: color.surface, backgroundColor: color.surface },
  headline: { fontFamily: font.bodyMedium, fontSize: fontSize.base, lineHeight: lineHeight.base, color: color.ink },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  linkSmall: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  heroActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  highlightRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm, borderTopWidth: 1, borderTopColor: color.borderFaint, paddingTop: space.md, rowGap: space.md },
  highlight: { flexGrow: 1, flexBasis: 120, gap: 2 },
  highlightValue: { fontFamily: font.display, fontSize: fontSize.lg, color: color.ink },
  highlightLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  meterPct: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary },
  meterTrack: { height: 8, borderRadius: radius.pill, backgroundColor: color.surfaceSunken, overflow: 'hidden', marginTop: space.sm },
  meterFill: { height: '100%', borderRadius: radius.pill, backgroundColor: color.primary },
  slideBody: { minHeight: 150, justifyContent: 'center', paddingVertical: space.lg },
  slideCenter: { alignItems: 'center', gap: space.xs },
  slideHero: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink, textAlign: 'center' },
  slideSub: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.ink, textAlign: 'center' },
  slideStatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slideStat: { flexGrow: 1, flexBasis: 130, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingVertical: space.md, paddingHorizontal: space.sm },
  slideStatClean: { borderColor: color.primaryBorder, backgroundColor: color.primaryFaint },
  slideStatValue: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  slideStatLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, textAlign: 'center' },
  slideCount: { fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
  slideNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slideArrow: { width: 36, height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, alignItems: 'center', justifyContent: 'center' },
  slideArrowLabel: { fontFamily: font.bodySemi, fontSize: fontSize.lg, color: color.ink, lineHeight: fontSize.lg + 2 },
  slideDots: { flexDirection: 'row', gap: space.sm },
  slideDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.border },
  slideDotActive: { width: 22, backgroundColor: color.primary },
  workCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space.md, backgroundColor: color.surface },
  workBadge: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.primary },
  workHeading: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  suggestBox: { gap: space.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: color.primaryBorder, backgroundColor: color.primaryFaint, borderRadius: radius.lg, padding: space.md },
  editInput: { minHeight: layout.minTouchTarget, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: space.md, fontFamily: font.body, fontSize: fontSize.sm, color: color.ink },
});
