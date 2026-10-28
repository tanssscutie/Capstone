// features/business-profile/BusinessProfile.tsx
// Facebook + LinkedIn style: cover photo, overlapping profile picture, badges,
// coloured highlight tiles, then section cards — two columns on desktop (main:
// About, Past work, Activity; sticky sidebar: Profile strength, transparency,
// capabilities, links), one column on a phone. On your own profile: change
// photo/cover, a completeness meter, "View as others" (hides every owner
// control), and Edit profile as a side drawer with a live preview of the page
// as others will see it.
// A read-only view of ANOTHER business's public profile — reached via
// "View buyer profile" (RequirementDetail, respondent view) and "View
// profile" (RequirementDetail, owner viewing a released respondent). Same
// page shell as AccountProfile.tsx, but nothing here is the viewer's own —
// Contact details stay private to the account owner and administrators.

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text, Pressable, TextInput, Image, Linking, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import type { ViewStyle } from 'react-native';
import {
  PORTFOLIO_MAX_ITEMS, type ReportReason, type PortfolioItemOut, type ProfileDetailsIn, type ProfileImageKind, type CompletedWorkOut,
  type ProfileSection, type ProfileVisibility,
} from '../../lib/api/business';
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
  /** Own profile: "View as others" — the profile exactly as that audience gets
   *  it from the API (what's hidden is really withheld, not just un-drawn). */
  onLoadAsOthers?: (as: 'public' | 'verified') => Promise<PublicBusinessProfile>;
  /** Own profile: who sees which section. Resolves to an error message, or null. */
  onSaveVisibility?: (choices: Record<ProfileSection, ProfileVisibility>) => Promise<string | null>;
}

/* ─── Profile privacy (owner) ─────────────────────────── */

const PRIVACY_SECTIONS: { key: ProfileSection; label: string; hint: string }[] = [
  { key: 'about', label: 'About', hint: 'Your description' },
  { key: 'links', label: 'Website and Facebook', hint: 'Your links' },
  { key: 'highlights', label: 'Highlights', hint: 'The strip under your name' },
  { key: 'offered_items', label: 'Items you offer', hint: 'And your capabilities' },
  { key: 'service_areas', label: 'Service areas', hint: 'Where you deliver' },
  { key: 'completed_orders', label: 'Completed on TrustLink', hint: 'Orders you chose to show' },
  { key: 'contact', label: 'Contact person and number', hint: 'Never public — verified businesses at most' },
];
const LEVEL_LABELS: Record<ProfileVisibility, string> = { public: 'Public', verified: 'Verified only', only_me: 'Only me' };

function PrivacyCard({ visibility, onSave }: {
  visibility: Record<ProfileSection, ProfileVisibility>;
  onSave: (choices: Record<ProfileSection, ProfileVisibility>) => Promise<string | null>;
}) {
  const [choices, setChoices] = useState(visibility);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const changed = PRIVACY_SECTIONS.some((s) => choices[s.key] !== visibility[s.key]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const err = await onSave(choices).catch(() => 'Could not save who sees your profile.');
    setSaving(false);
    setMessage(err ? { error: true, text: err } : { error: false, text: 'Saved.' });
  };

  return (
    <View style={styles.card}>
      <SectionLabel tone="primary" shape="ring">Who sees your profile</SectionLabel>
      <View style={styles.alwaysPublic}>
        <Text style={styles.alwaysPublicTitle}>Always public</Text>
        <Text style={styles.mutedSmall}>
          Your verification badge, tier and track record. They're how other businesses decide to trust you, so they can't be hidden.
        </Text>
      </View>
      <View style={{ gap: space.md, marginTop: space.md }}>
        {PRIVACY_SECTIONS.map((section) => (
          <View key={section.key} style={{ gap: space.xs }}>
            <Text style={styles.privacyLabel}>{section.label}</Text>
            <Text style={styles.mutedSmall}>{section.hint}</Text>
            <View style={styles.privacyOptions}>
              {(['public', 'verified', 'only_me'] as ProfileVisibility[])
                .filter((level) => !(section.key === 'contact' && level === 'public'))
                .map((level) => {
                  const on = choices[section.key] === level;
                  return (
                    <Pressable
                      key={level}
                      onPress={() => setChoices((prev) => ({ ...prev, [section.key]: level }))}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      style={[styles.privacyOption, on && styles.privacyOptionOn]}
                    >
                      <Text style={[styles.privacyOptionLabel, on && styles.privacyOptionLabelOn]}>{LEVEL_LABELS[level]}</Text>
                    </Pressable>
                  );
                })}
            </View>
          </View>
        ))}
      </View>
      <View style={styles.privacyFooter}>
        <Pressable onPress={save} disabled={!changed || saving} style={[styles.actionButton, styles.primaryButton, (!changed || saving) && { opacity: 0.5 }]}>
          <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
        {message && <Text style={message.error ? styles.reportError : styles.mutedSmall}>{message.text}</Text>}
      </View>
    </View>
  );
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
        <SectionLabel tone="warning" shape="square">Past work</SectionLabel>
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

type ToneName = 'primary' | 'success' | 'warning' | 'accent';
type ShapeName = 'dot' | 'square' | 'diamond' | 'bars' | 'ring';

const TONES: Record<ToneName, { ink: string; faint: string; border: string }> = {
  primary: { ink: color.primary, faint: color.primaryFaint, border: color.primaryBorder },
  success: { ink: color.success, faint: color.successFaint, border: color.successBorder },
  warning: { ink: color.warning, faint: color.warningFaint, border: color.warningBorder },
  accent: { ink: color.accent, faint: color.accentFaint, border: color.accentBorder },
};

/** A small icon built from plain shapes (no icon library). */
function Shape({ shape, tone, size = 8 }: { shape: ShapeName; tone: ToneName; size?: number }) {
  const ink = TONES[tone].ink;
  if (shape === 'bars') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 1.5, height: size + 2 }}>
        {[0.5, 1, 0.75].map((h, i) => <View key={i} style={{ width: 2.5, height: (size + 2) * h, backgroundColor: ink, borderRadius: 1 }} />)}
      </View>
    );
  }
  if (shape === 'ring') return <View style={{ width: size, height: size, borderRadius: radius.pill, borderWidth: 2, borderColor: ink }} />;
  return (
    <View style={{
      width: size, height: size, backgroundColor: ink,
      borderRadius: shape === 'dot' ? radius.pill : 2,
      transform: shape === 'diamond' ? [{ rotate: '45deg' }] : undefined,
    }} />
  );
}

function IconChip({ shape, tone }: { shape: ShapeName; tone: ToneName }) {
  return (
    <View style={[styles.iconChip, { backgroundColor: TONES[tone].faint, borderColor: TONES[tone].border }]}>
      <Shape shape={shape} tone={tone} />
    </View>
  );
}

function SectionLabel({ children, tone = 'primary', shape = 'dot' }: { children: string; tone?: ToneName; shape?: ShapeName }) {
  return (
    <View style={styles.sectionTitleRow}>
      <IconChip shape={shape} tone={tone} />
      <Text style={styles.sectionLabel}>{children}</Text>
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

function Highlight({ value, label, tone, shape }: { value: string; label: string; tone: ToneName; shape: ShapeName }) {
  return (
    <View style={[styles.highlight, { backgroundColor: TONES[tone].faint, borderColor: TONES[tone].border }]}>
      <View style={styles.highlightTop}>
        <Shape shape={shape} tone={tone} size={10} />
        <Text style={styles.highlightLabel}>{label}</Text>
      </View>
      <Text style={[styles.highlightValue, { color: TONES[tone].ink }]}>{value}</Text>
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
        <SectionLabel tone="success" shape="bars">Profile strength</SectionLabel>
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

function draftFrom(profile: PublicBusinessProfile): ProfileDetailsIn {
  return {
    headline: profile.headline ?? '',
    about: profile.description ?? '',
    website_url: profile.websiteUrl ?? '',
    facebook_url: profile.facebookUrl ?? '',
  };
}

/** Right-hand drawer (desktop) / bottom sheet (phone). The page behind it
 *  renders the draft live, as others will see it. */
function EditProfileDrawer({ draft, setDraft, onSave, onClose, isWide }: {
  draft: ProfileDetailsIn;
  setDraft: (d: ProfileDetailsIn) => void;
  onSave: (details: ProfileDetailsIn) => Promise<string | null>;
  onClose: () => void;
  isWide: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof ProfileDetailsIn) => (v: string) => setDraft({ ...draft, [key]: v });

  const save = async () => {
    setSaving(true);
    setError(null);
    const err = await onSave(draft).catch(() => 'Could not save.');
    setSaving(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <View style={[styles.drawer, isWide ? styles.drawerWide : styles.drawerSheet, FIXED]}>
      <View style={styles.drawerHeader}>
        <Text style={styles.modalTitle}>Edit profile</Text>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveLabel}>Live preview</Text>
        </View>
      </View>
      <Text style={styles.mutedSmall}>{isWide ? 'The page on the left' : 'The page above'} shows your changes as other businesses will see them.</Text>
      <View style={{ gap: space.xs }}>
        <Text style={styles.factLabel}>Headline</Text>
        <TextInput value={draft.headline} onChangeText={set('headline')} maxLength={100} placeholder="e.g. Large-format printing for events and retail in Pasig" placeholderTextColor={color.inkFaint} style={styles.editInput} />
      </View>
      <View style={{ gap: space.xs }}>
        <Text style={styles.factLabel}>About</Text>
        <TextInput value={draft.about} onChangeText={set('about')} maxLength={1000} multiline placeholder="What your business does, who you serve, what you're known for." placeholderTextColor={color.inkFaint} style={styles.reportInput} />
      </View>
      <View style={{ gap: space.xs }}>
        <Text style={styles.factLabel}>Website</Text>
        <TextInput value={draft.website_url} onChangeText={set('website_url')} maxLength={300} autoCapitalize="none" placeholder="https://yourbusiness.ph" placeholderTextColor={color.inkFaint} style={styles.editInput} />
      </View>
      <View style={{ gap: space.xs }}>
        <Text style={styles.factLabel}>Facebook page</Text>
        <TextInput value={draft.facebook_url} onChangeText={set('facebook_url')} maxLength={300} autoCapitalize="none" placeholder="https://facebook.com/yourbusiness" placeholderTextColor={color.inkFaint} style={styles.editInput} />
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
  );
}

// Web: the drawer stays put while the page scrolls behind it.
const FIXED = (Platform.OS === 'web' ? { position: 'fixed', overflowY: 'auto', overflowX: 'hidden' } : { position: 'absolute' }) as unknown as ViewStyle;
const STICKY = (Platform.OS === 'web' ? { position: 'sticky', top: space.lg } : {}) as unknown as ViewStyle;

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
          <Text style={styles.slideSub}>
            {profile.hiddenSections.includes('contact') && profile.visibility === null
              ? '🔒 Shared with verified businesses only, or kept private by this business'
              : '🔒 Visible once your account is verified'}
          </Text>
        </View>
      ),
    },
  ];
  const last = slides.length - 1;
  const go = (i: number) => setIndex(Math.max(0, Math.min(last, i)));

  return (
    <View style={styles.card}>
      <View style={styles.portfolioHeader}>
        <SectionLabel tone="primary" shape="diamond">{`Business transparency · ${slides[index].title}`}</SectionLabel>
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
  profile: saved,
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
  onLoadAsOthers,
  onSaveVisibility,
}: BusinessProfileProps) {
  const [reporting, setReporting] = useState(false);
  // Edit profile: the draft values, rendered live on the page behind the drawer.
  const [draft, setDraft] = useState<ProfileDetailsIn | null>(null);
  const [viewAsOthers, setViewAsOthers] = useState(false);
  // "View as others": which audience, and the profile the API returns for it.
  const [viewAs, setViewAs] = useState<'public' | 'verified'>('public');
  const [asOthers, setAsOthers] = useState<PublicBusinessProfile | null>(null);
  useEffect(() => {
    if (!viewAsOthers || !onLoadAsOthers) {
      setAsOthers(null);
      return;
    }
    let alive = true;
    onLoadAsOthers(viewAs).then((p) => { if (alive) setAsOthers(p); }).catch(() => {});
    return () => { alive = false; };
  }, [viewAsOthers, viewAs, onLoadAsOthers]);
  const [uploading, setUploading] = useState<ProfileImageKind | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= breakpoint.desktop;
  const isOwn = !!onSaveDetails;
  const editing = isOwn && draft !== null;
  // Owner controls show only on your own profile, outside both previews.
  const owner = isOwn && !viewAsOthers && !editing;
  const profile: PublicBusinessProfile = viewAsOthers && asOthers
    ? asOthers
    : draft
    ? {
        ...saved,
        headline: draft.headline.trim() || null,
        description: draft.about.trim() || null,
        websiteUrl: draft.website_url.trim() || null,
        facebookUrl: draft.facebook_url.trim() || null,
      }
    : saved;
  const verified = profile.credibility.status === 'VERIFIED';
  // Sections this viewer doesn't get (profile privacy) — the API already left them out.
  const hidden = new Set(profile.hiddenSections);
  const c = profile.credibility;
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
  const startEditing = () => { setViewAsOthers(false); setDraft(draftFrom(saved)); };

  const parts: CompletenessPart[] = [
    { key: 'avatar', label: 'Add a profile picture', done: profile.hasAvatar, action: () => pickImage('avatar'), actionLabel: 'Add photo' },
    { key: 'cover', label: 'Add a cover photo', done: profile.hasCover, action: () => pickImage('cover'), actionLabel: 'Add cover' },
    { key: 'headline', label: 'Write a one-line headline', done: !!profile.headline, action: startEditing, actionLabel: 'Add headline' },
    { key: 'about', label: 'Tell businesses about you', done: !!profile.description, action: startEditing, actionLabel: 'Write About' },
    { key: 'capabilities', label: 'List your capabilities', done: profile.capabilities.length > 0, action: onUpdateCapabilities, actionLabel: 'Update' },
    ...(isSeller ? [{ key: 'portfolio', label: 'Add a photo of past work', done: (portfolio?.length ?? 0) > 0 }] : []),
    { key: 'verified', label: 'Get verified', done: verified, action: onCompleteVerification, actionLabel: 'Verify' },
  ];

  const hero = (
    <View style={[styles.card, styles.heroCard]}>
      <View style={[styles.cover, { height: isWide ? 220 : 130 }, coverUri ? null : COVER_GRADIENT]}>
        {coverUri && <Image source={{ uri: coverUri }} style={styles.coverImage} resizeMode="cover" />}
        {owner && onUploadImage && (
          <Pressable onPress={() => pickImage('cover')} style={styles.coverButton} disabled={uploading !== null}>
            <Text style={styles.coverButtonLabel}>{uploading === 'cover' ? 'Uploading…' : coverUri ? 'Change cover' : 'Add cover photo'}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.heroBody}>
        <View style={[styles.avatarRing, { marginTop: -(avatarSize / 2) - 4 }]}>
          <AvatarChip label={initials(profile.registeredName)} size={avatarSize} imageUri={avatarUri} round />
        </View>
        {owner && onUploadImage && (
          <Pressable onPress={() => pickImage('avatar')} hitSlop={6} disabled={uploading !== null} style={{ alignSelf: 'flex-start' }}>
            <Text style={styles.linkSmall}>{uploading === 'avatar' ? 'Uploading…' : avatarUri ? 'Change photo' : 'Add profile picture'}</Text>
          </Pressable>
        )}
        {owner && imageError && <Text style={styles.reportError}>{imageError}</Text>}

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

        <View style={styles.heroActions}>
          {onRequestQuote && (
            <Pressable onPress={onRequestQuote} style={[styles.actionButton, styles.primaryButton]}>
              <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>Request a quote</Text>
            </Pressable>
          )}
          {owner && (
            <>
              <Pressable onPress={startEditing} style={[styles.actionButton, styles.primaryButton]}>
                <Text style={[styles.actionButtonLabel, { color: color.onPrimary }]}>Edit profile</Text>
              </Pressable>
              <Pressable onPress={() => setViewAsOthers(true)} style={styles.actionButton}>
                <Text style={styles.actionButtonLabel}>👁 View as others</Text>
              </Pressable>
            </>
          )}
          {onReport && (
            <Pressable onPress={() => setReporting(true)} style={[styles.actionButton, styles.dangerButton]}>
              <Text style={[styles.actionButtonLabel, { color: color.danger }]}>Report</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );

  const highlights = (
    <View style={styles.highlightRow}>
      <Highlight value={String(profile.transactionsCompleted)} label="Completed" tone="success" shape="dot" />
      <Highlight value={rate} label="Completion rate" tone="accent" shape="ring" />
      <Highlight value={String(awarded)} label="Awarded" tone="primary" shape="diamond" />
      <Highlight value={formatMonthYear(profile.memberSince)} label="Member since" tone="warning" shape="square" />
    </View>
  );

  const about = (
    <View style={styles.card}>
      <SectionLabel tone="accent" shape="dot">About</SectionLabel>
      {hidden.has('about') ? (
        <Text style={[styles.mutedSmall, { marginTop: space.sm }]}>🔒 This business shares its description with fewer people.</Text>
      ) : profile.description ? (
        <Text style={styles.heroBio}>{profile.description}</Text>
      ) : (
        <Text style={[styles.mutedSmall, { marginTop: space.sm }]}>
          {owner ? 'Tell other businesses what you do — tap Edit profile.' : 'No description yet.'}
        </Text>
      )}
      <View style={{ gap: space.sm, marginTop: space.md }}>
        <FactRow label="Business type" value={businessTypeLabel(profile.businessType)} />
        <FactRow label="Verified since" value={verified ? (c.verifiedAt ? formatMonthYear(c.verifiedAt) : 'Date not recorded') : 'Not yet verified'} />
      </View>
    </View>
  );

  const pastWork = portfolio && (
    <PortfolioSection
      profile={profile}
      items={portfolio}
      load={loadPortfolioImage}
      onOpen={onOpenPortfolioImage}
      onAdd={owner ? onAddPortfolioItem : undefined}
      onRemove={owner ? onRemovePortfolioItem : undefined}
      completedWork={hidden.has('completed_orders') ? [] : completedWork}
      completedSuggestions={owner ? completedSuggestions : undefined}
      onShowcase={owner ? onShowcase : undefined}
    />
  );

  const activity = (
    <View style={styles.card}>
      <SectionLabel tone="primary" shape="bars">Activity</SectionLabel>
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
  );

  const capabilities = (
    <View style={styles.card}>
      <SectionLabel tone="success" shape="square">What we offer and where</SectionLabel>
      <View style={{ marginTop: space.sm, gap: space.md }}>
        {hidden.has('offered_items') ? (
          <Text style={styles.mutedSmall}>🔒 Items and capabilities aren't shared with you.</Text>
        ) : (
          <>
            {profile.offeredItems.length > 0 && <TagList items={profile.offeredItems} emptyLabel="" />}
            <TagList items={profile.capabilities} emptyLabel="No capabilities listed." />
          </>
        )}
        {hidden.has('service_areas')
          ? <Text style={styles.mutedSmall}>🔒 Service areas aren't shared with you.</Text>
          : <TagList items={profile.serviceAreas} emptyLabel="No service areas listed." />}
      </View>
    </View>
  );

  const hasLinks = !!(profile.websiteUrl || profile.facebookUrl);
  const links = !hidden.has('links') && (hasLinks || owner) && (
    <View style={styles.card}>
      <SectionLabel tone="accent" shape="ring">Links</SectionLabel>
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        {profile.websiteUrl && (
          <Pressable onPress={() => openLink(profile.websiteUrl!)} hitSlop={4}>
            <Text style={styles.linkSmall} numberOfLines={1}>🌐 {linkLabel(profile.websiteUrl)}</Text>
          </Pressable>
        )}
        {profile.facebookUrl && (
          <Pressable onPress={() => openLink(profile.facebookUrl!)} hitSlop={4}>
            <Text style={styles.linkSmall} numberOfLines={1}>Facebook · {linkLabel(profile.facebookUrl)}</Text>
          </Pressable>
        )}
        {!hasLinks && <Text style={styles.mutedSmall}>No links yet — add your website or Facebook page in Edit profile.</Text>}
      </View>
    </View>
  );

  const strength = owner && <CompletenessMeter parts={parts} />;
  const privacy = owner && onSaveVisibility && saved.visibility && (
    <PrivacyCard visibility={saved.visibility} onSave={onSaveVisibility} />
  );
  const transparency = <TransparencySlides profile={profile} verified={verified} />;

  return (
    <ScreenScroll style={styles.root} contentContainerStyle={styles.scrollContent}>
      <View style={[isWide ? styles.pageWide : styles.page, editing && isWide ? { paddingRight: DRAWER_WIDTH + space.xl } : null, editing && !isWide ? { paddingBottom: 420 } : null]}>
        <View style={styles.breadcrumbRow}>
          <Pressable onPress={onBack} hitSlop={6}>
            <Text style={styles.breadcrumbLink}>Home</Text>
          </Pressable>
          <Text style={styles.breadcrumbSep}>/</Text>
          <Text style={styles.breadcrumbCurrent}>Business Profile</Text>
        </View>

        {isOwn && (viewAsOthers || editing) && (
          <View style={styles.previewBanner}>
            <Text style={styles.previewText}>
              {editing
                ? 'Live preview — this is how others will see your profile once you save.'
                : `👁 This is how ${viewAs === 'verified' ? 'a verified business sees' : 'any signed-in business sees'} your profile.`}
            </Text>
            {viewAsOthers && onLoadAsOthers && (
              <View style={styles.privacyOptions}>
                {(['public', 'verified'] as const).map((a) => (
                  <Pressable
                    key={a}
                    onPress={() => setViewAs(a)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: viewAs === a }}
                    style={[styles.privacyOption, viewAs === a && styles.privacyOptionOn]}
                  >
                    <Text style={[styles.privacyOptionLabel, viewAs === a && styles.privacyOptionLabelOn]}>
                      {a === 'public' ? 'Any business' : 'Verified business'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {viewAsOthers && (
              <Pressable onPress={() => setViewAsOthers(false)} hitSlop={6}>
                <Text style={styles.previewExit}>Exit preview</Text>
              </Pressable>
            )}
          </View>
        )}

        {hero}
        {!hidden.has('highlights') && highlights}

        {isWide ? (
          <View style={styles.columns}>
            <View style={styles.mainColumn}>
              {about}
              {pastWork}
              {activity}
            </View>
            <View style={[styles.sideColumn, STICKY]}>
              {strength}
              {privacy}
              {transparency}
              {capabilities}
              {links}
            </View>
          </View>
        ) : (
          <>
            {strength}
            {privacy}
            {about}
            {pastWork}
            {capabilities}
            {activity}
            {transparency}
            {links}
          </>
        )}

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
      </View>
      {editing && onSaveDetails && draft && (
        <EditProfileDrawer draft={draft} setDraft={setDraft} onSave={onSaveDetails} onClose={() => setDraft(null)} isWide={isWide} />
      )}
    </ScreenScroll>
  );
}

const DRAWER_WIDTH = 400;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  scrollContent: { alignItems: 'center', paddingVertical: space.lg, paddingBottom: space.xxl },

  page: { width: '100%', maxWidth: layout.maxWidth, paddingHorizontal: layout.screenPadding, gap: space.lg },
  pageWide: { width: '100%', maxWidth: layout.maxWidthWide, paddingHorizontal: layout.screenPadding, gap: space.lg },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  mainColumn: { flex: 1.7, minWidth: 0, gap: space.lg },
  sideColumn: { flex: 1, minWidth: 280, maxWidth: 400, gap: space.lg },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1, minWidth: 0 },
  iconChip: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  alwaysPublic: { marginTop: space.sm, gap: 2, borderRadius: radius.md, backgroundColor: color.successFaint, borderWidth: 1, borderColor: color.successBorder, padding: space.md },
  alwaysPublicTitle: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.success },
  privacyLabel: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.ink },
  privacyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  privacyOption: { borderWidth: 1, borderColor: color.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs, backgroundColor: color.canvas },
  privacyOptionOn: { borderColor: color.primary, backgroundColor: color.primaryFaint },
  privacyOptionLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.inkMuted },
  privacyOptionLabelOn: { color: color.primary },
  privacyFooter: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg, flexWrap: 'wrap' },
  previewBanner: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.md, borderWidth: 1, borderColor: color.accentBorder, backgroundColor: color.accentFaint, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  previewText: { flex: 1, minWidth: 200, fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.accent },
  previewExit: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.primary, textDecorationLine: 'underline' },
  drawer: { zIndex: 50, backgroundColor: color.surface, padding: space.xl, gap: space.md, ...elevation.cardRaised },
  drawerWide: { top: 0, right: 0, bottom: 0, width: 400, borderLeftWidth: 1, borderLeftColor: color.border },
  drawerSheet: { left: 0, right: 0, bottom: 0, maxHeight: '70%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderTopWidth: 1, borderTopColor: color.border },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderRadius: radius.pill, backgroundColor: color.successFaint, borderWidth: 1, borderColor: color.successBorder, paddingHorizontal: space.sm, paddingVertical: 2 },
  liveDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: color.success },
  liveLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.success },

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
    flexShrink: 1,
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

  portfolioHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
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
  highlightRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  highlight: { flexGrow: 1, flexBasis: 140, gap: space.xs, borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  highlightTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  highlightValue: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  highlightLabel: { fontFamily: font.mono, fontSize: 10, letterSpacing: letterSpacing.label, textTransform: 'uppercase', color: color.inkFaint },
  meterPct: { fontFamily: font.bodySemi, fontSize: fontSize.sm, color: color.success },
  meterTrack: { height: 8, borderRadius: radius.pill, backgroundColor: color.surfaceSunken, overflow: 'hidden', marginTop: space.sm },
  meterFill: { height: '100%', borderRadius: radius.pill, backgroundColor: color.success },
  slideBody: { minHeight: 150, justifyContent: 'center', paddingVertical: space.lg },
  slideCenter: { alignItems: 'center', gap: space.xs },
  slideHero: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink, textAlign: 'center' },
  slideSub: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: color.ink, textAlign: 'center' },
  slideStatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slideStat: { flexGrow: 1, flexBasis: 130, alignItems: 'center', gap: 2, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, paddingVertical: space.md, paddingHorizontal: space.sm },
  slideStatClean: { borderColor: color.primaryBorder, backgroundColor: color.primaryFaint },
  slideStatValue: { fontFamily: font.display, fontSize: fontSize.xl, color: color.ink },
  slideStatLabel: { fontFamily: font.body, fontSize: fontSize.sm, color: color.inkMuted, textAlign: 'center' },
  slideCount: { flexShrink: 0, fontFamily: font.mono, fontSize: fontSize.micro, color: color.inkFaint },
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
